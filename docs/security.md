# Security model

VYMEM is a local tool that sits between AI agents and a folder of notes. This page states what it enforces, what it cannot, and how to reduce risk. It has not had an independent security review.

## MCP permission restrictions are not operating-system sandboxing

`mcp.permission = read` or `propose` limits what the **VYMEM gateway process** will do when called through MCP. It does not limit the agent. An agent that can run shell commands, or that runs with your file permissions, can:

- read or edit any file you can, including your vault and `.vymem/`;
- run `vymem approve ... --yes` or `vymem proposals apply ... --yes` itself - the CLI authenticates nobody; `--by` is a free-text label.

So the approval boundary is real against an agent that only has MCP access, and only as strong as your client's shell/command permissions otherwise. Recommended hardening, none of which VYMEM can enforce:

- configure your client to require confirmation for, or deny, shell commands that start with `vymem approve`, `vymem proposals apply` and `vymem rollback`;
- keep vaults you care about under a separate OS user or container if you run agents unattended;
- keep `privacy.blockedFolders` for anything an agent should never see through VYMEM, and keep truly secret material out of the vault entirely.

## What is enforced (and tested)

| Control | Behaviour | Error code |
| --- | --- | --- |
| Path policy | vault-relative `.md` only; no absolute/UNC/URI paths, no `..`, no control characters | `PATH_TRAVERSAL_BLOCKED`, `PATH_OUTSIDE_ALLOWLIST`, `INVALID_PATH`, `UNSUPPORTED_EXTENSION` |
| Hidden paths | any segment starting with `.` (incl. `.obsidian`, `.git`, `.vymem`) and `node_modules` | `FORBIDDEN_PATH` |
| Symlinks | real path must stay inside the vault | `SYMLINK_ESCAPE_BLOCKED` |
| Blocked folders | `privacy.blockedFolders` never read/searched/written | `BLOCKED_FOLDER` |
| Write confinement | `submit_knowledge_entry` writes only under the inbox; vault-root writes refused | `UNAUTHORIZED_WRITE` |
| Read-only mode | write tools refused | `UNAUTHORIZED_WRITE` |
| No privileged MCP tool | nothing applies proposals, approves records or restores backups | (absent) |
| Locks | `human_locked`, `manual_override` and approved records reject agent changes; `locked_fields` and protected keys (`record_id`, `approved_by_owner`, `human_locked`, ...) cannot be patched | `HUMAN_LOCKED`, `PROTECTED_FRONTMATTER_KEY`, `LOCKED_FIELDS_CONFLICT` |
| Secret screen | submissions/proposals containing credential-like strings are rejected; stored text is redacted on read, in briefings and in hook ledgers | `REJECTED_SECRET_DETECTED` |
| Conflict detection | stale `expected_sha256`, record-id/owner collisions, target changed since proposal | `CONFLICT_DETECTED` |
| Anti-impersonation | `handoff.originating_agent` must equal `owner_agent` | `IDENTITY_MISMATCH` |
| Install safety | invalid client JSON is never overwritten; foreign same-named entries are never replaced or removed | `INVALID_CLIENT_CONFIG`, `FOREIGN_ENTRY_CONFLICT` |
| Consent | install/uninstall are dry runs without `--yes`; approve/apply/reject/rollback refuse without it | `EXPLICIT_APPROVAL_REQUIRED` |
| Auditability | every write appends to `.vymem/audit-log.jsonl`; every overwrite is backed up under `.vymem/backups/` | - |

## Known limitations

- **Secret detection is pattern based.** It catches common token formats, private-key headers, credentialed database URLs, bearer tokens and `password=`-style assignments. It will miss unusual formats and obfuscated values. Add patterns in `privacy.extraSecretPatterns`. Never store secrets in notes.
- **Prompt injection.** Notes and handoffs are data an agent will read. A malicious or mistaken note can still influence a model. VYMEM labels this data and keeps agent-written content visibly unapproved; it cannot prevent a model from being persuaded.
- **`owner_agent` is self-declared.** The anti-impersonation check stops accidental mismatches and cross-agent overwrites, not a hostile agent that lies consistently.
- **The audit log and backups are plain files** inside the vault; anything with write access can alter them. They are for recovery and review, not tamper-proofing.
- **Hook payloads are untrusted input.** They are parsed defensively; failures are swallowed so a hook can never block a session.
- **Locks are advisory** and assume a local file system.
- **Hook ledgers** (`.vymem/sessions/`) hold file paths, redacted test command lines and a redacted, truncated first prompt. They are pruned by `vymem prune`.
- **Freshness checks execute `git`** read-only commands in repositories you configured; a malicious repository configuration (e.g. a hostile `core.fsmonitor`) could run code when git inspects it. Only add workspace roots you trust.
- **Install edits files in your home directory** (client configs). It backs them up first; restoring is `vymem uninstall` or copying the backup from `<config dir>/backups/`.

## Privacy

VYMEM makes no network connections and collects no telemetry. The only subprocesses it starts are `git` (read-only), and its own `vymem mcp` process during `vymem doctor`. Your notes stay in your vault; what an agent does with retrieved text is governed by that agent's provider, not by VYMEM.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or an issue without exploit details if advisories are unavailable.
