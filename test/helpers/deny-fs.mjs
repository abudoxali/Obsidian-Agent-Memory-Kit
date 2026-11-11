// SPDX-License-Identifier: Apache-2.0
// Test-time isolation tripwire: any filesystem access whose path matches the deny pattern throws.
// Preloaded into every test process (and every CLI child) by scripts/run-tests.mjs.
// This is a tripwire to prove the kit never reaches for a private vault; it is NOT a security sandbox.
import fs from 'node:fs';

const pattern = process.env.VYMEM_TEST_DENY;
if (pattern) {
  const deny = new RegExp(pattern, 'i');
  const names = ['readFileSync', 'statSync', 'lstatSync', 'existsSync', 'readdirSync', 'openSync', 'realpathSync', 'accessSync', 'copyFileSync', 'writeFileSync', 'mkdirSync', 'appendFileSync', 'renameSync', 'unlinkSync'];
  for (const name of names) {
    const orig = fs[name];
    fs[name] = function guarded(p, ...rest) {
      if (typeof p === 'string' || p instanceof URL || Buffer.isBuffer(p)) {
        if (deny.test(String(p))) throw new Error(`ISOLATION_VIOLATION: ${name} on ${String(p)}`);
      }
      return orig.call(this, p, ...rest);
    };
  }
  globalThis.__VYMEM_DENY_ACTIVE__ = true;
}
