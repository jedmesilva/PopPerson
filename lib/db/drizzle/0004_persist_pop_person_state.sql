ALTER TABLE "people" ADD COLUMN "status" varchar(32) DEFAULT 'titular' NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "completes_at" timestamp with time zone;--> statement-breakpoint
UPDATE "actions"
SET "completes_at" = COALESCE("scheduled_for", now())
WHERE "completes_at" IS NULL;--> statement-breakpoint
ALTER TABLE "actions" ALTER COLUMN "completes_at" SET NOT NULL;