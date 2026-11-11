// Acceptance cases 11-12: configuration merging and safe, reversible install/uninstall.
// All client config files live under a throwaway home directory; the real home is never touched.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv } from './helpers/env.mjs';
import { MARK } from '../src/clients.mjs';

let e;
beforeEach(() => { e = makeEnv(); });
afterEach(() => e.cleanup());

const p = (...x) => path.join(e.home, ...x);
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const readJ = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const snapshot = () => {
  const out = {};
  const walk = d => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); n.isDirectory() ? walk(f) : (out[f] = fs.readFileSync(f, 'utf8')); } };
  walk(e.home);
  return out;
};
const backups = () => (fs.existsSync(path.join(e.configDir, 'backups')) ? fs.readdirSync(path.join(e.configDir, 'backups')) : []);

test('without --yes install is a dry run and changes nothing', () => {
  const before = snapshot();
  const r = e.run(['install', '--client', 'all', '--mcp', '--hooks']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /DRY RUN/);
  assert.deepEqual(snapshot(), before);
  assert.equal(e.cfg().hooks.enabled, false);
});

test('11. install merges into existing settings and preserves every foreign key', () => {
  write(p('.claude', 'settings.json'), JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep-me' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }] } }, null, 2));
  write(p('.claude.json'), JSON.stringify({ numStartups: 7, mcpServers: { other: { command: 'x' } } }));
  write(p('.codex', 'config.toml'), 'model = "some-model"\n\n[mcp_servers.other]\ncommand = "y"\n');
  write(p('.codex', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo codex-keep' }] }] } }));
  write(p('.gemini', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { six: { command: 'z' } } }));
  write(p('.gemini', 'config', 'hooks.json'), JSON.stringify({ 'someone-elses-hook': { Stop: [] } }));

  const r = e.run(['install', '--client', 'all', '--mcp', '--hooks', '--yes']);
  assert.equal(r.code, 0, r.stderr);

  const settings = readJ(p('.claude', 'settings.json'));
  assert.equal(settings.theme, 'dark');
  assert.deepEqual(settings.permissions.allow, ['Bash(ls)']);
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.Stop.length, 2, 'foreign Stop hook kept, ours appended');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'echo keep-me');
  assert.ok(JSON.stringify(settings.hooks.SessionStart).includes(MARK));
  const cj = readJ(p('.claude.json'));
  assert.equal(cj.numStartups, 7); assert.ok(cj.mcpServers.other); assert.ok(cj.mcpServers.vymem);
  const toml = fs.readFileSync(p('.codex', 'config.toml'), 'utf8');
  assert.match(toml, /^model = "some-model"/); assert.match(toml, /\[mcp_servers\.other\]/); assert.match(toml, /\[mcp_servers\.vymem\]/);
  assert.equal(readJ(p('.codex', 'hooks.json')).hooks.Stop.length, 2);
  assert.ok(readJ(p('.gemini', 'config', 'mcp_config.json')).mcpServers.six);
  assert.ok(readJ(p('.gemini', 'config', 'hooks.json'))['someone-elses-hook']);
  assert.ok(readJ(p('.gemini', 'config', 'hooks.json')).vymem.PreInvocation);
  assert.equal(e.cfg().hooks.enabled, true, 'hook registration switches hooks.enabled on');
  assert.ok(backups().length >= 5, 'every modified file was backed up first');
});

test('install is idempotent: a second run changes nothing and creates no new backups', () => {
  write(p('.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }));
  assert.equal(e.run(['install', '--client', 'claude,codex,antigravity', '--mcp', '--hooks', '--yes']).code, 0);
  const snap = snapshot(); const nb = backups().length;
  const again = e.run(['install', '--client', 'claude,codex,antigravity', '--mcp', '--hooks', '--yes']);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /already up to date/);
  assert.doesNotMatch(again.stdout, / changed/);
  assert.deepEqual(snapshot(), snap);
  assert.equal(backups().length, nb);
});

test('12. uninstall removes only VYMEM entries and restores foreign content exactly', () => {
  const original = { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep-me' }] }] } };
  write(p('.claude', 'settings.json'), JSON.stringify(original, null, 2));
  write(p('.claude.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
  write(p('.codex', 'config.toml'), 'model = "m"\n');
  e.run(['install', '--client', 'claude,codex', '--mcp', '--hooks', '--yes']);
  const un = e.run(['uninstall', '--client', 'claude,codex', '--yes']);
  assert.equal(un.code, 0, un.stderr);
  assert.deepEqual(readJ(p('.claude', 'settings.json')), original);
  assert.deepEqual(readJ(p('.claude.json')).mcpServers, { other: { command: 'x' } });
  const toml = fs.readFileSync(p('.codex', 'config.toml'), 'utf8');
  assert.equal(toml.trim(), 'model = "m"');
  assert.ok(!fs.readFileSync(p('.codex', 'hooks.json'), 'utf8').includes(MARK));
  assert.equal(e.cfg().hooks.enabled, false);
  assert.ok(fs.existsSync(e.vaultDir), 'uninstall never touches the vault');
  assert.ok(fs.existsSync(path.join(e.vaultDir, 'Welcome to VYMEM.md')));
});

test('uninstall leaves a same-named entry that VYMEM did not create', () => {
  write(p('.claude.json'), JSON.stringify({ mcpServers: { vymem: { command: 'someone-elses-tool' } } }));
  const r = e.run(['install', '--client', 'claude', '--mcp', '--yes']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /FOREIGN_ENTRY_CONFLICT/);
  assert.equal(e.run(['uninstall', '--client', 'claude', '--yes']).code, 0);
  assert.deepEqual(readJ(p('.claude.json')).mcpServers.vymem, { command: 'someone-elses-tool' });
});

test('invalid existing JSON is never overwritten', () => {
  write(p('.claude', 'settings.json'), '{ this is not json');
  const r = e.run(['install', '--client', 'claude', '--hooks', '--yes']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /INVALID_CLIENT_CONFIG/);
  assert.equal(fs.readFileSync(p('.claude', 'settings.json'), 'utf8'), '{ this is not json');
});

test('a hand-written [mcp_servers.vymem] TOML table outside our block is not overwritten', () => {
  write(p('.codex', 'config.toml'), '[mcp_servers.vymem]\ncommand = "mine"\n');
  const r = e.run(['install', '--client', 'codex', '--mcp', '--yes']);
  assert.equal(r.code, 1);
  assert.match(fs.readFileSync(p('.codex', 'config.toml'), 'utf8'), /command = "mine"/);
});

test('configuration merging: init keeps prior settings, config set validates', () => {
  assert.equal(e.run(['config', 'set', 'workspaces.maxDepth', '5']).code, 0);
  assert.equal(e.run(['init', '--vault', e.vaultDir, '--workspace', path.join(e.tmp, 'second-root')]).code, 0);
  const cfg = e.cfg();
  assert.equal(cfg.workspaces.maxDepth, 5, 'earlier setting preserved');
  assert.equal(cfg.workspaces.roots.length, 2, 'workspace roots merged');
  assert.equal(cfg.clients.claude.enabled, true);
  const bad = e.run(['config', 'set', 'mcp.permission', '"full"']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /INVALID_CONFIG/);
  assert.equal(e.cfg().mcp.permission, 'propose');
});

test('the registered hook command line actually runs through the platform shell and exits 0', async () => {
  const cp = await import('node:child_process');
  assert.equal(e.run(['install', '--client', 'claude', '--hooks', '--yes']).code, 0);
  const cmd = readJ(p('.claude', 'settings.json')).hooks.SessionStart[0].hooks[0].command;
  assert.match(cmd, /hook claude SessionStart/);
  const r = cp.spawnSync(cmd, { shell: true, input: JSON.stringify({ session_id: 's', cwd: e.tmp }), encoding: 'utf8', env: e.env, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  if (process.platform === 'win32') {
    const bash = cp.spawnSync('bash', ['-c', cmd], { input: '{}', encoding: 'utf8', env: e.env, timeout: 20000 });
    if (!bash.error) assert.equal(bash.status, 0, 'also valid when the client runs hooks through a POSIX shell: ' + bash.stderr);
  }
});
