// SPDX-License-Identifier: Apache-2.0
// Acceptance case 15: the kit works with the original private vault completely inaccessible,
// and the repository contains no personal data. Also runs the end-to-end demo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import { makeEnv, ROOT } from './helpers/env.mjs';
import { scanTree, scanPng } from '../scripts/privacy-scan.mjs';

const envs = [];
after(() => envs.forEach(e => e.cleanup()));

test('the isolation tripwire is active in this process and denies access to a private vault path', { skip: !process.env.VYMEM_TEST_DENY }, () => {
  assert.equal(globalThis.__VYMEM_DENY_ACTIVE__, true);
  assert.throws(() => fs.existsSync(['C:', 'Users', 'someone', 'Obsidian' + ' Vault', 'note.md'].join('\\')), /ISOLATION_VIOLATION/);
  assert.throws(() => fs.readdirSync(['', 'data', 'Obsidian' + ' Vault'].join('/')), /ISOLATION_VIOLATION/);
});

test('15. without any config there is no implicit default vault: commands fail closed', () => {
  const e = makeEnv({ init: false }); envs.push(e);
  for (const args of [['search', 'anything'], ['status'], ['context', 'x'], ['sentinel', 'run']]) {
    const r = e.run(args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.stderr, /CONFIG_NOT_FOUND/);
  }
  const hook = e.run(['hook', 'claude', 'SessionStart'], { input: '{}' });
  assert.equal(hook.code, 0); assert.equal(hook.stdout, '');
});

test('15b. a full workflow runs from a clean HOME/APPDATA with the private vault path denied', () => {
  const e = makeEnv(); envs.push(e);
  assert.equal(e.run(['project', 'add', 'isolated-project']).code, 0);
  assert.equal(JSON.parse(e.run(['search', 'isolated']).stdout).results.length, 1);
  assert.equal(e.run(['install', '--client', 'all', '--mcp', '--yes']).code, 0);
  assert.equal(e.run(['doctor']).code, 0, 'doctor passes on a fresh install');
  const cfg = fs.readFileSync(e.configPath, 'utf8');
  assert.ok(cfg.includes(e.vaultDir.replace(/\\/g, '\\\\')) || cfg.includes(e.vaultDir.replace(/\\/g, '/')));
  assert.ok(fs.existsSync(path.join(e.home, '.claude.json')));
});

test('doctor reports failure when the MCP server or vault is broken', () => {
  const e = makeEnv(); envs.push(e);
  fs.rmSync(e.vaultDir, { recursive: true, force: true });
  const r = e.run(['doctor']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\[FAIL\] Vault reachable/);
});

test('the repository contains no personal identifiers, private paths, credentials or image metadata', () => {
  const findings = scanTree(ROOT);
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('PNG metadata scanner detects text chunks', () => {
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b; };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('Author\0someone')), chunk('IEND', Buffer.alloc(0))]);
  assert.deepEqual(scanPng(png), ['PNG metadata chunk tEXt']);
});

test('the end-to-end demo runs on a synthetic vault and every step passes', () => {
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'examples', 'run-demo.mjs'), '--quiet'], { encoding: 'utf8', timeout: 60000, env: { ...process.env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DEMO RESULT: \d+\/\d+ checks passed/);
  assert.doesNotMatch(r.stdout, /FAIL/);
});

test('every published screenshot is owner-approved, labelled, hash-pinned and metadata-free', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'showcase', 'provenance-manifest.json'), 'utf8'));
  const dir = path.join(ROOT, 'docs', 'screenshots');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f)) : [];
  assert.ok(files.length >= 1);
  for (const f of files) {
    const entry = manifest.published.find(p => p.file === `docs/screenshots/${f}`);
    assert.ok(entry, `${f} is not listed in the provenance manifest`);
    assert.equal(entry.owner_approval, 'approved');
    assert.equal(entry.classification, 'real_sanitized_capture');
    assert.equal(entry.label, 'Sanitized capture from a private deployment.');
    const buf = fs.readFileSync(path.join(dir, f));
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), entry.sha256, `${f} differs from the approved version`);
    assert.deepEqual(scanPng(buf), []);
    assert.ok(buf.length < 1024 * 1024, `${f} is larger than 1 MiB`);
  }
  for (const entry of manifest.published.filter(p => p.classification === 'real_sanitized_capture')) assert.ok(files.includes(path.basename(entry.file)));
});

test('licensing: unmodified ASF Apache-2.0 text, NOTICE, package license, SPDX headers on original sources', () => {
  const lic = fs.readFileSync(path.join(ROOT, 'LICENSE'));
  assert.equal(lic.length, 11358);
  assert.equal(crypto.createHash('sha256').update(lic).digest('hex'), 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30', 'LICENSE must be the unmodified ASF text');
  assert.match(fs.readFileSync(path.join(ROOT, 'NOTICE'), 'utf8'), /Apache License, Version 2\.0/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).license, 'Apache-2.0');
  const missing = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.mjs') && !fs.readFileSync(p, 'utf8').split('\n').slice(0, 3).join('\n').includes('SPDX-License-Identifier: Apache-2.0')) missing.push(path.relative(ROOT, p));
    }
  };
  walk(ROOT);
  assert.deepEqual(missing, []);
  for (const f of ['README.md', 'STATUS.md', 'CONTRIBUTING.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /no license|not yet chosen|license is not|all rights reserved|license not selected/i, `${f} still carries an outdated licensing statement`);
  }
});
