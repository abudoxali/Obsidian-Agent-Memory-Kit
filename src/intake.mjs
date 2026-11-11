// SPDX-License-Identifier: Apache-2.0
// Shared AI Inbox: agents may only write draft records (including structured handoffs) here.
// Guarantees: confined path, secret rejection, anti-impersonation, deduplication, conflict detection,
// backup before overwrite, audit log. Nothing written here is ever canonical or approved.
import fs from 'node:fs';
import { VymemError } from './errors.mjs';
import { parseFrontmatter, formatYamlValue, isLocked, patchFrontmatter } from './frontmatter.mjs';
import { sha256, slugify } from './fsutil.mjs';
import { normalizeRelPath } from './vault.mjs';

export const CATEGORIES = ['ai_inbox', 'agent_memory_candidate', 'learning_candidate', 'workflow_candidate', 'agent_handoff'];
export const CONFIDENCE = ['verified_local', 'verified_partial', 'observed_untested', 'hypothesis'];

const reqStr = (obj, keys, prefix = '') => {
  for (const k of keys) {
    if (typeof obj[k] !== 'string' || !obj[k].trim()) throw new VymemError('INVALID_ARGUMENTS', `Missing required string field: ${prefix}${k}`);
  }
};

export function submitKnowledgeEntry(vault, args = {}) {
  return vault.withLock('intake', () => submitUnlocked(vault, args));
}

function submitUnlocked(vault, args) {
  reqStr(args, ['record_id', 'title', 'body', 'summary', 'source_system', 'source_reference', 'owner_agent']);
  if (args.category !== undefined && !CATEGORIES.includes(args.category)) {
    throw new VymemError('INVALID_ARGUMENTS', `category must be one of: ${CATEGORIES.join(', ')}`);
  }
  const category = args.category || 'ai_inbox';
  const isHandoff = category === 'agent_handoff';
  const recordId = args.record_id.trim();
  const owner = args.owner_agent.trim();
  const inbox = vault.folders.inbox;

  let h = null;
  if (isHandoff) {
    const src = args.handoff;
    if (!src || typeof src !== 'object' || Array.isArray(src)) throw new VymemError('INVALID_ARGUMENTS', 'agent_handoff entries require a structured handoff object.');
    reqStr(src, ['project_identifier', 'originating_agent', 'task_objective', 'actual_completed_work', 'verification_evidence', 'suggested_next_action'], 'handoff.');
    if (src.originating_agent.trim().toLowerCase() !== owner.toLowerCase()) {
      throw new VymemError('IDENTITY_MISMATCH', `handoff.originating_agent '${src.originating_agent.trim()}' does not match owner_agent '${owner}'.`);
    }
    const conf = src.knowledge_confidence ? String(src.knowledge_confidence).trim() : 'observed_untested';
    if (!CONFIDENCE.includes(conf)) throw new VymemError('INVALID_ARGUMENTS', `Invalid handoff.knowledge_confidence '${conf}'.`);
    const list = v => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : []);
    h = {
      project_identifier: src.project_identifier.trim(), originating_agent: src.originating_agent.trim(),
      task_objective: src.task_objective.trim(), actual_completed_work: src.actual_completed_work.trim(),
      source_file_references: list(src.source_file_references), verification_evidence: src.verification_evidence.trim(),
      current_blockers: src.current_blockers ? String(src.current_blockers).trim() : 'None recorded',
      relevant_decisions: list(src.relevant_decisions), suggested_next_action: src.suggested_next_action.trim(),
      timestamp: String(src.timestamp || args.source_timestamp || '').trim(), knowledge_confidence: conf,
      source_provenance: src.source_provenance ? String(src.source_provenance).trim() : `${args.source_system.trim()}:${args.source_reference.trim()}`
    };
  }

  const targetRel = args.target_path
    ? normalizeRelPath(args.target_path)
    : `${inbox}/${isHandoff ? 'handoffs/' : ''}${slugify(recordId)}.md`;
  if (!targetRel.toLowerCase().startsWith(inbox.toLowerCase() + '/')) {
    throw new VymemError('UNAUTHORIZED_WRITE', `submit_knowledge_entry may only write inside '${inbox}/'. Rejected: '${targetRel}'.`);
  }
  vault.scanner.assertNone(JSON.stringify(args), 'submit_knowledge_entry');
  const { rel, abs } = vault.resolve(targetRel, { forWrite: true });

  // The dedup hash covers content only (never timestamps) so re-submitting the same facts is a no-op.
  const contentHash = sha256(JSON.stringify({
    record_id: recordId, title: args.title.trim(), category, body: args.body.trim(),
    summary: args.summary.trim(), source_system: args.source_system.trim(), source_reference: args.source_reference.trim(),
    ...(h ? { handoff: { ...h, timestamp: undefined } } : {})
  }));
  const index = vault.loadState('intake-index.json', { records: {} });
  const known = index.records[recordId];
  if (known && known.content_hash === contentHash && fs.existsSync(abs)) {
    return { status: 'DEDUPLICATED_NO_OP', message: 'Identical record already stored; no duplicate created.', path: rel, record_id: recordId, content_hash: contentHash, file_sha256: sha256(fs.readFileSync(abs, 'utf8')) };
  }

  if (fs.existsSync(abs)) {
    const cur = fs.readFileSync(abs, 'utf8');
    const curFields = parseFrontmatter(cur).fields;
    if (isLocked(curFields)) throw new VymemError('HUMAN_LOCKED', 'Existing record is approved or locked by its owner; agents cannot overwrite it.', { path: rel });
    const curSha = sha256(cur);
    if (args.expected_sha256 && args.expected_sha256 !== curSha) {
      throw new VymemError('CONFLICT_DETECTED', 'expected_sha256 does not match the current file.', { path: rel, expected: args.expected_sha256, actual: curSha });
    }
    if (curFields.record_id && curFields.record_id !== recordId) {
      throw new VymemError('CONFLICT_DETECTED', 'Target path already belongs to a different record_id.', { path: rel, existing_record_id: curFields.record_id });
    }
    if (curFields.owner_agent && String(curFields.owner_agent).toLowerCase() !== owner.toLowerCase()) {
      throw new VymemError('CONFLICT_DETECTED', `Record was written by '${curFields.owner_agent}'; '${owner}' may not overwrite it.`, { path: rel, existing_owner: curFields.owner_agent });
    }
  }

  const now = new Date().toISOString();
  const relatedProjects = Array.isArray(args.related_projects) ? [...args.related_projects] : [];
  if (h && !relatedProjects.some(p => p.toLowerCase().includes(h.project_identifier.toLowerCase()))) relatedProjects.push(`[[${h.project_identifier}]]`);
  const fm = {
    record_id: recordId,
    entity_type: isHandoff ? 'agent_handoff' : 'knowledge_intake',
    intake_category: category,
    domain: args.domain || 'engineering',
    title: args.title.trim(),
    owner_agent: owner,
    source_system: args.source_system.trim(),
    source_reference: args.source_reference.trim(),
    source_timestamp: args.source_timestamp || now,
    last_verified: now.slice(0, 10),
    verification_status: isHandoff ? 'unapproved_agent_handoff' : (args.verification_status || 'pending_verification'),
    knowledge_status: 'draft',
    approved_by_owner: false,
    ...(h ? { project_identifier: h.project_identifier, originating_agent: h.originating_agent, handoff_timestamp: h.timestamp || now, knowledge_confidence: h.knowledge_confidence, source_provenance: h.source_provenance } : {}),
    related_projects: relatedProjects,
    related_agents: Array.isArray(args.related_agents) ? args.related_agents : [],
    sensitivity: 'internal_operational',
    last_meaningful_update: now,
    content_hash: contentHash,
    tags: Array.isArray(args.tags) && args.tags.length ? args.tags : (isHandoff ? ['type/handoff', 'status/unapproved'] : ['type/intake', 'status/draft']),
    summary: args.summary.trim()
  };
  const code = v => `\`${v}\``;
  const handoffBody = h ? [
    '', '## Structured handoff',
    `- **Project:** [[${h.project_identifier}]]`,
    `- **Originating agent:** ${code(h.originating_agent)}`,
    `- **Approval state:** ${code('unapproved_agent_handoff')} (${code('approved_by_owner: false')})`,
    `- **Knowledge confidence:** ${code(h.knowledge_confidence)}`,
    `- **Provenance:** ${h.source_provenance}`,
    `- **Timestamp:** ${code(h.timestamp || now)}`,
    `- **Task objective:** ${h.task_objective}`,
    `- **Completed work (as reported):** ${h.actual_completed_work}`,
    `- **Source files:** ${h.source_file_references.length ? h.source_file_references.map(code).join(', ') : 'not specified'}`,
    `- **Verification evidence:** ${h.verification_evidence}`,
    `- **Current blockers:** ${h.current_blockers}`,
    `- **Relevant decisions:** ${h.relevant_decisions.length ? h.relevant_decisions.join('; ') : 'none'}`,
    `- **Suggested next action:** ${h.suggested_next_action}`
  ] : [];
  const md = [
    '---', ...Object.entries(fm).map(([k, v]) => `${k}: ${formatYamlValue(v)}`), '---', '',
    `# ${args.title.trim()}`, '',
    `> Record ${code(recordId)} | source ${code(args.source_system.trim())} | agent ${code(owner)} | **unapproved draft**`, '',
    args.body.trim(), ...handoffBody, '', '## Reference',
    `- **Source reference:** ${args.source_reference.trim()}`,
    `- **Dedup hash:** ${code(contentHash.slice(0, 16))}`, ''
  ].join('\n');

  if (args.dry_run === true) return { status: 'DRY_RUN_PREVIEW', path: rel, record_id: recordId, content_hash: contentHash, would_overwrite: fs.existsSync(abs) };

  const w = vault.backupAndWrite(abs, rel, md);
  index.records[recordId] = { path: rel, content_hash: contentHash, file_sha256: w.sha256, updated_at: now };
  vault.saveState('intake-index.json', index);
  vault.audit({ action: isHandoff ? 'SUBMIT_AGENT_HANDOFF' : 'SUBMIT_KNOWLEDGE_ENTRY', record_id: recordId, path: rel, owner_agent: owner, source_system: args.source_system.trim(), backup_path: w.backupRel, new_sha256: w.sha256 });
  return { status: 'WRITTEN_TO_AI_INBOX', path: rel, record_id: recordId, verification_status: fm.verification_status, approved_by_owner: false, content_hash: contentHash, file_sha256: w.sha256, backup_path: w.backupRel };
}

// Owner action (CLI only; not an MCP tool): promote an inbox record. After this, agents can no longer overwrite it.
export function approveRecord(vault, { record_id, approved_by }) {
  if (!approved_by || !String(approved_by).trim()) throw new VymemError('INVALID_ARGUMENTS', 'approved_by is required.');
  return vault.withLock('intake', () => {
    const index = vault.loadState('intake-index.json', { records: {} });
    const meta = index.records[record_id];
    if (!meta) throw new VymemError('NOT_FOUND', `Unknown record_id: ${record_id}`);
    const { rel, abs, raw } = vault.read(meta.path);
    const fields = parseFrontmatter(raw).fields;
    if (fields.approved_by_owner === true) return { status: 'ALREADY_APPROVED', path: rel, record_id };
    const now = new Date().toISOString();
    const next = patchFrontmatter(raw, { approved_by_owner: true, approved_by: String(approved_by).trim(), applied_at: now, knowledge_status: 'approved', verification_status: 'owner_approved' });
    const w = vault.backupAndWrite(abs, rel, next);
    index.records[record_id] = { ...meta, file_sha256: w.sha256, approved_at: now };
    vault.saveState('intake-index.json', index);
    vault.audit({ action: 'APPROVE_RECORD', record_id, path: rel, approved_by: String(approved_by).trim(), backup_path: w.backupRel, new_sha256: w.sha256 });
    return { status: 'APPROVED', path: rel, record_id, approved_by: String(approved_by).trim(), backup_path: w.backupRel };
  });
}
