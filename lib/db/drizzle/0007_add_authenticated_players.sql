ALTER TABLE "people"
  ADD COLUMN IF NOT EXISTS "player_user_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'people_player_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "people"
      ADD CONSTRAINT "people_player_user_id_users_id_fk"
      FOREIGN KEY ("player_user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_player_user_idx"
  ON "people" USING btree ("player_user_id");