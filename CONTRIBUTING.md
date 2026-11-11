# Contributing

Thanks for looking. A few rules keep VYMEM small and trustworthy.

1. **Zero runtime dependencies.** Use Node's standard library. Test tooling is `node:test` only.
2. **Every behaviour has a test, and every doc sentence describes implemented behaviour.** Do not advertise commands, clients or platforms that are not exercised.
3. **Policy lives in `src/vault.mjs`.** New read/write paths must go through `Vault.resolve`.
4. **No MCP tool may modify a canonical note, approve a record or restore a backup.** Those stay CLI-only.
5. **No personal data.** Run `npm run audit:privacy` before committing. Fake credentials in tests must be assembled at runtime so no literal secret is ever committed.
6. **Screenshots.** Real captures need the owner's sign-off and an entry in `docs/showcase/provenance-manifest.json`; otherwise use synthetic, clearly labelled visuals.

```bash
npm test && node examples/run-demo.mjs --quiet && npm run audit:privacy
```

## License

VYMEM is licensed under Apache-2.0 (see `LICENSE`). By submitting a contribution you agree, per Section 5 of the license, that it is licensed under the same terms, with the express patent grant of Section 3 for patent claims you are able to license. Add `// SPDX-License-Identifier: Apache-2.0` to new original source files. Do not add third-party code or assets without recording their license in `NOTICE` first; if you cannot license something under Apache-2.0, do not submit it.
