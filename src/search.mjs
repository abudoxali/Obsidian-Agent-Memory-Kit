// SPDX-License-Identifier: Apache-2.0
// Knowledge search and read over the vault. Pure keyword scoring: no embeddings, no network.
import fs from 'node:fs';
import path from 'node:path';
import { VymemError } from './errors.mjs';
import { parseFrontmatter, extractHeadingSection } from './frontmatter.mjs';
import { sha256 } from './fsutil.mjs';
import { TRUST_NOTICE } from './project.mjs';

const DEFAULT_SYNONYMS = [
  ['test', 'tests', 'testing', 'qa', 'quality'],
  ['auth', 'authentication', 'login', 'session', 'token', 'jwt'],
  ['backup', 'backups', 'restore', 'recovery', 'rollback'],
  ['handoff', 'handover'],
  ['stale', 'outdated', 'freshness'],
  ['blocker', 'blockers', 'blocked'],
  ['decision', 'decisions', 'adr'],
  ['deploy', 'deployment', 'release', 'production'],
  ['agent', 'agents'],
  ['memory', 'memories', 'lesson', 'lessons']
];

const UNVERIFIED = new Set(['reported_document', 'conceptual_plan', 'pending_verification', 'unapproved_agent_handoff', 'unverified']);

function termGroups(query, synonyms) {
  const groups = [...DEFAULT_SYNONYMS, ...synonyms];
  return query.toLowerCase().split(/\s+/)
    .map(t => t.replace(/^["'`.,;:!?()[\]{}]+|["'`.,;:!?()[\]{}]+$/g, '')).filter(Boolean)
    .map(token => {
      const variants = new Set([token]);
      if (/[-_]/.test(token)) {
        variants.add(token.replace(/[-_]+/g, ' '));
        variants.add(token.replace(/[-_]+/g, ''));
        for (const part of token.split(/[-_]+/).filter(p => p.length >= 2)) variants.add(part);
      }
      for (const g of groups) {
        if ([...variants].some(v => g.includes(v))) for (const a of g) variants.add(a);
      }
      return { token, variants: [...variants] };
    });
}

export function knowledgeSearch(vault, args = {}, cfg = {}) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) throw new VymemError('INVALID_ARGUMENTS', 'query must be a non-empty string.');
  const limit = Math.min(Math.max(Number(args.limit || 10), 1), 30);
  const entityType = typeof args.entity_type === 'string' ? args.entity_type.trim().toLowerCase() : null;
  const files = vault.collectMarkdown(Array.isArray(args.folders) && args.folders.length ? args.folders : null);
  const groups = termGroups(query, (cfg.search?.synonyms || []).map(g => g.map(x => String(x).toLowerCase())));
  const phrase = query.toLowerCase();
  const flat = [...new Set(groups.flatMap(g => g.variants))];
  const full = [];
  const partial = [];

  for (const { rel, abs } of files) {
    const content = fs.readFileSync(abs, 'utf8');
    const parsed = parseFrontmatter(content);
    const f = parsed.fields;
    if (entityType && String(f.entity_type || '').toLowerCase() !== entityType) continue;
    const title = String(f.title || f.project_name || path.basename(rel, '.md'));
    const relLow = rel.toLowerCase();
    const titleLow = title.toLowerCase();
    const summaryLow = String(f.summary || '').toLowerCase();
    const hay = `${relLow}\n${titleLow}\n${String(f.record_id || '').toLowerCase()}\n${summaryLow}\n${parsed.rawYaml.toLowerCase()}\n${parsed.body.toLowerCase()}`;
    let matched = 0; let exact = 0; let score = 0;
    for (const g of groups) {
      if (!g.variants.some(v => hay.includes(v))) continue;
      matched++;
      if (hay.includes(g.token)) { exact++; score += 5; } else score += 3;
      if (g.variants.some(v => titleLow.includes(v))) score += 10;
      if (g.variants.some(v => relLow.includes(v))) score += 7;
      if (g.variants.some(v => summaryLow.includes(v))) score += 5;
    }
    if (!matched) continue;
    if (titleLow.includes(phrase)) score += 25; else if (summaryLow.includes(phrase)) score += 12; else if (hay.includes(phrase)) score += 8;
    const kStatus = String(f.knowledge_status || f.status || '');
    const vStatus = String(f.verification_status || '');
    if (kStatus === 'canonical' || vStatus === 'verified_current_source') score += 4;
    if (/^templates?\//i.test(rel)) score -= 18;
    const unverified = UNVERIFIED.has(vStatus) || f.approved_by_owner === false;
    const lines = vault.scanner.redact(parsed.body).split(/\r?\n/).filter(l => l.trim());
    const line = lines.find(l => flat.some(t => l.toLowerCase().includes(t))) || lines[0] || '';
    const hit = {
      path: rel, title, record_id: f.record_id || null, entity_type: f.entity_type || null,
      verification_status: vStatus || null, knowledge_status: kStatus || null,
      approved_by_owner: f.approved_by_owner === true, owner_agent: f.owner_agent || null,
      source_reference: f.source_reference || null, last_verified: f.last_verified || null,
      is_unverified: unverified, sha256: sha256(content),
      summary: vault.scanner.redact(String(f.summary || '')), snippet: line.slice(0, 240), score
    };
    if (matched === groups.length) { hit.score += 50 + exact * 2; full.push(hit); }
    else if (groups.length >= 3 && matched >= Math.max(2, Math.ceil(groups.length * 0.6)) && exact >= 1) { hit.score += matched * 6; partial.push(hit); }
  }
  const byScore = (a, b) => b.score - a.score || a.path.localeCompare(b.path);
  full.sort(byScore); partial.sort(byScore);
  const combined = full.length >= limit ? full : (full.length === 0 || groups.length >= 3 ? [...full, ...partial] : full);
  return {
    trust_boundary: TRUST_NOTICE, query, total_matches: combined.length,
    full_term_matches: full.length, partial_term_matches: combined.length - full.length,
    results: combined.slice(0, limit).map(({ score, ...rest }) => rest)
  };
}

export function knowledgeRead(vault, args = {}) {
  const { rel, raw } = vault.read(args.path);
  const parsed = parseFrontmatter(raw);
  const maxChars = Math.min(Math.max(Number(args.max_chars || 12000), 200), 30000);
  let body = parsed.body;
  let section = null;
  if (args.heading) {
    section = extractHeadingSection(parsed.body, String(args.heading));
    if (section === null) throw new VymemError('HEADING_NOT_FOUND', `Heading not found: ${args.heading}`);
    body = section;
  }
  const safe = vault.scanner.redact(body);
  return {
    trust_boundary: TRUST_NOTICE, path: rel, sha256: sha256(raw), frontmatter: parsed.fields,
    heading: args.heading || null, truncated: safe.length > maxChars, content: safe.slice(0, maxChars)
  };
}
