// Shared test fixtures: a throwaway home, vault, config and git repositories.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/config.mjs';
import { Vault } from '../../src/vault.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI = path.join(ROOT, 'bin', 'vymem.mjs');

export function runCliIn(env, args, { input, cwd } = {}) {
  const r = cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input, cwd: cwd || env.tmp, env: env.env, timeout: 30000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function makeEnv({ init = true, clients = 'claude,codex,antigravity' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vymem-test-'));
  const home = path.join(tmp, 'home');
  const configDir = path.join(tmp, 'cfg');
  const vaultDir = path.join(tmp, 'vault');
  const ws = path.join(tmp, 'workspace');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_OPTIONS: process.env.NODE_OPTIONS, VYMEM_TEST_DENY: process.env.VYMEM_TEST_DENY,
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'), XDG_CONFIG_HOME: path.join(home, '.config'),
    VYMEM_CONFIG_DIR: configDir, VYMEM_CLIENT_HOME: home
  };
  const e = { tmp, home, configDir, vaultDir, ws, env, configPath: path.join(configDir, 'config.json'),
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
    run: (args, opts) => runCliIn(e, args, opts),
    cfg: () => loadConfig(e.configPath), vault: () => new Vault(e.cfg()) };
  if (init) {
    const r = e.run(['init', '--vault', vaultDir, '--clients', clients, '--workspace', ws]);
    if (r.code !== 0) throw new Error(`init failed: ${r.stderr}`);
  }
  return e;
}

const GIT_ID = ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false'];
export function git(cwd, ...args) {
  return cp.execFileSync('git', [...GIT_ID, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function makeRepo(dir, { files = { 'README.md': '# demo\n' }, remote } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return git(dir, 'rev-parse', 'HEAD');
}
export function commitFile(dir, file, content, msg = 'change') {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

export function writeNote(vault, rel, text) {
  const abs = path.join(vault.root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
  return abs;
}

export const handoffArgs = (over = {}) => ({
  record_id: 'handoff-demo-1', title: 'Handoff: demo', category: 'agent_handoff', body: 'Refactored the retry logic.',
  summary: 'Retry logic refactored', source_system: 'test_system', source_reference: 'test:1', owner_agent: 'Agent A',
  handoff: { project_identifier: 'Billing Service', originating_agent: 'Agent A', task_objective: 'Fix retries', actual_completed_work: 'Edited retry.js',
    verification_evidence: 'npm test -> exit 0', suggested_next_action: 'Review retry.js', knowledge_confidence: 'verified_partial' },
  ...over
});

// Fake credentials are assembled at runtime so that this repository never contains a literal secret.
export const fakeKey = () => 'sk-' + 'Zq'.repeat(16);
export const fakeGithubToken = () => 'ghp_' + 'A1'.repeat(15);
