// SPDX-License-Identifier: Apache-2.0
// Minimal YAML-frontmatter reader/writer. It supports the flat subset VYMEM itself writes
// (scalars, booleans, inline lists, "- item" lists). Nested YAML maps are not interpreted.
import { VymemError } from './errors.mjs';

function splitInline(inner) {
  const items = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && i + 1 < inner.length) { cur += inner[++i]; continue; }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      items.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) items.push(cur);
  return items.map(unquote).filter(s => s !== '');
}

export function unquote(s) {
  const t = String(s ?? '').trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
}

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { hasFrontmatter: false, rawYaml: '', fields: {}, body: content };
  const rawYaml = match[1];
  const fields = {};
  let listKey = null;
  for (const line of rawYaml.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && listKey) {
      if (!Array.isArray(fields[listKey])) fields[listKey] = [];
      fields[listKey].push(unquote(li[1]));
      continue;
    }
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    listKey = null;
    if (v === '') { fields[k] = []; listKey = k; }
    else if (v.startsWith('[') && v.endsWith(']')) fields[k] = splitInline(v.slice(1, -1));
    else if (v === 'true') fields[k] = true;
    else if (v === 'false') fields[k] = false;
    else fields[k] = unquote(v);
  }
  return { hasFrontmatter: true, rawYaml, fields, body: match[2] };
}

export function formatYamlValue(val) {
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    const items = val.map(v => {
      const s = String(v).trim();
      return /^[a-zA-Z0-9_\/-]+$/.test(s) ? s : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    });
    return `[${items.join(', ')}]`;
  }
  const str = String(val ?? '').replace(/\r?\n/g, ' ').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function serializeFrontmatter(fields) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) lines.push(`${k}: ${formatYamlValue(v)}`);
  lines.push('---');
  return lines.join('\n');
}

// Update or add keys in an existing frontmatter block, keeping the order of untouched keys.
export function patchFrontmatter(raw, patch) {
  if (!patch || !Object.keys(patch).length) return raw;
  for (const key of Object.keys(patch)) {
    if (!/^[A-Za-z0-9_]+$/.test(key)) throw new VymemError('INVALID_FRONTMATTER_KEY', `Invalid frontmatter key '${key}'.`);
  }
  const m = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)([\s\S]*)$/);
  if (!m) {
    const lines = ['---', ...Object.entries(patch).map(([k, v]) => `${k}: ${formatYamlValue(v)}`), '---', ''];
    return lines.join('\n') + raw;
  }
  let yaml = m[2];
  for (const [k, v] of Object.entries(patch)) {
    const line = `${k}: ${formatYamlValue(v)}`;
    const re = new RegExp(`^${k}:.*$`, 'm');
    yaml = re.test(yaml) ? yaml.replace(re, () => line) : `${yaml}\n${line}`;
  }
  return `${m[1]}${yaml}${m[3]}${m[4]}`;
}

export function extractHeadingSection(body, heading) {
  const lines = body.split(/\r?\n/);
  const target = heading.trim().toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m && m[2].trim().toLowerCase() === target) { start = i; level = m[1].length; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}

export function wikiRefs(val) {
  const arr = Array.isArray(val) ? val : (val ? [String(val)] : []);
  return arr.map(x => String(x).replace(/\[\[|\]\]/g, '').split('|')[0].trim()).filter(Boolean);
}

export function isLocked(fields) {
  const t = v => v === true || v === 'true';
  return t(fields.human_locked) || t(fields.manual_override) || t(fields.approved_by_owner);
}

// Fields agents may never set through a proposal patch.
export const PROTECTED_KEYS = new Set([
  'record_id', 'entity_type', 'human_locked', 'manual_override', 'locked_fields',
  'approved_by', 'approved_by_owner', 'applied_at', 'applied_target_sha256', 'sensitivity', 'permitted_access'
]);

export function assertTargetUnlocked(fields, patchKeys = []) {
  const t = v => v === true || v === 'true';
  if (t(fields.human_locked) || t(fields.manual_override)) {
    throw new VymemError('HUMAN_LOCKED', 'Target note is locked by its owner (human_locked / manual_override). Automatic modification is blocked.');
  }
  const hits = patchKeys.filter(k => PROTECTED_KEYS.has(k));
  if (hits.length) {
    throw new VymemError('PROTECTED_FRONTMATTER_KEY', `Cannot set protected governance fields via agent patch: ${hits.join(', ')}`, { protectedFields: hits });
  }
  const locked = Array.isArray(fields.locked_fields)
    ? new Set(fields.locked_fields.map(String))
    : new Set(String(fields.locked_fields || '').replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean));
  const clash = patchKeys.filter(k => locked.has(k));
  if (clash.length) throw new VymemError('LOCKED_FIELDS_CONFLICT', `Cannot update locked frontmatter fields: ${clash.join(', ')}`, { lockedFields: clash });
}
