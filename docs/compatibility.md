# Compatibility

This page separates three things: **what this project ran**, **what is configured but unverified**, and **what was observed elsewhere** (in the private deployment VYMEM was extracted from). Only the first group counts as verified by VYMEM.

## 1. Verified by this project

| Item | Result |
| --- | --- |
| Operating system | Windows 11 Pro (10.0.26200) |
| Node.js | v24.11.0 |
| git | 2.51.2 (Windows) |
| `npm test` | 43 tests, 43 passing |
| `node examples/run-demo.mjs` | 25 of 25 checks passing |
| `npm run audit:privacy` | clean (working tree) |

All runs were on one machine. Tests use throwaway homes, vaults and git repositories, and run under a filesystem tripwire that fails any access to a path containing `Obsidian Vault` (override with `VYMEM_TEST_DENY`).

## 2. Configured but not yet verified

`.github/workflows/ci.yml` defines a matrix of `ubuntu-latest`, `windows-latest` and `macos-latest` with Node 20, 22 and 24, running the tests, the demo and the privacy gate. The README CI badge shows the real result of the most recent run. Until you see a green run for a combination, treat that combination as **unverified**. Node 20 is the declared minimum (`engines`), but only what CI reports is evidence.

## 3. Clients

| Client | What VYMEM tests | What is **not** tested |
| --- | --- | --- |
| Claude Code | merging into `~/.claude.json` and `~/.claude/settings.json` (preserving foreign content, idempotency, uninstall); the registered hook command executed through `cmd.exe` and bash; hook behaviour with simulated payloads | loading the MCP server in Claude Code; Claude Code firing the hooks; any specific Claude Code version |
| Codex | marked-block merge into `~/.codex/config.toml`, `~/.codex/hooks.json`; simulated payloads | Codex loading either; Codex's hook trust flow; any specific Codex version |
| Antigravity | merge into `~/.gemini/config/mcp_config.json` and `hooks.json`; simulated `PreInvocation`/`Stop` payloads | Antigravity loading either; any specific version |
| Any MCP client | the stdio protocol (newline and `Content-Length` framing, `initialize`, `tools/list`, `tools/call`) with a scripted client | third-party clients |

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
