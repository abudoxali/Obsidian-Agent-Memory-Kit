---
entity_type: project
project_name: "ledger-web"
lifecycle: active
verification_status: owner_authored
human_locked: true
local_path: "{{LEDGER_WEB_PATH}}"
tech_stack: "TypeScript, React"
git_commit: "{{LEDGER_WEB_HEAD}}"
last_verified: 2026-01-12
summary: "Fictional internal web UI for finance staff to review ledger entries."
---

# ledger-web

## Purpose
A read-mostly review screen over the ledger export. Owner-maintained; this note is locked against automatic edits.

## Architecture
Static React front end that reads a nightly export.

## Status
Stable. No open incidents.

## Blockers
None recorded.

## Next steps
- Evaluate pagination for very large exports.
