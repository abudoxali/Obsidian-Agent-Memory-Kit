# Client integrations

All three integrations are installed by `vymem install` and removed by `vymem uninstall`. Both are **dry runs without `--yes`**. File locations below were observed in a private deployment that VYMEM was extracted from; they have **not** been re-verified against each client's current documentation or on every platform, so check them for your client version. The `--home <dir>` option redirects the home directory (used by the tests).

What every integration writes:

- **MCP registration**: a stdio server entry `command = <node>`, `args = [<repo>/bin/vymem.mjs, mcp, --config, <config>, --managed-by=vymem]`. The `--managed-by=vymem` marker is how uninstall recognises VYMEM's own entries.
- **Hooks** (only with `--hooks --yes`): commands of the form `"<node>" "<repo>/bin/vymem.mjs" hook <client> <Event> --config "<config>" --managed-by=vymem`, with forward-slash paths so the same line works in `cmd.exe` and POSIX shells (both are exercised by a test on Windows).

## Claude Code

| | |
| --- | --- |
| MCP | `~/.claude.json` -> `mcpServers.<serverName>` = `{ "type": "stdio", "command": ..., "args": [...] }` |
| Hooks | `~/.claude/settings.json` -> `hooks`: `SessionStart` (10 s), `UserPromptSubmit` (5 s), `PostToolUse` matcher `Edit\|Write\|MultiEdit\|NotebookEdit\|Bash` (5 s), `Stop` (8 s), `SessionEnd` (5 s). Existing hook groups for the same events are kept; VYMEM's are appended. |
| Briefing channel | `hookSpecificOutput.additionalContext` on `SessionStart` |

`~/.claude.json` is rewritten by Claude Code itself during normal use. VYMEM edits it only after a backup, only the one `mcpServers` entry, and via an atomic write; avoid running `install`/`uninstall` while Claude Code is mid-session. Equivalent manual route: `claude mcp add` with the same command and arguments.

## Codex

| | |
| --- | --- |
| MCP | `~/.codex/config.toml` -> a marked block (`# >>> vymem managed block ... <<<`) containing `[mcp_servers.<serverName>]` with `command` and `args`. Nothing else in the file is touched. If you already have a hand-written `[mcp_servers.<serverName>]` outside the block, install refuses. |
| Hooks | `~/.codex/hooks.json` -> `hooks`: `SessionStart`, `UserPromptSubmit`, `PostToolUse` matcher `Bash\|apply_patch\|Edit\|Write`, `Stop`. |
| Trust | Codex asks you to review/trust new hooks in its own UI. VYMEM does not change trust state, and hooks do not run until you approve them. |

Codex's payload for `PostToolUse` has been observed to carry stdout text rather than an exit code, so test outcomes are usually recorded as "not captured".

## Antigravity

| | |
| --- | --- |
| MCP | `~/.gemini/config/mcp_config.json` -> `mcpServers.<serverName>` = `{ "command": ..., "args": [...] }` |
| Hooks | `~/.gemini/config/hooks.json` -> a named hook `vymem` with `PreInvocation` (10 s) and `Stop` (8 s). |
| Briefing channel | The first `PreInvocation` of a conversation replies with `injectSteps: [{ ephemeralMessage }]`; later invocations in the same conversation do nothing. |

Published reports say IDE hooks on Windows may not fire in some versions. MCP retrieval does not depend on hooks, so `get_project_context` still works when they do not.

## What "supported" means here

The kit implements the config formats above and handles the hook payload shapes it was built from. Its own automated tests exercise them with **simulated** payloads and a throwaway home directory. It does **not** claim that a given client version loads the server or fires the hooks; see [compatibility.md](compatibility.md) for exactly what was and was not verified.

## Adding another client

A client is one entry in `CLIENTS` in `src/clients.mjs` (an MCP installer and optionally a hook installer, each with `install`, `uninstall`, `inspect`) plus, if it has lifecycle hooks, a branch in `src/hooks/handler.mjs`. Any MCP-capable client can also use `vymem mcp` directly with no hooks.
