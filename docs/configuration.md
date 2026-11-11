# Configuration

One JSON file, created by `vymem init`. Locate it with `vymem config path`. Read a value with `vymem config get <dotted.key>`, change one with `vymem config set <dotted.key> <json>`; every save is validated.

Resolution order for the file: `--config <file>`, then `VYMEM_CONFIG`, then the user config directory (`VYMEM_CONFIG_DIR` overrides the directory; default `%APPDATA%\vymem` on Windows, `$XDG_CONFIG_HOME/vymem` or `~/.config/vymem` elsewhere). There is **no implicit default vault**: without a config every command fails closed with `CONFIG_NOT_FOUND`.

## Reference

| Key | Default | Meaning |
| --- | --- | --- |
| `version` | `1` | Config schema version. |
| `vault.path` | (required) | Absolute path of the Obsidian vault. |
| `vault.folders.projects` | `Projects` | Project notes. |
| `vault.folders.decisions` | `Decisions` | Decision records, searched for project context. |
| `vault.folders.memory` | `Agent Memory` | Durable lessons. |
| `vault.folders.inbox` | `Inbox/AI Inbox` | **The only place `submit_knowledge_entry` may write.** |
| `vault.folders.proposals` | `Inbox/Update Proposals` | Staged proposals. |
| `vault.folders.reference` | `Reference` | Free reference notes. |
| `vault.readableFolders` | `[]` | If non-empty, only these top-level folders are readable. |
| `vault.stateDir` | `.vymem` | Hidden state directory inside the vault. |
| `workspaces.roots` | `[]` | Directories scanned by `freshness` and the Sentinel. |
| `workspaces.exclude` | `node_modules, .git, dist, build, target, .venv, venv, __pycache__, .next, vendor` | Directory names skipped by scans. |
| `workspaces.maxDepth` | `3` | Scan depth (0-8). |
| `clients.<name>.enabled` | `false` | Default client selection for `install`/`uninstall` (`claude`, `codex`, `antigravity`). |
| `mcp.serverName` | `vymem` | Key under which the server is registered. |
| `mcp.permission` | `propose` | `read` or `propose`. `full` is rejected. |
| `hooks.enabled` | `false` | Master switch; hooks are inert when false. Set to true by `install --hooks --yes`. |
| `hooks.captureEnabled` | `true` | Allow ledger capture and handoff writing (briefings still work when false). |
| `hooks.briefingMaxChars` | `3500` | Briefing size cap. |
| `hooks.minWriteIntervalSeconds` | `30` | Per-session handoff write rate limit. |
| `privacy.blockedFolders` | `["Private"]` | Folders that are never read, searched or written. |
| `privacy.extraSecretPatterns` | `[]` | `[{ "label": "...", "pattern": "regex", "flags": "i" }]`, added to the built-in screen. |
| `privacy.recordAbsolutePaths` | `false` | Whether Sentinel snapshots include absolute repository paths. |
| `retention.backupsDays` / `auditDays` / `sessionLedgerDays` | `90` / `365` / `14` | Used by `vymem prune`. |
| `sentinel.enabled` | `false` | Must be `true` before Sentinel runs. |
| `sentinel.intervalMinutes` | `60` | Loop interval for `sentinel watch`. |
| `search.synonyms` | `[]` | Extra synonym groups, e.g. `[["k8s","kubernetes"]]`. |

## Notes

- Folder values must be relative paths without `..`. Case is preserved on disk; blocked/readable folder matching is case-insensitive on every platform.
- Hidden folders (any path segment starting with `.`) and `node_modules` are never readable by agents, whatever the config says.
- `vault.path` and `workspaces.roots` are stored as absolute paths. The config is not designed to be shared between machines.
- Environment variables: `VYMEM_CONFIG`, `VYMEM_CONFIG_DIR`, `VYMEM_CLIENT_HOME` (overrides the home directory used to locate client config files; used by the tests).
- Frontmatter fields read from project notes: `local_path`, `repository_url`, `aliases`, `tech_stack`, `git_commit`, `last_verified`, `status_md_sha256`, `lifecycle`, `deployment_status`, `runtime_verification`, `blockers`, `human_locked`, `locked_fields`, `manual_override`.
