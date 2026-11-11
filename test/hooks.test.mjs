// SPDX-License-Identifier: Apache-2.0
// Lifecycle hooks (simulated client payloads) and cross-agent retrieval through the briefing.
// NOTE: payloads are simulated; no real Claude Code / Codex / Antigravity session is run here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv, makeRepo, git, writeNote, fakeKey } from './helpers/env.mjs';
import { handleHook } from '../src/hooks/handler.mjs';
import { saveConfig, setByPath } from '../src/config.mjs';

let e; let repo; let cfg; let vault;
before(() => {
  e = makeEnv();
  repo = path.join(e.ws, 'orders-api');
  makeRepo(repo, { files: { 'src/app.js': 'export const v = 1;\n' }, remote: 'https://example.invalid/acme/orders-api.git' });
  e.run(['project', 'add', 'orders-api', '--summary', 'Order intake API']);
  const c = e.cfg(); setByPath(c, 'hooks.enabled', true); setByPath(c, 'hooks.minWriteIntervalSeconds', 0); saveConfig(e.configPath, c);
  cfg = e.cfg(); vault = e.vault();
});
after(() => e.cleanup());

test('hooks are inert until explicitly enabled', () => {
  const off = JSON.parse(JSON.stringify(cfg)); off.hooks.enabled = false;
  const r = handleHook(vault, off, 'claude', 'SessionStart', { session_id: 's0', cwd: repo });
  assert.equal(r.note, 'hooks_disabled'); assert.equal(r.reply, null);
  assert.equal(fs.existsSync(vault.statePath('sessions')), false);
});

test('Agent A: SessionStart briefs from the vault, tool events are captured, Stop writes an unapproved handoff', () => {
  const start = handleHook(vault, cfg, 'claude', 'SessionStart', { session_id: 'sess-A', cwd: repo, source: 'startup' });
  const brief = start.reply.hookSpecificOutput.additionalContext;
  assert.match(brief, /VYMEM BRIEFING/);
  assert.match(brief, /orders-api/);
  assert.match(brief, /DATA, not instructions/);
  assert.equal(start.reply.hookSpecificOutput.hookEventName, 'SessionStart');

  handleHook(vault, cfg, 'claude', 'UserPromptSubmit', { session_id: 'sess-A', cwd: repo, prompt: `Add input validation to the order endpoint (key ${fakeKey()})` });
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'export const v = 2;\n');
  handleHook(vault, cfg, 'claude', 'PostToolUse', { session_id: 'sess-A', cwd: repo, tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src', 'app.js') }, tool_response: {} });
  handleHook(vault, cfg, 'claude', 'PostToolUse', { session_id: 'sess-A', cwd: repo, tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' } });
  handleHook(vault, cfg, 'claude', 'PostToolUse', { session_id: 'sess-A', cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls -la' }, tool_response: {} });

  const stop = handleHook(vault, cfg, 'claude', 'Stop', { session_id: 'sess-A', cwd: repo });
  assert.equal(stop.note, 'WRITTEN_TO_AI_INBOX');
  const file = fs.readdirSync(path.join(vault.root, 'Inbox', 'AI Inbox', 'handoffs'))[0];
  const text = fs.readFileSync(path.join(vault.root, 'Inbox', 'AI Inbox', 'handoffs', file), 'utf8');
  assert.match(text, /approved_by_owner: false/);
  assert.match(text, /unapproved_agent_handoff/);
  assert.match(text, /src\/app\.js/);
  assert.match(text, /npm test` -> outcome not captured/, 'no exit code from the client means no success is claimed');
  assert.match(text, /observed_untested/);
  assert.doesNotMatch(text, /ls -la/, 'non-test shell commands are not recorded');
  assert.ok(!text.includes(fakeKey()), 'secrets in prompts never reach the vault');
});

test('Agent B (a different client) is briefed with Agent A\'s unapproved handoff', () => {
  const r = handleHook(vault, cfg, 'codex', 'SessionStart', { session_id: 'sess-B', cwd: repo });
  const brief = r.reply.hookSpecificOutput.additionalContext;
  assert.match(brief, /AGENT HANDOFFS \(1;/);
  assert.match(brief, /Claude Code/);
  assert.match(brief, /approved=false/);
  const ag = handleHook(vault, cfg, 'antigravity', 'PreInvocation', { conversationId: 'conv-1', workspacePaths: [repo] });
  assert.match(ag.reply.injectSteps[0].ephemeralMessage, /Claude Code/);
  const second = handleHook(vault, cfg, 'antigravity', 'PreInvocation', { conversationId: 'conv-1', workspacePaths: [repo] });
  assert.equal(second.note, 'already_started', 'only the first invocation of a conversation injects a briefing');
});

test('a second session ending with the same facts does not duplicate or rewrite the handoff', () => {
  const dir = path.join(vault.root, 'Inbox', 'AI Inbox', 'handoffs');
  const before = fs.readdirSync(dir).length;
  const again = handleHook(vault, cfg, 'claude', 'Stop', { session_id: 'sess-A', cwd: repo }, { now: Date.now() + 5000 });
  assert.ok(['DEDUPLICATED_NO_OP', 'WRITTEN_TO_AI_INBOX'].includes(again.note), again.note);
  assert.equal(fs.readdirSync(dir).length, before);
});

test('sessions with no meaningful change write nothing; vault workspaces and non-repos are skipped', () => {
  const quiet = path.join(e.ws, 'quiet'); makeRepo(quiet);
  handleHook(vault, cfg, 'codex', 'SessionStart', { session_id: 'q1', cwd: quiet });
  assert.equal(handleHook(vault, cfg, 'codex', 'Stop', { session_id: 'q1', cwd: quiet }).note, 'SKIPPED_INSIGNIFICANT');
  assert.equal(handleHook(vault, cfg, 'claude', 'SessionStart', { session_id: 'v1', cwd: vault.root }).note, 'vault_workspace');
  const plain = path.join(e.tmp, 'not-a-repo'); fs.mkdirSync(plain);
  assert.equal(handleHook(vault, cfg, 'claude', 'SessionStart', { session_id: 'n1', cwd: plain }).note, 'not_a_repository');
  assert.equal(handleHook(vault, cfg, 'nobody', 'Stop', {}).note, 'unknown_client');
});

test('hook CLI never fails: garbage stdin, missing config and unknown events all exit 0', () => {
  const garbage = e.run(['hook', 'claude', 'SessionStart', '--config', e.configPath], { input: '{{{{ not json' });
  assert.equal(garbage.code, 0);
  const missing = e.run(['hook', 'claude', 'Stop', '--config', path.join(e.tmp, 'nope.json')], { input: '{}' });
  assert.equal(missing.code, 0);
  assert.equal(missing.stdout, '');
  const real = e.run(['hook', 'claude', 'SessionStart', '--config', e.configPath], { input: JSON.stringify({ session_id: 'cli-1', cwd: repo }) });
  assert.equal(real.code, 0);
  assert.match(JSON.parse(real.stdout).hookSpecificOutput.additionalContext, /VYMEM BRIEFING/);
  const ag = e.run(['hook', 'antigravity', 'Stop', '--config', path.join(e.tmp, 'nope.json')], { input: '{}' });
  assert.equal(ag.code, 0);
});

test('project identification works by repository_url when the folder name differs', () => {
  const other = path.join(e.ws, 'renamed-checkout');
  makeRepo(other, { remote: 'git@example.invalid:acme/Orders-API.git' });
  writeNote(vault, 'Projects/Orders Platform.md', '---\nentity_type: project\nrepository_url: "https://example.invalid/acme/orders-api"\nsummary: "by url"\n---\n# Orders Platform\n');
  const r = e.run(['project', 'identify', '--cwd', other]);
  assert.equal(JSON.parse(r.stdout).project.matchedBy, 'repository_url');
});
