ALTER TABLE "access_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cells" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "item_action_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "room_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "anonymous_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "access_events_server_only" ON "access_events" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "action_events_server_only" ON "action_events" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "action_levels_server_only" ON "action_levels" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "actions_server_only" ON "actions" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "cells_server_only" ON "cells" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "item_action_rules_server_only" ON "item_action_rules" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "items_server_only" ON "items" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "locations_server_only" ON "locations" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "people_server_only" ON "people" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "room_members_server_only" ON "room_members" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "rooms_server_only" ON "rooms" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "anonymous_sessions_server_only" ON "anonymous_sessions" AS PERMISSIVE FOR ALL TO public USING (false) WITH CHECK (false);