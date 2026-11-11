// Acceptance cases 13-14: freshness detection and optional Sentinel operation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv, makeRepo, commitFile, writeNote } from './helpers/env.mjs';
import { inspectFreshness } from '../src/project.mjs';
import { sha256 } from '../src/fsutil.mjs';

let e; let repo; let head0;
before(() => {
  e = makeEnv();
  repo = path.join(e.ws, 'inventory');
  head0 = makeRepo(repo, { files: { 'STATUS.md': '# Status\nAll good.\n' } });
  writeNote(e.vault(), 'Projects/inventory.md', `---\nentity_type: project\nlocal_path: "${repo.replace(/\\/g, '/')}"\ngit_commit: "${head0.slice(0, 10)}"\nlast_verified: 2999-01-01\nsummary: "Inventory service"\n---\n# inventory\n`);
  makeRepo(path.join(e.ws, 'unmapped-tool'));
});
after(() => e.cleanup());

test('13. freshness: in sync at the recorded commit, stale after the repository moves on', () => {
  const fm = { local_path: repo, git_commit: head0.slice(0, 10), last_verified: '2999-01-01' };
  assert.equal(inspectFreshness(repo, fm).freshness_status, 'in_sync_or_not_comparable');
  commitFile(repo, 'feature.txt', 'x', 'add feature');
  const stale = inspectFreshness(repo, fm);
  assert.equal(stale.freshness_status, 'potentially_stale');
  assert.ok(stale.signals.includes('repo_head_differs_from_note'));
  const out = JSON.parse(e.run(['freshness']).stdout);
  assert.equal(out.find(r => r.repository === 'inventory').freshness, 'potentially_stale');
  assert.equal(out.find(r => r.repository === 'unmapped-tool').freshness, 'unmapped');
});

test('13b. freshness: STATUS.md changes are detected via recorded hash and mtime', () => {
  const dir = path.join(e.ws, 'statusrepo'); makeRepo(dir, { files: { 'STATUS.md': '# s\nfirst\n' } });
  const first = sha256('# s\nfirst\n').slice(0, 12);
  assert.ok(!inspectFreshness(dir, { status_md_sha256: first }).signals.includes('status_md_changed_since_note'));
  fs.writeFileSync(path.join(dir, 'STATUS.md'), '# s\nsecond NOT VERIFIED\n');
  const r = inspectFreshness(dir, { status_md_sha256: first });
  assert.ok(r.signals.includes('status_md_changed_since_note'));
  assert.ok(r.signals.includes('status_md_reports_unverified_items'));
  assert.equal(inspectFreshness(path.join(e.tmp, 'missing'), {}).status, 'local_path_missing');
});

test('14. sentinel is disabled by default, and only writes a draft snapshot once enabled', () => {
  const off = e.run(['sentinel', 'run']);
  assert.equal(off.code, 1);
  assert.match(off.stderr, /SENTINEL_DISABLED/);
  assert.equal(fs.existsSync(path.join(e.vaultDir, 'Inbox', 'AI Inbox', 'sentinel')), false);

  const projectNote = path.join(e.vaultDir, 'Projects', 'inventory.md');
  const before = fs.readFileSync(projectNote, 'utf8');
  assert.equal(e.run(['config', 'set', 'sentinel.enabled', 'true']).code, 0);
  const run1 = e.run(['sentinel', 'run']);
  assert.equal(run1.code, 0, run1.stderr);
  const res = JSON.parse(run1.stdout);
  assert.equal(res.record, 'WRITTEN_TO_AI_INBOX');
  assert.ok(res.repos >= 3);
  const snap = fs.readFileSync(path.join(e.vaultDir, 'Inbox', 'AI Inbox', 'sentinel', 'workspace-snapshot.md'), 'utf8');
  assert.match(snap, /machine_observed_snapshot/);
  assert.match(snap, /approved_by_owner: false/);
  assert.match(snap, /\| inventory \| inventory \|/);
  assert.match(snap, /potentially_stale/);
  assert.ok(!snap.includes(e.ws), 'absolute paths are not recorded unless privacy.recordAbsolutePaths is true');
  assert.equal(JSON.parse(e.run(['sentinel', 'run']).stdout).record, 'DEDUPLICATED_NO_OP');
  assert.equal(fs.readFileSync(projectNote, 'utf8'), before, 'sentinel never edits notes');
  assert.equal(JSON.parse(e.run(['sentinel', 'status']).stdout).enabled, true);
});
