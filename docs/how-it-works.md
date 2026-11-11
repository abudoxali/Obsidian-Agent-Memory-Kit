# How it works

## MCP gateway

`vymem mcp` speaks MCP (JSON-RPC 2.0) over stdio. It accepts newline-delimited JSON and `Content-Length`-framed messages and answers `initialize`, `ping`, `tools/list`, `tools/call`. It starts in the permission mode from the config (`mcp.permission`: `read` or `propose`; override with `--permission`). `full` is intentionally not supported.

| Tool | Mode | What it does |
| --- | --- | --- |
| `knowledge_search` | read | Ranked keyword search (title, path, summary, frontmatter, body, small synonym table). Results include `is_unverified`, `approved_by_owner`, a SHA-256, and a redacted snippet. |
| `knowledge_read` | read | One note or one heading section, frontmatter, SHA-256 (usable as `expected_sha256`). |
| `identify_project` | read | Working directory -> repository -> project note and how it matched. |
| `get_project_context` | read | Purpose, architecture, status, blockers, next steps, freshness, related decisions and memories, handoffs, pending proposals. |
| `list_pending_updates` | read | Staged proposals. |
| `submit_knowledge_entry` | propose | Draft record or structured `agent_handoff` into the AI Inbox. |
| `propose_update` | propose | Stage an update to a canonical note. The note is not modified. |

In `read` mode the two write tools return `UNAUTHORIZED_WRITE`. Arguments are validated against the schema shown in `tools/list`; unknown arguments are rejected.

## Lifecycle hooks

Hooks are small commands the client runs at lifecycle points. VYMEM's hook (`vymem hook <client> <event>`) reads the client's JSON payload from stdin and **never blocks, never throws and always exits 0**; errors go to `<vault>/.vymem/hook.log`. Hooks do nothing unless `hooks.enabled` is `true`.

| Event | Claude Code / Codex | Antigravity | Action |
| --- | --- | --- | --- |
| session start | `SessionStart` | first `PreInvocation` of a conversation | Build a briefing; record the start `HEAD` and a snapshot of already-dirty files. Reply via `additionalContext` (Claude/Codex) or `injectSteps[].ephemeralMessage` (Antigravity). |
| prompt | `UserPromptSubmit` | - | Store the first prompt, redacted, clipped to 220 characters. |
| tool use | `PostToolUse` | - | Record edited file paths and **only** build/test commands (`npm test`, `pytest`, `go test`, `cargo test`, ...). Other shell commands are ignored. |
| end | `Stop` / `SessionEnd` | `Stop` | Build and submit the handoff (below). |

Sessions in the vault itself, outside any git repository, or without meaningful change write nothing.

## Context retrieval and the briefing

The briefing (default cap 3500 characters) is assembled only from the read operations above and keeps categories visibly separate:

- **CANONICAL** - the owner-maintained project note;
- **SOURCE OBSERVATIONS** - read-only repository freshness checks;
- **AGENT HANDOFFS** - always labelled unapproved unless `approved_by_owner`;
- **PENDING PROPOSALS**, **DECISIONS**, **LESSONS/MEMORY**.

Repositories without a project note get a short notice and any handoffs whose `project_identifier` equals the repository name.

## Evidence capture and handoffs

At session end VYMEM compares the repository with the snapshot taken at start (`git status --porcelain`, new commits since the start `HEAD`) and combines it with the hook ledger (edits, test commands). The resulting handoff states:

- repository, branch, `HEAD` at start -> now;
- files changed according to git, edits reported by agent tools, build/test commands;
- for each command, `exit N` **only if the client reported an exit code**, otherwise `outcome not captured`;
- `knowledge_confidence`: `verified_partial` only when every captured command reported exit `0`; otherwise `observed_untested`. It is never set to `verified_local` automatically;
- an explicit *What this does NOT prove* section;
- a redacted excerpt of the last agent message, labelled an unverified claim.

Handoffs are written by `submit_knowledge_entry`, so they get the same protections as agent-written ones. To avoid rewriting the file on every turn, writes per session are rate-limited (`hooks.minWriteIntervalSeconds`, default 30).

## Deduplication and conflict detection

`submit_knowledge_entry` hashes the content (never timestamps) with SHA-256:

- same `record_id`, same hash -> `DEDUPLICATED_NO_OP`, file untouched;
- `expected_sha256` differs from the file -> `CONFLICT_DETECTED`;
- the path belongs to a different `record_id`, or the record was written by a different `owner_agent` -> `CONFLICT_DETECTED`;
- the record is approved or `human_locked` -> `HUMAN_LOCKED`;
- otherwise the write succeeds; an existing file is backed up first.

`propose_update` fingerprints target + heading + content + patch; an identical pending proposal returns `DEDUPLICATED_NO_OP`.

## Markdown storage

Each record is a Markdown file with frontmatter (`record_id`, `entity_type`, `owner_agent`, `source_system`, `source_reference`, `verification_status`, `knowledge_status`, `approved_by_owner`, `content_hash`, ...). Handoffs add `project_identifier`, `originating_agent`, `handoff_timestamp`, `knowledge_confidence`, `source_provenance`. You can query them with Obsidian Bases/Dataview-style tools as ordinary properties.

## Knowledge freshness

`vymem freshness` (and the `source_freshness` block of project context) compares a project note with its repository:

- `repo_head_differs_from_note` - `HEAD` no longer starts with the `git_commit` recorded in the note;
- `status_md_changed_since_note` - the repository's `STATUS.md` hash differs from `status_md_sha256` in the note;
- `status_md_newer_than_note` - `STATUS.md` mtime is later than the note's `last_verified`;
- `status_md_reports_unverified_items` - `STATUS.md` mentions NOT VERIFIED/UNKNOWN/blocked early on.

Signals say a note *may* be stale; they never rewrite anything.

## Sentinel (optional)

Disabled by default. `vymem config set sentinel.enabled true`, then `vymem sentinel run` (one scan) or `vymem sentinel watch` (a foreground loop every `sentinel.intervalMinutes`). It scans `workspaces.roots` (depth `workspaces.maxDepth`, honouring `workspaces.exclude`) and writes one draft snapshot, `Inbox/AI Inbox/sentinel/workspace-snapshot.md`, listing each repository, its mapped project, branch, `HEAD`, dirty-file count, `STATUS.md` presence and freshness. Unchanged results are deduplicated. It never edits notes or repositories, and records repository *names* only unless `privacy.recordAbsolutePaths` is `true`. VYMEM does not install any scheduler; run `watch` under your own supervisor if you want it continuous.

## Approval workflow

| You want to | Command | Safeguards |
| --- | --- | --- |
| approve an inbox record | `vymem approve <record_id> --by <you> --yes` | sets `approved_by_owner: true`; agents can no longer overwrite it; backup + audit |
| apply a proposal | `vymem proposals apply <id> --by <you> --yes [--expected-sha <sha>]` | target must be unchanged since the proposal (else `CONFLICT_DETECTED`), unlocked, no protected keys, no secrets; section appended once; backup of target and proposal; audit |
| reject a proposal | `vymem proposals reject <id> --by <you> --yes` | marks rejected |
| undo a change | `vymem rollback --backup <path under .vymem/backups> --target <note> --by <you> --yes` | only files from the backup folder; pre-restore backup |

## Local privacy

Nothing leaves the machine through VYMEM. Hook ledgers store file paths, redacted command lines and a redacted 220-character prompt excerpt, in `.vymem/sessions/`, pruned by `vymem prune` (retention defaults: backups 90 days, audit 365 days, ledgers 14 days; `prune` is a dry run without `--yes`).
