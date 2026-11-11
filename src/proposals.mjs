// Owner-controlled canonical changes. Agents can only STAGE proposals (propose_update).
// Applying or rejecting a proposal is an operator action available through the local CLI only;
// it is deliberately not reachable from the MCP server.
import fs from 'node:fs';
import { VymemError } from './errors.mjs';
import { parseFrontmatter, formatYamlValue, assertTargetUnlocked, patchFrontmatter } from './frontmatter.mjs';
import { sha256 } from './fsutil.mjs';

const BEGIN = '<!-- BEGIN PROPOSED_CONTENT -->';
const END = '<!-- END PROPOSED_CONTENT -->';

export function listProposals(vault, { status = 'pending_approval', target_path } = {}) {
  let files = [];
  try { files = vault.collectMarkdown([vault.folders.proposals]); } catch { return { proposals: [] }; }
  const proposals = [];
  for (const f of files) {
    const fm = parseFrontmatter(fs.readFileSync(f.abs, 'utf8')).fields;
    if (fm.entity_type !== 'update_proposal') continue;
    if (status !== 'all' && fm.knowledge_status !== status) continue;
    if (target_path && fm.target_path !== target_path) continue;
    proposals.push({
      proposal_id: fm.proposal_id, path: f.rel, status: fm.knowledge_status, target_path: fm.target_path,
      owner_agent: fm.owner_agent || null, created: fm.created || null, summary: vault.scanner.redact(fm.summary || '')
    });
  }
  return { proposals };
}

export function proposeUpdate(vault, args = {}) {
  for (const k of ['target_path', 'summary', 'proposed_content', 'source_system', 'source_reference', 'owner_agent']) {
    if (typeof args[k] !== 'string' || !args[k].trim()) throw new VymemError('INVALID_ARGUMENTS', `Missing required string field: ${k}`);
  }
  vault.scanner.assertNone(JSON.stringify(args), 'propose_update');
  if (args.proposed_content.includes(END) || args.proposed_content.includes(BEGIN)) {
    throw new VymemError('INVALID_ARGUMENTS', 'proposed_content must not contain proposal marker comments.');
  }
  const target = vault.resolve(args.target_path, { forWrite: false });
  if (target.rel.toLowerCase().startsWith(vault.folders.proposals.toLowerCase() + '/')) {
    throw new VymemError('UNAUTHORIZED_WRITE', 'Proposals cannot target other proposals.');
  }
  if (!fs.existsSync(target.abs)) throw new VymemError('TARGET_NOT_FOUND', `Target note does not exist: ${target.rel}`);
  const targetRaw = fs.readFileSync(target.abs, 'utf8');
  const targetSha = sha256(targetRaw);
  const patch = args.proposed_frontmatter_patch && typeof args.proposed_frontmatter_patch === 'object' && !Array.isArray(args.proposed_frontmatter_patch)
    ? args.proposed_frontmatter_patch : {};
  assertTargetUnlocked(parseFrontmatter(targetRaw).fields, Object.keys(patch));
  if (args.expected_sha256 && args.expected_sha256 !== targetSha) {
    throw new VymemError('CONFLICT_DETECTED', `Target note '${target.rel}' changed before the proposal was created.`, { expected: args.expected_sha256, actual: targetSha });
  }
  const heading = (args.proposed_section_heading || `Proposed update ${new Date().toISOString().slice(0, 10)}`).replace(/[\r\n#]+/g, ' ').trim();
  const body = args.proposed_content.trim();
  const fingerprint = sha256(JSON.stringify({ target: target.rel, heading, body, patch }));

  return vault.withLock('proposals', () => {
    for (const p of listProposals(vault, { status: 'pending_approval', target_path: target.rel }).proposals) {
      const pf = parseFrontmatter(fs.readFileSync(vault.resolve(p.path).abs, 'utf8')).fields;
      if (pf.proposal_hash === fingerprint) {
        return { status: 'DEDUPLICATED_NO_OP', message: 'Identical pending proposal already exists; canonical note untouched.', proposal_id: p.proposal_id, proposal_path: p.path, target_path: target.rel, target_sha256: targetSha };
      }
    }
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const id = `prop-${today}-${fingerprint.slice(0, 10)}`;
    const propRel = `${vault.folders.proposals}/${id}.md`;
    const prop = vault.resolve(propRel, { forWrite: true });
    const fm = {
      record_id: `vymem:proposal:${id}`, proposal_id: id, entity_type: 'update_proposal', knowledge_status: 'pending_approval',
      target_path: target.rel, target_sha256_at_proposal: targetSha, proposal_hash: fingerprint, proposed_heading: heading,
      proposed_frontmatter_json: JSON.stringify(patch), owner_agent: args.owner_agent.trim(), source_system: args.source_system.trim(),
      source_reference: args.source_reference.trim(), created: today, verification_status: 'pending_verification',
      sensitivity: 'internal_operational', permitted_access: 'owner_approval_required', summary: args.summary.trim()
    };
    const doc = [
      '---', ...Object.entries(fm).map(([k, v]) => `${k}: ${formatYamlValue(v)}`), '---', '',
      `# Update proposal for ${target.rel}`, '',
      `> **Pending review.** The canonical note \`${target.rel}\` has NOT been modified.`,
      `> Proposed by \`${args.owner_agent.trim()}\` via \`${args.source_system.trim()}\`. Target SHA-256 at proposal time: \`${targetSha}\``, '',
      '## Summary', args.summary.trim(), '',
      '## Frontmatter patch', '```json', JSON.stringify(patch, null, 2), '```', '',
      `## Proposed section: ${heading}`, BEGIN, body, END, '',
      '## Reference', `- **Source:** ${args.source_reference.trim()}`, ''
    ].join('\n');
    const w = vault.backupAndWrite(prop.abs, prop.rel, doc);
    vault.audit({ action: 'PROPOSE_UPDATE', proposal_id: id, proposal_path: prop.rel, target_path: target.rel, target_sha256: targetSha, owner_agent: args.owner_agent.trim() });
    return { status: 'PROPOSAL_STAGED', canonical_note_modified: false, proposal_id: id, proposal_path: prop.rel, target_path: target.rel, target_sha256: targetSha, proposal_sha256: w.sha256 };
  });
}

function loadPending(vault, proposalId) {
  const id = String(proposalId || '').trim().replace(/\.md$/, '');
  if (!id) throw new VymemError('INVALID_ARGUMENTS', 'proposal_id is required.');
  const rel = `${vault.folders.proposals}/${id}.md`;
  const prop = vault.resolve(rel, { forWrite: true });
  if (!fs.existsSync(prop.abs)) throw new VymemError('PROPOSAL_NOT_FOUND', `Proposal not found: ${rel}`);
  const raw = fs.readFileSync(prop.abs, 'utf8');
  const fields = parseFrontmatter(raw).fields;
  if (fields.knowledge_status !== 'pending_approval') throw new VymemError('PROPOSAL_NOT_PENDING', `Proposal '${id}' has status '${fields.knowledge_status}'.`);
  return { id, prop, raw, fields };
}

export function applyProposal(vault, { proposal_id, approved_by, expected_target_sha256 } = {}) {
  if (!approved_by || !String(approved_by).trim()) throw new VymemError('EXPLICIT_APPROVAL_REQUIRED', 'approved_by is required.');
  return vault.withLock('proposals', () => {
    const { id, prop, raw, fields: pf } = loadPending(vault, proposal_id);
    const target = vault.resolve(String(pf.target_path || ''), { forWrite: true });
    if (!fs.existsSync(target.abs)) throw new VymemError('TARGET_NOT_FOUND', `Target note missing: ${target.rel}`);
    const targetRaw = fs.readFileSync(target.abs, 'utf8');
    const currentSha = sha256(targetRaw);
    const expected = expected_target_sha256 || pf.target_sha256_at_proposal;
    if (expected !== currentSha) {
      throw new VymemError('CONFLICT_DETECTED', `Target '${target.rel}' changed since proposal '${id}'. Aborting apply.`, { expected, actual: currentSha });
    }
    let patch = {};
    try { patch = JSON.parse(String(pf.proposed_frontmatter_json || '{}')); } catch { /* empty patch */ }
    assertTargetUnlocked(parseFrontmatter(targetRaw).fields, Object.keys(patch));
    const m = raw.match(new RegExp(`${BEGIN}\\r?\\n([\\s\\S]*?)\\r?\\n${END}`));
    const body = m ? m[1].trim() : '';
    vault.scanner.assertNone(body + JSON.stringify(patch), 'apply_approved_update');

    let next = patchFrontmatter(targetRaw, patch);
    if (body) {
      const marker = `<!-- vymem-proposal-applied: ${id} -->`;
      if (!next.includes(marker)) {
        next = next.replace(/\s*$/, '') + `\n\n---\n\n## ${pf.proposed_heading || 'Approved update'}\n${marker}\n` +
          `> Approved update from \`${pf.source_system || 'agent'}\` (${pf.owner_agent || 'agent'}) - approved by ${String(approved_by).trim()}\n\n${body}\n`;
      }
    }
    const tw = vault.backupAndWrite(target.abs, target.rel, next);
    const now = new Date().toISOString();
    const pw = vault.backupAndWrite(prop.abs, prop.rel, patchFrontmatter(raw, { knowledge_status: 'applied', approved_by: String(approved_by).trim(), applied_at: now, applied_target_sha256: tw.sha256 }));
    vault.audit({ action: 'APPLY_APPROVED_UPDATE', proposal_id: id, target_path: target.rel, approved_by: String(approved_by).trim(), approval_mechanism: 'local_operator_cli', target_backup: tw.backupRel, proposal_backup: pw.backupRel, previous_target_sha256: currentSha, new_target_sha256: tw.sha256 });
    return { status: 'APPLIED_WITH_BACKUP', proposal_id: id, target_path: target.rel, target_backup: tw.backupRel, previous_target_sha256: currentSha, new_target_sha256: tw.sha256 };
  });
}

export function rejectProposal(vault, { proposal_id, rejected_by, reason } = {}) {
  if (!rejected_by || !String(rejected_by).trim()) throw new VymemError('EXPLICIT_APPROVAL_REQUIRED', 'rejected_by is required.');
  return vault.withLock('proposals', () => {
    const { id, prop, raw } = loadPending(vault, proposal_id);
    const w = vault.backupAndWrite(prop.abs, prop.rel, patchFrontmatter(raw, { knowledge_status: 'rejected', rejected_by: String(rejected_by).trim(), rejected_reason: String(reason || '').slice(0, 300) }));
    vault.audit({ action: 'REJECT_PROPOSAL', proposal_id: id, rejected_by: String(rejected_by).trim(), backup_path: w.backupRel });
    return { status: 'REJECTED', proposal_id: id };
  });
}
