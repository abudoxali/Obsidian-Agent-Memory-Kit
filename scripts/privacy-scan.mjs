// Release gate: scans every file in the working tree (and optionally the git history / index) for
// personal identifiers, private paths, credentials, hostnames/IPs and image metadata.
// Usage: node scripts/privacy-scan.mjs [--history]   (exit code 1 on any finding)
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUILTIN_SECRET_PATTERNS } from '../src/secrets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const TEXT_EXT = new Set(['.md', '.mjs', '.js', '.json', '.yml', '.yaml', '.svg', '.txt', '.toml', '.gitignore', '.html', '.css', '']);

// Words that identify the original private deployment or its owner's environment.
const FORBIDDEN = [
  { label: 'original deployment name', re: /\babud\b|abud[-_ ]?knowledge/i, allow: ['README.md', 'docs/showcase/', 'docs/brand/', 'STATUS.md', 'scripts/privacy-scan.mjs', 'docs/compatibility.md', 'docs/architecture.md'] },
  { label: 'Windows user profile path', re: /[A-Za-z]:[\\/]+Users[\\/]+(?!user\b|you\b|me\b|<)[^\\/\s"']+/i },
  { label: 'macOS/Linux home path', re: /(?:\/Users|\/home)\/(?!user\b|you\b|me\b|runner\b|name\b|<)[A-Za-z0-9._-]+\//i },
  { label: 'original vault path', re: /Obsidian Vault[\\/]/ },
  { label: 'Arabic text (original vault used Arabic folder names)', re: new RegExp('[' + String.fromCharCode(0x600) + '-' + String.fromCharCode(0x6ff) + ']'), allow: ['docs/brand/'] },
  { label: 'email address', re: /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org|invalid)\b|users\.noreply\.github\.com\b|anthropic\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { label: 'IPv4 address', re: /\b(?!127\.0\.0\.1\b|0\.0\.0\.0\b)(?:\d{1,3}\.){3}\d{1,3}\b(?!\.\d)/, skipFiles: ['package.json'], ipFilter: true },
  { label: 'ngrok/tailscale/internal hostname', re: /\b[\w-]+\.(?:ngrok(?:-free)?\.(?:app|io)|ts\.net|internal|corp|lan|local)\b/i }
];

const isAllowed = (rel, allow = []) => allow.some(a => rel === a || rel.startsWith(a));
const validIp = s => s.split('.').every(n => Number(n) <= 255);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

export function scanPng(buf) {
  const findings = [];
  if (buf.length < 8 || buf.subarray(1, 4).toString() !== 'PNG') return findings;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.subarray(off + 4, off + 8).toString('latin1');
    if (['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(type)) findings.push(`PNG metadata chunk ${type}`);
    off += 12 + len;
  }
  return findings;
}

export function scanTree(root = ROOT) {
  const findings = [];
  const add = (file, label, sample) => findings.push({ file: path.relative(root, file).replace(/\\/g, '/'), label, sample: String(sample).slice(0, 60) });
  for (const file of walk(root)) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const ext = path.extname(file).toLowerCase();
    if (/\.(png|jpe?g|webp|gif)$/i.test(file)) {
      const buf = fs.readFileSync(file);
      for (const f of scanPng(buf)) add(file, f, '');
      if (/\.jpe?g$/i.test(file) && buf.includes(Buffer.from('Exif'))) add(file, 'EXIF metadata in JPEG', '');
      continue;
    }
    if (!TEXT_EXT.has(ext) && !fs.readFileSync(file).subarray(0, 512).every(b => b !== 0)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const f of FORBIDDEN) {
      if (isAllowed(rel, f.allow) || (f.skipFiles || []).includes(rel)) continue;
      const m = text.match(new RegExp(f.re.source, f.re.flags.replace('g', '') + 'g'));
      if (!m) continue;
      const hits = f.ipFilter ? m.filter(validIp) : m;
      if (hits.length) add(file, f.label, hits[0]);
    }
    for (const p of BUILTIN_SECRET_PATTERNS) { const m = text.match(p.re); if (m) add(file, `credential pattern: ${p.label}`, '[redacted]'); }
    if (ext === '.svg' && /<metadata|file:\/\/|inkscape:|sodipodi:/i.test(text)) add(file, 'SVG metadata or local reference', '');
  }
  return findings;
}

export function scanHistory(root = ROOT) {
  const findings = [];
  const run = args => { try { return cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); } catch { return ''; } };
  if (!run(['rev-parse', 'HEAD']).trim()) return findings;
  const log = run(['log', '--all', '-p', '--no-color', '--', '.', ':!docs/brand']);
  for (const f of FORBIDDEN) {
    if (f.label === 'original deployment name') continue; // allowed in specific docs; checked on the working tree
    const m = log.match(new RegExp(f.re.source, f.re.flags.replace('g', '') + 'g'));
    const hits = m ? (f.ipFilter ? m.filter(validIp) : m) : [];
    if (hits.length) findings.push({ file: '(git history)', label: f.label, sample: hits[0].slice(0, 60) });
  }
  for (const p of BUILTIN_SECRET_PATTERNS) if (p.re.test(log)) findings.push({ file: '(git history)', label: `credential pattern: ${p.label}`, sample: '[redacted]' });
  const names = run(['log', '--all', '--name-only', '--pretty=format:']).split('\n').filter(Boolean);
  for (const n of new Set(names)) if (/\.(png|jpe?g|gif|webp)$/i.test(n) && /raw|source|original|staging/i.test(n)) findings.push({ file: n, label: 'suspicious raw image path in history', sample: '' });
  return findings;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = [...scanTree(), ...(process.argv.includes('--history') ? scanHistory() : [])];
  if (f.length) {
    console.error(`PRIVACY SCAN FAILED: ${f.length} finding(s)`);
    for (const x of f) console.error(` - ${x.file}: ${x.label}${x.sample ? ` ("${x.sample}")` : ''}`);
    process.exit(1);
  }
  console.log(`privacy scan: clean (${process.argv.includes('--history') ? 'working tree + git history' : 'working tree'})`);
}
