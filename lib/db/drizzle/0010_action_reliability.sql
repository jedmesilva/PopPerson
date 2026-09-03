ALTER TABLE "actions"
  ADD COLUMN IF NOT EXISTS "max_attempts" integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "retry_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamptz;

CREATE INDEX IF NOT EXISTS "actions_retry_at_idx"
  ON "actions" ("status", "retry_at");

CREATE INDEX IF NOT EXISTS "actions_lease_expires_at_idx"
  ON "actions" ("status", "lease_expires_at");