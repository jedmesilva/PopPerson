CREATE TYPE "public"."action_event_type" AS ENUM('queued', 'started', 'hit', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."action_status" AS ENUM('queued', 'running', 'completed', 'cancelled', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."action_mode" AS ENUM('atacar', 'defender');--> statement-breakpoint
CREATE TABLE "access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"ip_address" "inet",
	"user_agent" text,
	"city" text,
	"region" text,
	"country" text,
	"country_code" varchar(8),
	"timezone" text,
	"location_source" varchar(32),
	"request_path" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"cell_id" uuid NOT NULL,
	"sequence" numeric(20, 0) NOT NULL,
	"event_type" "action_event_type" NOT NULL,
	"status" "action_status",
	"delta_value" numeric(14, 6),
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"label" varchar(120) NOT NULL,
	"sort_order" integer NOT NULL,
	"projectile_count" integer NOT NULL,
	"stagger_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"growth_per_hit" numeric(14, 6) NOT NULL,
	"impact_multiplier" numeric(14, 6) DEFAULT '1' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_levels_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"cell_id" uuid NOT NULL,
	"session_id" uuid,
	"item_id" uuid NOT NULL,
	"action_level_id" uuid NOT NULL,
	"mode" "action_mode" NOT NULL,
	"status" "action_status" DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"effective_impact" numeric(14, 6),
	"price_charged" numeric(14, 2),
	"rule_snapshot" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"background_color" varchar(32) NOT NULL,
	"current_value" numeric(14, 4) DEFAULT '10' NOT NULL,
	"minimum_value" numeric(14, 4) DEFAULT '2' NOT NULL,
	"maximum_value" numeric(14, 4),
	"state_version" numeric(20, 0) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_action_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"action_level_id" uuid NOT NULL,
	"impact_multiplier" numeric(14, 6),
	"growth_per_hit" numeric(14, 6),
	"projectile_count" integer,
	"stagger_ms" integer,
	"duration_ms" integer,
	"price_override" numeric(14, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(80) NOT NULL,
	"mode" "action_mode" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"impact_power" numeric(14, 4) NOT NULL,
	"price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"state_code" varchar(16) NOT NULL,
	"country" text NOT NULL,
	"country_code" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(160) NOT NULL,
	"role_title" text,
	"image_url" text,
	"location_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "anonymous_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_session_id_anonymous_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."anonymous_sessions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "action_events" ADD CONSTRAINT "action_events_cell_id_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."cells"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_cell_id_cells_id_fk" FOREIGN KEY ("cell_id") REFERENCES "public"."cells"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_session_id_anonymous_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."anonymous_sessions"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_action_level_id_action_levels_id_fk" FOREIGN KEY ("action_level_id") REFERENCES "public"."action_levels"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cells" ADD CONSTRAINT "cells_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cells" ADD CONSTRAINT "cells_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "item_action_rules" ADD CONSTRAINT "item_action_rules_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "item_action_rules" ADD CONSTRAINT "item_action_rules_action_level_id_action_levels_id_fk" FOREIGN KEY ("action_level_id") REFERENCES "public"."action_levels"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "access_events_session_idx" ON "access_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "access_events_accessed_at_idx" ON "access_events" USING btree ("accessed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "action_events_action_sequence_idx" ON "action_events" USING btree ("action_id","sequence");--> statement-breakpoint
CREATE INDEX "action_events_room_occurred_at_idx" ON "action_events" USING btree ("room_id","occurred_at");--> statement-breakpoint
CREATE INDEX "action_events_cell_occurred_at_idx" ON "action_events" USING btree ("cell_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "action_levels_sort_order_idx" ON "action_levels" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "actions_session_idempotency_idx" ON "actions" USING btree ("session_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "actions_room_status_idx" ON "actions" USING btree ("room_id","status");--> statement-breakpoint
CREATE INDEX "actions_cell_requested_at_idx" ON "actions" USING btree ("cell_id","requested_at");--> statement-breakpoint
CREATE INDEX "actions_scheduled_for_idx" ON "actions" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "cells_room_person_idx" ON "cells" USING btree ("room_id","person_id");--> statement-breakpoint
CREATE INDEX "cells_room_updated_idx" ON "cells" USING btree ("room_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "item_action_rules_pair_idx" ON "item_action_rules" USING btree ("item_id","action_level_id");--> statement-breakpoint
CREATE INDEX "items_mode_active_idx" ON "items" USING btree ("mode","active");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_country_state_city_idx" ON "locations" USING btree ("country_code","state_code","city");--> statement-breakpoint
CREATE INDEX "people_location_idx" ON "people" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anonymous_sessions_anonymous_id_idx" ON "anonymous_sessions" USING btree ("anonymous_id");--> statement-breakpoint
CREATE UNIQUE INDEX "anonymous_sessions_token_hash_idx" ON "anonymous_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "anonymous_sessions_expiry_idx" ON "anonymous_sessions" USING btree ("expires_at");