---
title: "Retry wrappers need jitter"
entity_type: agent_memory
knowledge_status: canonical
verification_status: owner_authored
last_verified: 2026-01-11
summary: "Lesson: exponential backoff without jitter causes synchronized retry storms; orders-api hit this twice."
---

# Retry wrappers need jitter

Exponential backoff without random jitter makes many clients retry at the same instants. In orders-api this produced two retry storms against the payment provider. Prefer full jitter and cap the maximum delay.
