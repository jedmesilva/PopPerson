# InstaPop high-load operations

## Process topology

The API/WebSocket gateway and the action worker are separate processes. Both
use the same PostgreSQL database. The gateway reads the durable realtime
outbox and uses PostgreSQL `LISTEN/NOTIFY` only as a low-latency wake-up signal;
replay and recovery always come from the outbox or a consistent snapshot.

For Railway, create two services from this repository:

- **gateway**: leave `POP_PERSON_PROCESS_ROLE` unset (or set it to `gateway`);
- **worker**: set `POP_PERSON_PROCESS_ROLE=worker`.

Both services must use the same database and application secrets. The worker
must not receive public traffic. The start command selects the compiled
`dist/index.mjs` or `dist/worker.mjs`, so production never depends on `tsx`.

## Queue safety

Action admission is serialized only for the short backlog-counting transaction.
Resolution is still parallel by target cell. A claimed action has a persisted
lease, retry timestamp, attempt counter, and maximum attempt count. Failures
use exponential backoff and become `failed`/dead-lettered after the limit.

The action endpoint returns `429` with `Retry-After: 1` and a stable `code`
when either the global or per-session backlog is full.

## Realtime recovery

Every outbox row has a global identity sequence. Clients validate every
sequence in an effects batch, discard duplicates, and request a resume when a
gap is detected. The server answers an unreplayable gap with
`resync.required` followed by an atomic snapshot containing the matching
outbox sequence and PostgreSQL state version.

The gateway keeps a bounded per-client outbound queue. Slow clients are closed
with WebSocket code `1013`; authoritative actions remain persisted and can be
recovered by a later snapshot.

## Operational checks

Before a release, verify:

1. gateway `/api/healthz` is healthy;
2. gateway `/api/readyz` reports a fresh `pop-person-actions` worker heartbeat;
3. `/api/metrics` has no growing `realtime.delivery_errors`;
4. a worker restart leaves queued actions recoverable;
5. a reconnecting client receives either replay or `resync.required` + snapshot.