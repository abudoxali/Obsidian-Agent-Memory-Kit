// SPDX-License-Identifier: Apache-2.0
// Configuration: defaults, validation, load/save, and the user-level config location.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VymemError } from './errors.mjs';
import { writeFileAtomic, readJson } from './fsutil.mjs';

export const CONFIG_VERSION = 1;

export const DEFAULT_CONFIG = Object.freeze({
  version: CONFIG_VERSION,
  vault: {
    path: '',
    folders: {
      projects: 'Projects',
      decisions: 'Decisions',
      memory: 'Agent Memory',
      inbox: 'Inbox/AI Inbox',
      proposals: 'Inbox/Update Proposals',
      reference: 'Reference'
    },
    // Optional allowlist of top-level folders agents may read. Empty = everything not blocked.
    readableFolders: [],
    stateDir: '.vymem'
  },
  workspaces: {
    roots: [],
    exclude: ['node_modules', '.git', 'dist', 'build', 'target', '.venv', 'venv', '__pycache__', '.next', 'vendor'],
    maxDepth: 3
  },
  clients: {
    claude: { enabled: false },
    codex: { enabled: false },
    antigravity: { enabled: false }
  },
  mcp: { serverName: 'vymem', permission: 'propose' },
  hooks: {
    enabled: false,
    briefingMaxChars: 3500,
    captureEnabled: true,
    minWriteIntervalSeconds: 30
  },
  privacy: {
    blockedFolders: ['Private'],
    extraSecretPatterns: [],
    recordAbsolutePaths: false
  },
  retention: { backupsDays: 90, auditDays: 365, sessionLedgerDays: 14 },
  sentinel: { enabled: false, intervalMinutes: 60 },
  search: { synonyms: [] }
});

export function defaultConfigDir(env = process.env) {
  if (env.VYMEM_CONFIG_DIR) return path.resolve(env.VYMEM_CONFIG_DIR);
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'vymem');
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'vymem');
}

export function resolveConfigPath({ flag, env = process.env } = {}) {
  if (flag) return path.resolve(flag);
  if (env.VYMEM_CONFIG) return path.resolve(env.VYMEM_CONFIG);
  return path.join(defaultConfigDir(env), 'config.json');
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

export function validateConfig(cfg) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(msg); };
  need(isObj(cfg), 'config must be an object');
  if (!isObj(cfg)) return problems;
  need(cfg.version === CONFIG_VERSION, `version must be ${CONFIG_VERSION}`);
  need(typeof cfg.vault?.path === 'string' && cfg.vault.path.length > 0, 'vault.path is required');
  for (const [k, v] of Object.entries(cfg.vault?.folders || {})) {
    need(typeof v === 'string' && v.length > 0, `vault.folders.${k} must be a non-empty string`);
    need(!path.isAbsolute(String(v)) && !String(v).split(/[\\/]/).includes('..'), `vault.folders.${k} must be a relative path without '..'`);
  }
  need(['read', 'propose'].includes(cfg.mcp?.permission), "mcp.permission must be 'read' or 'propose' ('full' is intentionally unsupported)");
  need(Array.isArray(cfg.workspaces?.roots), 'workspaces.roots must be an array');
  need(Number.isInteger(cfg.workspaces?.maxDepth) && cfg.workspaces.maxDepth >= 0 && cfg.workspaces.maxDepth <= 8, 'workspaces.maxDepth must be an integer 0-8');
  need(Array.isArray(cfg.privacy?.blockedFolders), 'privacy.blockedFolders must be an array');
  for (const r of ['backupsDays', 'auditDays', 'sessionLedgerDays']) {
    need(Number.isInteger(cfg.retention?.[r]) && cfg.retention[r] >= 1, `retention.${r} must be a positive integer`);
  }
  need(/^[A-Za-z0-9._-]+$/.test(cfg.mcp?.serverName || ''), 'mcp.serverName must match [A-Za-z0-9._-]+');
  return problems;
}

export function normalizeConfig(raw) {
  const cfg = deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), raw || {});
  const problems = validateConfig(cfg);
  if (problems.length) throw new VymemError('INVALID_CONFIG', `Invalid VYMEM configuration: ${problems.join('; ')}`, { problems });
  cfg.vault.path = path.resolve(cfg.vault.path);
  cfg.workspaces.roots = cfg.workspaces.roots.map(r => path.resolve(String(r)));
  return cfg;
}

export function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new VymemError('CONFIG_NOT_FOUND', `No VYMEM config at ${configPath}. Run 'vymem init --vault <path>' first.`, { configPath });
  }
  const raw = readJson(configPath, null);
  if (raw === null) throw new VymemError('INVALID_CONFIG', `Config file is not valid JSON: ${configPath}`);
  const cfg = normalizeConfig(raw);
  Object.defineProperty(cfg, '_path', { value: configPath, enumerable: false });
  return cfg;
}

export function saveConfig(configPath, cfg) {
  const plain = JSON.parse(JSON.stringify(cfg));
  const problems = validateConfig(plain);
  if (problems.length) throw new VymemError('INVALID_CONFIG', `Refusing to save invalid config: ${problems.join('; ')}`, { problems });
  writeFileAtomic(configPath, JSON.stringify(plain, null, 2) + '\n');
}

export function getByPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setByPath(obj, dotted, value) {
  const keys = dotted.split('.');
  if (keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new VymemError('INVALID_ARGUMENTS', 'Forbidden config key.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}
