---
title: "Use idempotency keys for payment calls"
entity_type: decision
knowledge_status: canonical
verification_status: owner_authored
last_verified: 2026-01-10
summary: "Every outbound payment request from orders-api must carry an idempotency key so retries cannot double charge."
---

# Use idempotency keys for payment calls

**Decision:** Every outbound payment request made by orders-api carries an idempotency key derived from the order id.

**Why:** The retry wrapper can resend a request after a timeout. Without a key the provider may charge twice.

**Consequences:** Retry changes in orders-api must keep the key stable across attempts.
