# VYMEM - Status

**Version:** 0.1.0 (pre-release, `private: true` in package.json, nothing published to npm or GitHub Releases)
**Last updated:** 2026-11-11 (UTC)
**Release readiness:** *not production-ready.* Independent validation against live clients has not been done.

## Implemented (each item has automated tests unless noted)

| Area | State |
| --- | --- |
| MCP gateway (`vymem mcp`, 7 tools, read/propose modes, stdio framing x2) | done |
| Obsidian Markdown storage, configurable folders, hidden state dir | done |
| Project identification (local_path / repository_url / name / alias) | done |
| Project context, search, read | done |
| Evidence-backed handoffs (hook-built and agent-submitted) | done |
| AI Inbox: dedup, conflict detection, anti-impersonation, secret screen | done |
| Owner approval (`approve`, `proposals apply/reject`, `rollback`), CLI-only | done |
| Freshness detection (git HEAD, STATUS.md hash/mtime) | done |
| Optional Sentinel (`run`, foreground `watch`), off by default | done |
| Client install/uninstall for Claude Code, Codex, Antigravity (MCP + hooks) | done, simulated payloads only |
| `init`, `doctor`, `status`, `config`, `prune` | done |
| Synthetic demo (2 fictional projects, 25 checks) | done |
| Brand assets, diagrams, docs, CI workflow | done |

## Explicitly not implemented

MCP `full` mode and ticketed MCP apply; skills/MCP-registry discovery; scheduler/service installers; GUI; semantic search; cloud sync; clients other than the three.

## Verification (2026-11-11, Windows 11 Pro 10.0.26200, Node v24.11.0, git 2.51.2)

| Check | Result |
| --- | --- |
| `npm test` | 43/43 pass |
| `node examples/run-demo.mjs` | 25/25 checks pass |
| `npm run audit:privacy` | clean |
| Live Claude Code / Codex / Antigravity sessions | **not run** |
| macOS / Linux, Node 20/22 | **not run locally**; see the CI badge for the real result |

## Open items / blockers

1. **License** not selected - owner decision required (README states all rights reserved meanwhile).
2. **Real screenshots**: two sanitized candidates exist outside the repository; owner approval required before any is published.
3. **Name clearance**: no exact-name conflict found in a preliminary search; similar marks exist; no trademark clearance performed.
4. **Live-client validation** of hooks/MCP registration is outstanding.
5. Package publishing and GitHub Releases are not authorised and have not been done.
