---
name: Atomic realtime snapshot
description: Realtime recovery must pair the visible PostgreSQL state with the outbox cursor from one transaction.
---

The realtime snapshot contract returns the authoritative room state and the
matching global outbox sequence from the same PostgreSQL transaction.

**Why:** Reading the state and cursor independently can produce a snapshot that
looks newer than the state it contains, causing clients to skip durable events
after a concurrent commit.

**How to apply:** Use the transactional snapshot for initial WebSocket state,
gap recovery, and state-change broadcasts. Treat PostgreSQL `LISTEN/NOTIFY` as
only a wake-up signal; replay and recovery must remain cursor-based.