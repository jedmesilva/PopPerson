CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "x_user_id" text NOT NULL,
  "username" text NOT NULL,
  "name" text NOT NULL,
  "avatar_url" text,
  "email" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_x_user_id_idx"
  ON "users" USING btree ("x_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_username_idx"
  ON "users" USING btree ("username");
--> statement-breakpoint
ALTER TABLE "anonymous_sessions"
  ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'anonymous_sessions_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "anonymous_sessions"
      ADD CONSTRAINT "anonymous_sessions_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anonymous_sessions_user_idx"
  ON "anonymous_sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "user_agent" text,
  "ip_address" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "auth_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_token_hash_idx"
  ON "auth_sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx"
  ON "auth_sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_expiry_idx"
  ON "auth_sessions" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND policyname = 'users_server_only'
  ) THEN
    CREATE POLICY "users_server_only" ON "users"
      AS PERMISSIVE FOR ALL TO public
      USING (false) WITH CHECK (false);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'auth_sessions'
      AND policyname = 'auth_sessions_server_only'
  ) THEN
    CREATE POLICY "auth_sessions_server_only" ON "auth_sessions"
      AS PERMISSIVE FOR ALL TO public
      USING (false) WITH CHECK (false);
  END IF;
END $$;