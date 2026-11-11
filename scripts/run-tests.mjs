// SPDX-License-Identifier: Apache-2.0
// Cross-platform test runner (Node 20 does not expand globs on Windows).
// Every test process runs with an isolation tripwire that denies access to a (private) vault path.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join('test', f));
const preload = pathToFileURL(path.join(root, 'test', 'helpers', 'deny-fs.mjs')).href;
const env = {
  ...process.env,
  VYMEM_TEST_DENY: process.env.VYMEM_TEST_DENY || 'Obsidian Vault',
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${preload}`.trim()
};
delete env.VYMEM_CONFIG; delete env.VYMEM_CONFIG_DIR; delete env.VYMEM_CLIENT_HOME;
const r = cp.spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: root, stdio: 'inherit', env });
process.exit(r.status ?? 1);
