# Troubleshooting

Start with `vymem doctor` (exit code 1 if any check fails) and `vymem status`.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `CONFIG_NOT_FOUND` | no config at the resolved path | run `vymem init --vault <dir>`, or pass `--config`, or check `VYMEM_CONFIG` / `VYMEM_CONFIG_DIR`. VYMEM never guesses a vault. |
| `[FAIL] Vault reachable` | vault moved/deleted or on an unmounted drive | restore it, or `vymem init --vault <new path>` (merges into the existing config). |
| `[FAIL] MCP gateway handshake` | Node < 20, broken checkout, or a config error | run `node bin/vymem.mjs mcp --config <config>` in a terminal and send `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`; read the error. |
| doctor shows MCP `registered` but the client has no tools | the client has not reloaded its MCP config, or loads it from another file/scope | restart the client; confirm the client's own MCP list; see [integrations.md](integrations.md). doctor cannot see inside the client. |
| `FOREIGN_ENTRY_CONFLICT` | a same-named entry exists that VYMEM did not create | rename via `vymem config set mcp.serverName <name>` or remove the old entry yourself. |
| `INVALID_CLIENT_CONFIG` | the client's file is not valid JSON | fix or move the file; VYMEM refuses to overwrite it. |
| install says `already up to date` | nothing to do; install is idempotent | - |
| Hooks installed but nothing happens | `hooks.enabled` is false; Codex has not been told to trust the hooks; the client does not fire hooks on your platform/version | `vymem config get hooks.enabled`; review/trust hooks in Codex; check `<vault>/.vymem/hook.log` and the client's hook diagnostics. |
| No briefing in a session | repository has no project note *and* no handoffs; the working directory is not a git repository; the session is inside the vault | `vymem project identify --cwd <dir>`; `vymem project add`. |
| Wrong or no project match | name differs from the folder, `local_path` stale | set `local_path`, `repository_url` or `aliases` in the project note. |
| `PROJECT_NOT_FOUND` / `AMBIGUOUS_MATCH` | name does not match one note | use the exact note name (matching ignores case, spaces, `-`, `_`). |
| Handoff never appears | the session had no meaningful change, the same facts were already stored (`DEDUPLICATED_NO_OP`), or the 30 s per-session rate limit applied | check `hook.log`; lower `hooks.minWriteIntervalSeconds` if appropriate. |
| Tests recorded as "outcome not captured" | the client's hook payload has no exit code | expected; see [integrations.md](integrations.md). |
| `CONFLICT_DETECTED` on submit | another agent owns the record, the path belongs to another record id, or `expected_sha256` is stale | re-read the note, merge, resubmit under your own `record_id`. |
| `HUMAN_LOCKED` | the note is `human_locked`/`manual_override`, or the record is approved | by design. Edit it yourself, or remove the lock in Obsidian. |
| `REJECTED_SECRET_DETECTED` | the text matches a secret pattern | remove the secret. False positive? rephrase; patterns are intentionally conservative. |
| `SENTINEL_DISABLED` / `NO_WORKSPACE_ROOTS` | monitoring is off by default / no roots | `vymem config set sentinel.enabled true`; `vymem init --vault <dir> --workspace <dir>`. |
| `LOCK_TIMEOUT` | a crashed process left a lock | locks self-heal after 30 s; otherwise delete `<vault>/.vymem/*.lock` when no VYMEM process is running. |
| Windows path with spaces/non-ASCII in hook commands | quoting differs between clients | commands use quoted forward-slash paths and are tested through `cmd.exe` and bash on Windows; if your client behaves differently, install VYMEM in an ASCII-only path and re-run `install --yes`. |

Backups: every overwrite is in `<vault>/.vymem/backups/<date>/`; client-config backups are in `<config dir>/backups/`. Audit: `<vault>/.vymem/audit-log.jsonl`.
