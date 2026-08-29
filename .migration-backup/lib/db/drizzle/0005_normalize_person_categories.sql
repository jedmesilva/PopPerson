ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "gender" varchar(1);
--> statement-breakpoint

-- Preserve the gender distinction on each person before consolidating role categories.
UPDATE "people" AS p
SET "gender" = 'f',
    "updated_at" = now()
FROM "categories" AS c
WHERE p."category_id" = c."id"
  AND p."gender" IS NULL
  AND c."slug" IN (
    'politica-b30567b0e18ae43b5db00f11c3f5feb0',
    'politica-3e37c6e2804b4eee6b6e4501f75e1ee8',
    'politica-d298da0a6511b6bcae69ef3c16ac251f',
    'politica-ae2d7efaf686a93a2742edbbbd7f7e67'
  );
--> statement-breakpoint

UPDATE "people" AS p
SET "gender" = 'm',
    "updated_at" = now()
FROM "categories" AS c
WHERE p."category_id" = c."id"
  AND p."gender" IS NULL
  AND c."slug" IN (
    'politica-c02fa95ce8f02192ca21638bdec9cb19',
    'politica-f4a018eea733ed756ca6626a6b5f48af',
    'politica-b2c8d300b02bdc09c64115c42900f5a9',
    'politica-90168f21cce05c3f37a58b3769787c1c'
  );
--> statement-breakpoint

-- Keep one canonical category for each cargo and move people off gendered duplicates.
UPDATE "people" AS p
SET "category_id" = canonical."id",
    "updated_at" = now()
FROM "categories" AS duplicate
JOIN "categories" AS canonical
  ON canonical."slug" = CASE duplicate."slug"
    WHEN 'politica-b30567b0e18ae43b5db00f11c3f5feb0'
      THEN 'politica-c02fa95ce8f02192ca21638bdec9cb19'
    WHEN 'politica-3e37c6e2804b4eee6b6e4501f75e1ee8'
      THEN 'politica-90168f21cce05c3f37a58b3769787c1c'
  END
WHERE p."category_id" = duplicate."id"
  AND duplicate."slug" IN (
    'politica-b30567b0e18ae43b5db00f11c3f5feb0',
    'politica-3e37c6e2804b4eee6b6e4501f75e1ee8'
  );
--> statement-breakpoint

DELETE FROM "categories"
WHERE "slug" IN (
  'politica-b30567b0e18ae43b5db00f11c3f5feb0',
  'politica-3e37c6e2804b4eee6b6e4501f75e1ee8'
);
--> statement-breakpoint

-- Use the canonical cargo label for the remaining feminine-only categories too.
UPDATE "categories"
SET "name" = CASE "slug"
  WHEN 'politica-d298da0a6511b6bcae69ef3c16ac251f' THEN 'Ministro'
  WHEN 'politica-ae2d7efaf686a93a2742edbbbd7f7e67' THEN 'Vereador'
END,
    "updated_at" = now()
WHERE "slug" IN (
  'politica-d298da0a6511b6bcae69ef3c16ac251f',
  'politica-ae2d7efaf686a93a2742edbbbd7f7e67'
);