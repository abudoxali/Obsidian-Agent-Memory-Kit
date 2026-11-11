# VYMEM - Status

**Version:** 0.1.0 (pre-release; `private: true` in package.json; nothing published to npm or GitHub Releases)
**License:** Apache-2.0 (see `LICENSE`, `NOTICE`)
**Last updated:** 2026-11-12
**Release classification:** early pre-release, *not production-ready*. CI-verified on 3 OSes x 3 Node versions; real-client lifecycle validation is outstanding.

## Implemented (each item has automated tests unless noted)

| Area | State |
| --- | --- |
| MCP gateway (`vymem mcp`, 7 tools, read/propose modes, stdio framing x2) | done |
| Obsidian Markdown storage, configurable folders, hidden state dir | done |
| Project identification, project context, search, read | done |
| Evidence-backed handoffs (hook-built and agent-submitted) | done |
| AI Inbox: dedup, conflict detection, anti-impersonation, secret screen | done |
| Owner approval (`approve`, `proposals apply/reject`, `rollback`), CLI-only | done |
| Freshness detection (git HEAD, STATUS.md hash/mtime) | done |
| Optional Sentinel (`run`, foreground `watch`), off by default | done |
| Client install/uninstall for Claude Code, Codex, Antigravity (MCP + hooks) | done; simulated payloads only (see client table) |
| `init`, `doctor`, `status`, `config`, `prune` | done |
| Synthetic demo (2 fictional projects, 25 checks) | done |
| Brand assets, diagrams, docs, CI | done |
| Apache-2.0 licensing: official `LICENSE`, `NOTICE`, SPDX headers, package metadata, docs | done (2026-11-12) |
| Two owner-approved sanitized real screenshots in README | done (2026-11-12) |

## Explicitly not implemented

MCP `full` mode and ticketed MCP apply; skills/MCP-registry discovery; scheduler/service installers; GUI; semantic search; cloud sync; clients other than the three.

## Licensing (2026-11-12)

- Owner-selected **Apache License 2.0**; `LICENSE` is the unmodified ASF text (11358 bytes, SHA-256 `cfc7749b...523d30`, pinned by a test).
- `NOTICE` records: no third-party code (zero dependencies); brand artwork supplied by the owner; screenshots depict third-party UIs (Obsidian and a community plugin) and are published with the owner's approval; trademark non-grant (Apache-2.0 Section 6).
- Every original `.mjs` file has `SPDX-License-Identifier: Apache-2.0` (pinned by a test). Section 3's express patent grant and its litigation-termination clause are in the unmodified text; README summarises them without altering them. Nothing claims patent registration or trademark ownership.
- **Unresolved provenance items:** (1) copyright-holder wording in `NOTICE` is "The VYMEM authors" - the owner may prefer a named holder; (2) the brand artwork was supplied to this project as a kit generated outside the repository; the owner is asked to confirm they hold the rights to license it under Apache-2.0; (3) the screenshots show third-party UI (Obsidian, a community graph plugin) - the owner's capture is published; the third parties' rights in their UI are not affected by Apache-2.0.

## Screenshots

Published: `docs/screenshots/galaxy-sanitized.png`, `docs/screenshots/handoff-sanitized.png`, both labelled *Sanitized capture from a private deployment.* and pinned by SHA-256 in `docs/showcase/provenance-manifest.json` (a test enforces approval, label, hash and no metadata chunks). Raw captures and the other 12 origin screenshots are not in the repository or its history.

## Verification

| Check | Result |
| --- | --- |
| GitHub Actions, confirmed from job logs | `00e7fda`: 9/9 jobs (43/43 tests each). `157d066` (Apache-2.0 + screenshots): 9/9 jobs - Ubuntu, Windows, macOS x Node 20, 22, 24 - each 45/45 tests, 25/25 demo, privacy scan clean |
| Local (Windows 11 Pro 10.0.26200, Node v24.11.0, git 2.51.2), 2026-11-12 | `npm test` 45/45; demo 25/25; `audit:privacy` clean; also re-run under a temporary HOME/APPDATA/TEMP with the same results |
| Independent installation (temp HOME, synthetic vault, disposable git repos, tripwire denying the original vault) | all 15 acceptance areas covered by tests and the demo; see below |
| Real Claude Code 2.1.319 binary -> VYMEM MCP server (isolated `USERPROFILE`) | **Connected** (`claude mcp list`/`get`); one-off manual run |
| Real-client lifecycle (hooks in a live session) for Claude Code / Codex / Antigravity | **not verified** |
| Original private system unchanged during this work | audit log, intake index and handoff count identical before/after |

### Verification levels per client

| Client | Unit | Simulated integration (CI) | Actual MCP connection | Real lifecycle |
| --- | --- | --- | --- | --- |
| Claude Code | yes | yes | **yes** (2.1.319, isolated home) | not verified (isolated home not logged in) |
| Codex | yes | yes | not verified (no CLI on PATH; production hooks present) | not verified |
| Antigravity | yes | yes | not verified (GUI; shared global config) | not verified |

Exact manual steps to finish validation are in `docs/compatibility.md`.

### Independent installation - area to evidence

Fresh init, MCP init, search, project context/identification, handoff generation and retrieval, dedup, conflict detection, protected canonical updates, config merge, safe uninstall, freshness, Sentinel, isolation: `test/gateway.test.mjs`, `test/clients.test.mjs`, `test/hooks.test.mjs`, `test/freshness-sentinel.test.mjs`, `test/approval.test.mjs`, `test/isolation.test.mjs` and `examples/run-demo.mjs`. Every test process runs with a tripwire that throws on access to a path containing `Obsidian Vault`.

### CI for the Apache-2.0/screenshots commit

The README badge shows the latest run; the two verified runs are listed in the table above.

## Security audit (2026-11-12)

`npm run audit:privacy --history` (tracked tree, git history, SVG/PNG metadata, credential patterns, personal paths, emails, IPs, hostnames, Arabic text): clean. MCP permission limits are policy of the gateway process, not OS sandboxing; an agent with shell access can run the approval CLI unless the client's command permissions deny it (`docs/security.md`). Owner-controlled approval verified working by tests and the demo.

## Open items / blockers

1. **Live-client lifecycle validation** (hooks in real sessions) for all three clients; manual steps documented.
2. **Name clearance**: no exact-name conflict found; similar marks exist; no trademark clearance performed.
3. Owner confirmations listed under "Unresolved provenance items" (copyright-holder wording; brand-artwork rights).
4. Package publishing and GitHub Releases are not authorised and have not been done.
