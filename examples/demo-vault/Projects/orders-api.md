---
entity_type: project
project_name: "orders-api"
lifecycle: active
verification_status: owner_authored
local_path: "{{ORDERS_API_PATH}}"
repository_url: "https://example.invalid/demo-co/orders-api"
tech_stack: "Node.js, Express, PostgreSQL"
git_commit: "{{ORDERS_API_HEAD}}"
last_verified: 2026-01-15
summary: "Fictional order-intake REST API for the Demo Co storefront."
---

# orders-api

## Purpose
Accepts customer orders from the storefront, validates them and hands them to the payment worker.

## Architecture
A single Express service with a PostgreSQL store. Payment calls go through an outbound retry wrapper in `src/retry.js`.

## Status
Staging deploy is current. Production deploy has not been independently verified in this note.

## Blockers
- Retry wrapper has no jitter; two incidents of synchronized retries were reported.

## Next steps
- Add jitter to the retry wrapper.
- Add an idempotency key to payment requests.
