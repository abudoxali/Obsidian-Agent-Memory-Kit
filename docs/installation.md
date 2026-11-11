# Installation

## Requirements

| Need | Why | Required? |
| --- | --- | --- |
| Node.js 20 or newer | VYMEM is plain ESM JavaScript with zero dependencies | yes |
| git on `PATH` | project identification by repository, freshness, hook evidence | optional (features degrade; `vymem doctor` says so) |
| An Obsidian vault | where notes live; an empty folder works | yes (VYMEM can create the folder) |
| A client: Claude Code, Codex or Antigravity | to use the gateway/hooks | at least one for agent use |

No administrator rights are needed. VYMEM never installs services or scheduled tasks.

## 1. Get the code

```bash
git clone https://github.com/abudoxali/Obsidian-Agent-Memory-Kit.git
cd Obsidian-Agent-Memory-Kit
node bin/vymem.mjs help
```

Create a shell alias so the examples read naturally, e.g. `alias vymem='node /path/to/Obsidian-Agent-Memory-Kit/bin/vymem.mjs'`. (`npm link` also works as standard npm behaviour, but this project does not test it.)

The paths that VYMEM writes into client configs are absolute paths to `bin/vymem.mjs` **in the folder you cloned**. Do not move or delete the folder afterwards; if you do, run `vymem install ... --yes` again from the new location.

## 2. Initialise a vault

```bash
vymem init --vault ~/Documents/MyVault --clients claude,codex --workspace ~/code
```

- Existing Obsidian vault: it is used as-is. VYMEM creates its folders (`Projects`, `Decisions`, `Agent Memory`, `Inbox/AI Inbox`, `Inbox/Update Proposals`, `Reference`) if missing, a hidden `.vymem/` state folder, and `Welcome to VYMEM.md`. `.obsidian/` is never read or modified.
- New folder: created for you.
- Re-running `init` is idempotent and merges new `--workspace` / `--clients` values into the existing config.

The config file location is printed. Default: `%APPDATA%\vymem\config.json` (Windows), `$XDG_CONFIG_HOME/vymem/config.json` or `~/.config/vymem/config.json` (elsewhere). Override with `--config <file>` or `VYMEM_CONFIG`.

## 3. Create or write project notes

```bash
vymem project add my-service --path ~/code/my-service --summary "What it is"
```

Or write `Projects/<name>.md` by hand. Fields VYMEM understands: `entity_type: project`, `local_path`, `repository_url`, `aliases`, `tech_stack`, `git_commit`, `last_verified`, `status_md_sha256`, `human_locked`, and the sections `## Purpose`, `## Architecture`, `## Status`, `## Blockers`, `## Next steps`.

## 4. Register with your client

Every mutating command is a **dry run unless you pass `--yes`**.

```bash
vymem install --client claude --mcp          # preview: lists files it would change
vymem install --client claude --mcp --yes    # apply
vymem install --client all --hooks --yes     # lifecycle hooks: explicit consent
```

What happens on `--yes`: each target file is parsed (invalid JSON aborts without touching it), VYMEM entries are merged in without disturbing anything else, the original is copied to `<config dir>/backups/` first, and the write is skipped entirely when nothing would change (so repeating the command is harmless). Hook registration also sets `hooks.enabled=true` in VYMEM's config; set it to `false` to pause hooks without editing client files (`vymem config set hooks.enabled false`).

Per-client notes are in [integrations.md](integrations.md). Codex requires you to trust newly added hooks inside Codex itself; VYMEM does not touch Codex's trust state.

## 5. Verify

```bash
vymem doctor      # config, vault, folders, MCP handshake, per-client registration
vymem status      # counts, pending proposals, last audit event, registration state
```

`doctor` starts the real `vymem mcp` process and performs `initialize` + `tools/list` against it. It does **not** prove that a particular client loaded the server; restart the client and check its MCP list.

## 6. Use it

Open a session in a repository that has a project note. With hooks enabled you will see a `VYMEM BRIEFING` in the session context. Without hooks, ask the agent to call `get_project_context`.

## Uninstall

```bash
vymem uninstall --client all --yes
```

Removes only entries VYMEM created (identified by a marker), after backing up each file. Entries with the same name that VYMEM did not create are left alone. Your vault and notes are never touched. Add `--purge-config` to also delete VYMEM's own config and install manifest. Backups stay in `<config dir>/backups/` until you delete them.
