ALTER TABLE "action_levels" ADD COLUMN "power_label" varchar(32);--> statement-breakpoint
ALTER TABLE "action_levels" ADD COLUMN "shake" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "emoji" varchar(16);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "gender" varchar(1);