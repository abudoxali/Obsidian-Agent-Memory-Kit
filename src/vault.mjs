// Vault: the single gateway for every filesystem path VYMEM touches inside the Obsidian vault.
// Path policy lives here: relative paths only, no traversal, no symlink escape, blocked folders,
// read allowlist, markdown only, and writes confined to explicit areas.
import fs from 'node:fs';
import path from 'node:path';
import { VymemError } from './errors.mjs';
import { makeScanner } from './secrets.mjs';
import { sha256, writeFileAtomic, readJson, writeJsonAtomic, withLockSync } from './fsutil.mjs';

const WIN = process.platform === 'win32';
const cmp = s => (WIN || process.platform === 'darwin' ? s.toLowerCase() : s);
const insideOrEqual = (root, p) => cmp(p) === cmp(root) || cmp(p).startsWith(cmp(root) + path.sep);

export function normalizeRelPath(input) {
  if (typeof input !== 'string' || !input.trim()) throw new VymemError('INVALID_PATH', 'Path must be a non-empty string.');
  if (/[\x00-\x1f]/.test(input)) throw new VymemError('INVALID_PATH', 'Path contains control characters.');
  const cleaned = input.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned) || cleaned.startsWith('file:')) {
    throw new VymemError('PATH_OUTSIDE_ALLOWLIST', 'Absolute, UNC and URI paths are rejected; pass a vault-relative path.');
  }
  const parts = cleaned.split('/').filter(Boolean);
  if (!parts.length || parts.some(p => p === '.' || p === '..')) throw new VymemError('PATH_TRAVERSAL_BLOCKED', 'Path traversal segments are rejected.');
  if (parts.some(p => /[<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw new VymemError('INVALID_PATH', 'Path segment contains characters or a file name that is invalid or reserved on some file systems.');
  }
  return parts.join('/');
}

export class Vault {
  constructor(cfg) {
    this.cfg = cfg;
    if (!fs.existsSync(cfg.vault.path) || !fs.statSync(cfg.vault.path).isDirectory()) {
      throw new VymemError('VAULT_NOT_FOUND', `Vault directory does not exist: ${cfg.vault.path}`);
    }
    this.root = fs.realpathSync(cfg.vault.path);
    this.folders = cfg.vault.folders;
    this.stateRel = cfg.vault.stateDir;
    this.stateDir = path.join(this.root, ...this.stateRel.split('/'));
    this.scanner = makeScanner(cfg.privacy.extraSecretPatterns);
    this.blocked = cfg.privacy.blockedFolders.map(b => normalizeRelPath(b).toLowerCase());
    this.readable = (cfg.vault.readableFolders || []).map(r => normalizeRelPath(r).toLowerCase());
  }

  isBlocked(relLower) {
    return this.blocked.some(b => relLower === b || relLower.startsWith(b + '/'));
  }

  // Resolve a vault-relative path for reading or for an explicitly allowed write.
  resolve(relInput, { forWrite = false, exts = ['.md'] } = {}) {
    const rel = normalizeRelPath(relInput);
    const low = rel.toLowerCase();
    const segs = low.split('/');
    if (segs.some(s => s.startsWith('.')) || segs.includes('node_modules')) {
      throw new VymemError('FORBIDDEN_PATH', `Access to internal or hidden path '${rel}' is forbidden.`);
    }
    if (this.isBlocked(low)) throw new VymemError('BLOCKED_FOLDER', `Folder is blocked by privacy.blockedFolders: '${rel}'.`);
    if (rel.includes('/')) {
      if (this.readable.length && !this.readable.includes(segs[0])) {
        throw new VymemError('PATH_OUTSIDE_ALLOWLIST', `Folder '${rel.split('/')[0]}' is not in vault.readableFolders.`);
      }
    } else if (forWrite) {
      throw new VymemError('UNAUTHORIZED_WRITE', 'Direct writes to vault root files are forbidden.');
    }
    const ext = path.extname(rel).toLowerCase();
    if (!exts.includes(ext)) throw new VymemError('UNSUPPORTED_EXTENSION', `Unsupported extension '${ext || '(none)'}'. Allowed: ${exts.join(', ')}`);
    const abs = path.resolve(this.root, ...rel.split('/'));
    if (!insideOrEqual(this.root, abs)) throw new VymemError('PATH_TRAVERSAL_BLOCKED', 'Resolved path escapes the vault.');
    this.#realpathCheck(abs);
    return { rel, abs };
  }

  #realpathCheck(abs) {
    let cur = abs;
    while (!fs.existsSync(cur)) {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    const real = fs.realpathSync(cur);
    if (!insideOrEqual(this.root, real)) throw new VymemError('SYMLINK_ESCAPE_BLOCKED', 'A path component resolves outside the vault.');
    if (fs.existsSync(abs) && fs.lstatSync(abs).isSymbolicLink() && !insideOrEqual(this.root, fs.realpathSync(abs))) {
      throw new VymemError('SYMLINK_ESCAPE_BLOCKED', 'Symlink target escapes the vault.');
    }
  }

  // List readable markdown files, optionally limited to folders.
  collectMarkdown(folderFilter = null) {
    const roots = (folderFilter && folderFilter.length ? folderFilter.map(f => normalizeRelPath(f)) : [''])
      .map(f => ({ rel: f, low: f.toLowerCase() }));
    for (const r of roots) {
      if (r.rel && (this.isBlocked(r.low) || r.low.split('/').some(s => s.startsWith('.')))) {
        throw new VymemError('FORBIDDEN_PATH', `Folder '${r.rel}' cannot be searched.`);
      }
    }
    const out = new Map();
    const walk = (dirRel) => {
      const abs = path.join(this.root, ...(dirRel ? dirRel.split('/') : []));
      let entries;
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
        const low = rel.toLowerCase();
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          if (this.isBlocked(low)) continue;
          if (!dirRel && this.readable.length && !this.readable.includes(low)) continue;
          walk(rel);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          if (!dirRel && this.readable.length) continue;
          out.set(rel, { rel, abs: path.join(abs, e.name) });
        }
      }
    };
    for (const r of roots) walk(r.rel);
    return [...out.values()].sort((a, b) => a.rel.localeCompare(b.rel));
  }

  read(rel) {
    const r = this.resolve(rel);
    if (!fs.existsSync(r.abs)) throw new VymemError('NOT_FOUND', `Note not found: ${r.rel}`);
    return { ...r, raw: fs.readFileSync(r.abs, 'utf8') };
  }

  // ---- state, audit, backups
  statePath(...parts) { return path.join(this.stateDir, ...parts); }

  audit(entry) {
    fs.mkdirSync(this.stateDir, { recursive: true });
    fs.appendFileSync(this.statePath('audit-log.jsonl'), JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  }

  loadState(name, fallback) { return readJson(this.statePath(name), fallback); }
  saveState(name, obj) { writeJsonAtomic(this.statePath(name), obj); }
  withLock(name, fn) { return withLockSync(this.statePath(`${name}.lock`), fn); }

  // Back up the existing file (if any) into <state>/backups/<day>/ and write atomically.
  backupAndWrite(abs, rel, content) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let backupRel = null;
    if (fs.existsSync(abs)) {
      const dir = this.statePath('backups', stamp.slice(0, 10));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${rel.replace(/[\\/]/g, '__')}.${stamp}.bak`);
      fs.copyFileSync(abs, file);
      backupRel = path.relative(this.root, file).replace(/\\/g, '/');
    }
    writeFileAtomic(abs, content);
    return { backupRel, sha256: sha256(content) };
  }

  // Restore a file from a backup produced by backupAndWrite (operator-only; not exposed via MCP).
  rollback(backupRel, targetRel) {
    const bRel = normalizeRelPath(backupRel);
    if (!bRel.toLowerCase().startsWith(`${this.stateRel.toLowerCase()}/backups/`)) {
      throw new VymemError('FORBIDDEN_PATH', 'Backup path must be inside the VYMEM backups directory.');
    }
    const bAbs = path.resolve(this.root, ...bRel.split('/'));
    if (!fs.existsSync(bAbs)) throw new VymemError('BACKUP_NOT_FOUND', `Backup not found: ${bRel}`);
    if (!insideOrEqual(this.statePath('backups'), fs.realpathSync(bAbs))) throw new VymemError('SYMLINK_ESCAPE_BLOCKED', 'Backup escapes backup directory.');
    const t = this.resolve(targetRel, { forWrite: true });
    const w = this.backupAndWrite(t.abs, t.rel, fs.readFileSync(bAbs, 'utf8'));
    return { status: 'ROLLED_BACK_WITH_PRE_RESTORE_BACKUP', restored_from: bRel, target_path: t.rel, pre_rollback_backup: w.backupRel, restored_sha256: w.sha256 };
  }
}
