-- The action system now resolves its behavior exclusively from action_types
-- and action_levels. Keep action history, but remove the legacy item link and
-- configuration tables.
ALTER TABLE "actions"
  DROP COLUMN IF EXISTS "item_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "item_action_rules";
--> statement-breakpoint
DROP TABLE IF EXISTS "items";