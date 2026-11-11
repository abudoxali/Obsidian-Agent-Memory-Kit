# Compatibility

This page separates **what this project ran** (local run, CI, one manual client connection check), **per-client verification levels**, and **what was observed elsewhere** (in the private deployment VYMEM was extracted from). Only the first two count as verified by VYMEM, and each claim names how it was verified.

## 1. Local run

| Item | Result |
| --- | --- |
| Operating system | Windows 11 Pro (10.0.26200) |
| Node.js | v24.11.0 |
| git | 2.51.2 (Windows) |
| `npm test` | 45 tests, 45 passing (2026-11-12) |
| `node examples/run-demo.mjs` | 25 of 25 checks passing |
| `npm run audit:privacy` | clean (working tree) |

All runs were on one machine. Tests use throwaway homes, vaults and git repositories, and run under a filesystem tripwire that fails any access to a path containing `Obsidian Vault` (override with `VYMEM_TEST_DENY`).

## 2. Automated CI (verified from the actual workflow logs)

GitHub Actions (workflow `.github/workflows/ci.yml`), two runs confirmed from the job logs: run 43115162776 on `00e7fda` (**43/43** tests) and run 43118552695 on `157d066`, the Apache-2.0 + screenshots commit (**45/45** tests). In both, every job ran `npm test`, `node examples/run-demo.mjs --quiet` and `npm run audit:privacy`, and the logs showed 25/25 demo checks and a clean privacy scan in every cell:

| OS (GitHub-hosted runner) | Node 20 | Node 22 | Node 24 |
| --- | --- | --- | --- |
| Ubuntu (`ubuntu-latest`) | PASS | PASS | PASS |
| Windows (`windows-latest`) | PASS | PASS | PASS |
| macOS (`macos-latest`) | PASS | PASS | PASS |

Runner versions seen in the logs: Node 20.20.2 / 22.23.4 / 24.22.2, git 2.56.0. The README badge shows the most recent run; later commits are only as verified as their own run.

**CI is automated testing with simulated client payloads. It is not real-client testing.**

## 3. Clients - verification levels

Levels: **Unit** (library tests) < **Simulated integration** (our own scripted MCP client / fabricated hook payloads, in CI) < **Actual MCP connection** (the real client binary connected to a VYMEM-registered server) < **Real lifecycle** (the client's own hooks drove VYMEM in a live agent session).

| Client | Unit | Simulated integration | Actual MCP connection | Real lifecycle | Notes |
| --- | --- | --- | --- | --- | --- |
| Claude Code | yes | yes: config merge, idempotency, uninstall, hook command run through `cmd.exe` and bash, simulated payloads | **yes** (one-off manual run, 2026-11-12): Claude Code 2.1.319 on Windows, isolated `USERPROFILE`; `vymem install --client claude --mcp --hooks --yes` then `claude mcp list` / `claude mcp get vymem` reported the server **Connected**, and only the VYMEM server was visible (user's real servers not loaded) | **not verified** | The isolated home is not logged in (`Not logged in`), so no model turn, hook firing or tool call by the client could be exercised. The Claude desktop app's Code tab (an embedded Claude Code engine) was not tested independently; the check used the standalone CLI. |
| Codex | yes | yes (config merge, simulated payloads) | **not verified** | **not verified** | No Codex CLI was found on this machine's `PATH`, and the owner's Codex profile carries production hooks, so an isolated test needs its own `CODEX_HOME` and sign-in. See "Manual actions". |
| Antigravity | yes | yes (config merge, simulated payloads) | **not verified** | **not verified** | GUI IDE using the shared global `~/.gemini/config`; cannot be tested without touching the owner's real configuration. |
| Any MCP client | yes | yes: stdio protocol (newline and `Content-Length` framing, `initialize`, `tools/list`, `tools/call`) with a scripted client | - | - | |

The Claude Code connection check is a manual, one-off run, not part of CI. The original private deployment's own live-client results are **not inherited** by VYMEM.

### Manual actions to finish real-client validation

Each needs an isolated home so your production settings and hooks are untouched.

1. **Claude Code lifecycle:** in a fresh temporary home, run `claude auth login` once there (or use an API-key based session you are comfortable with), create a git repo plus `vymem project add`, run `vymem install --client claude --mcp --hooks --yes --home <that home>`, start `claude -p "..."` in the repo with that home, and confirm a `VYMEM BRIEFING` reaches the session and a handoff appears under `Inbox/AI Inbox/handoffs/`.
2. **Codex:** install the Codex CLI, point `CODEX_HOME` at a temporary directory, sign in there, `vymem install --client codex --mcp --hooks --yes --home <parent of .codex>`, run a short `codex exec` task in a repo, review/trust the hooks in Codex's own UI (do not use trust-bypass flags), and check for the briefing and handoff.
3. **Antigravity:** only on a machine or profile whose `~/.gemini/config` can be replaced; install with `--home`, start a conversation in a repository, and check the first-invocation briefing and the handoff on `Stop`.

### Observations from the origin deployment (not re-verified here)

The private system this kit was extracted from recorded, in its own status document, the following about its own installation. They explain where file locations and payload field names came from; they are **not** claims about VYMEM:

- Claude Code (a 2.1.x CLI and the Claude desktop app's Code tab) connected to the MCP server and ran SessionStart/PostToolUse/Stop hooks in real sessions;
- a Codex CLI 0.16x build ran the hooks in real sessions only after the owner trusted them, and its `PostToolUse` payload carried stdout text instead of an exit code;
- Antigravity 44.x registered the MCP server, with published reports (cited there) that IDE hooks on Windows might not fire, and an observed first-invocation-only briefing injection.

If your client version differs, expect to adjust `src/hooks/handler.mjs` and `src/clients.mjs`.

## Operating systems

Windows is the only OS this project has run on. Path handling uses `node:path`, hook commands use forward-slash quoted paths, and case-insensitive comparison is applied on Windows and macOS; the code has no OS-specific branches beyond that and the default config directory. That is a design intention, not a test result.

## Not supported (explicitly)

An MCP `full` permission mode; MCP tools that apply/approve; skills or MCP-registry discovery; scheduled-task or service installation; Obsidian plugins; network file systems; clients other than the three listed (use `vymem mcp` manually for any other MCP client).
