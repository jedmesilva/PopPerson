---
name: Action event sequencing
description: Event sequences are unique per action and must reserve distinct slots for queued, started, hits, and completed.
---

The completion event must use a sequence after the last hit for that action; never reuse the first hit or a fixed sequence number.

**Why:** Reusing a sequence violates the action event unique index, rolls back the worker transaction, and can leave the oldest running action blocking progress for every later action.

**How to apply:** When changing action processing, keep event numbering idempotent and verify that a completed action can be finalized even after a worker restart or partial backlog recovery.