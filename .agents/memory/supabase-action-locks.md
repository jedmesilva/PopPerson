---
name: Supabase action lock contention
description: Session-mode Supabase pooling can expose stale worker transactions that retain per-cell advisory locks.
---

Keep action-worker transactions short and avoid per-hit NOTIFY calls inside them when the durable outbox is already polled.

**Why:** A stale `idle in transaction` worker session held a cell advisory lock and made every later action retry indefinitely; the session pooler also amplified the connection pressure.

**How to apply:** When actions stop progressing, inspect advisory locks and idle transactions before changing action data. Keep worker concurrency and pool sizes bounded, and reload the worker only after active work has drained when possible.