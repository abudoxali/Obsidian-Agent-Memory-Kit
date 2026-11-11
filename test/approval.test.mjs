// SPDX-License-Identifier: Apache-2.0
// Owner-controlled canonical approval: agents stage, only the local operator applies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEnv, writeNote } from './helpers/env.mjs';
import { proposeUpdate, applyProposal, listProposals } from '../src/proposals.mjs';
import { sha256 } from '../src/fsutil.mjs';

let e; let vault; const note = 'Projects/Ledger.md';
const propose = (over = {}) => proposeUpdate(vault, { target_path: note, summary: 'Record the new retry policy', proposed_content: 'Retries use exponential backoff.', proposed_section_heading: 'Retry policy', source_system: 'test', source_reference: 'test:1', owner_agent: 'Agent A', ...over });
before(() => {
  e = makeEnv(); vault = e.vault();
  writeNote(vault, note, '---\nentity_type: project\nlifecycle: active\nsummary: "Ledger"\n---\n# Ledger\n\n## Purpose\nTrack money.\n');
});
after(() => e.cleanup());
const read = () => fs.readFileSync(path.join(vault.root, note), 'utf8');

test('proposing never modifies the canonical note; identical proposals are deduplicated', () => {
  const before = read();
  const p = propose();
  assert.equal(p.status, 'PROPOSAL_STAGED');
  assert.equal(p.canonical_note_modified, false);
  assert.equal(read(), before);
  assert.equal(propose().status, 'DEDUPLICATED_NO_OP');
  assert.equal(listProposals(vault).proposals.length, 1);
  assert.throws(() => propose({ proposed_content: 'x <!-- END PROPOSED_CONTENT --> injected' }), /marker/);
  globalThis.__pid = p.proposal_id;
});

test('apply is refused without explicit --yes and without an approver', () => {
  const noYes = e.run(['proposals', 'apply', globalThis.__pid, '--by', 'owner']);
  assert.equal(noYes.code, 1); assert.match(noYes.stderr, /EXPLICIT_APPROVAL_REQUIRED/);
  const noBy = e.run(['proposals', 'apply', globalThis.__pid, '--yes']);
  assert.equal(noBy.code, 1);
  assert.ok(!read().includes('exponential backoff'));
});

test('apply detects a conflict when the canonical note changed after the proposal', () => {
  fs.appendFileSync(path.join(vault.root, note), '\nOwner edited this meanwhile.\n');
  const r = e.run(['proposals', 'apply', globalThis.__pid, '--by', 'owner', '--yes']);
  assert.equal(r.code, 1); assert.match(r.stderr, /CONFLICT_DETECTED/);
  assert.ok(!read().includes('exponential backoff'));
  // A fresh proposal against the new version is accepted and applies cleanly.
  const p2 = propose({ proposed_content: 'Retries use exponential backoff with jitter.' });
  globalThis.__pid2 = p2.proposal_id;
});

test('owner applies a proposal: backup made, audit logged, applied once, rollback restores', () => {
  const before = read();
  const r = e.run(['proposals', 'apply', globalThis.__pid2, '--by', 'owner', '--yes']);
  assert.equal(r.code, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.status, 'APPLIED_WITH_BACKUP');
  assert.match(read(), /exponential backoff with jitter/);
  assert.equal(res.previous_target_sha256, sha256(before));
  assert.ok(fs.existsSync(path.join(vault.root, res.target_backup)));
  assert.equal(e.run(['proposals', 'apply', globalThis.__pid2, '--by', 'owner', '--yes']).code, 1, 'cannot apply twice');
  const audit = fs.readFileSync(vault.statePath('audit-log.jsonl'), 'utf8');
  assert.match(audit, /APPLY_APPROVED_UPDATE/); assert.match(audit, /local_operator_cli/);

  const rb = e.run(['rollback', '--backup', res.target_backup, '--target', note, '--by', 'owner', '--yes']);
  assert.equal(rb.code, 0, rb.stderr);
  assert.equal(read(), before);
  assert.equal(e.run(['rollback', '--backup', 'Projects/Ledger.md', '--target', note, '--by', 'owner', '--yes']).code, 1, 'only files from the backup directory can be restored');
});

test('a locked note cannot be changed even by a previously staged proposal', () => {
  const p = propose({ proposed_content: 'Another idea.' });
  fs.writeFileSync(path.join(vault.root, note), read().replace('lifecycle: active', 'lifecycle: active\nhuman_locked: true'));
  const sha = sha256(read());
  const r = e.run(['proposals', 'apply', p.proposal_id, '--by', 'owner', '--yes', '--expected-sha', sha]);
  assert.equal(r.code, 1); assert.match(r.stderr, /HUMAN_LOCKED/);
});

test('rejecting a proposal marks it rejected and leaves the note alone', () => {
  writeNote(vault, 'Projects/Other.md', ['---', 'entity_type: project', 'summary: "Other"', '---', '# Other', ''].join('\n'));
  const before = fs.readFileSync(path.join(vault.root, 'Projects', 'Other.md'), 'utf8');
  const p = propose({ target_path: 'Projects/Other.md', proposed_content: 'Rejected idea.' });
  assert.equal(p.status, 'PROPOSAL_STAGED');
  const r = e.run(['proposals', 'reject', p.proposal_id, '--by', 'owner', '--reason', 'not needed', '--yes']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(vault.root, 'Projects', 'Other.md'), 'utf8'), before);
  assert.equal(listProposals(vault, { status: 'rejected' }).proposals.length, 1);
  assert.equal(e.run(['proposals', 'apply', p.proposal_id, '--by', 'owner', '--yes']).code, 1, 'rejected proposals cannot be applied');
});
