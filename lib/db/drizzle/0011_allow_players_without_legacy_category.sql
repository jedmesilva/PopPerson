-- Categories are no longer part of the player flow. Keep the legacy column and
-- values for existing records, but allow new or updated players to omit it.
ALTER TABLE "people"
  ALTER COLUMN "category_id" DROP NOT NULL;