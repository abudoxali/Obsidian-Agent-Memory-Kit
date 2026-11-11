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

The license is not yet chosen (see README); contributions cannot be accepted into the code base until it is.
