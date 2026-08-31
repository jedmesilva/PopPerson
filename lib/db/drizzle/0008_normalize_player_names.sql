UPDATE "people" AS people
SET "name" = users."name",
    "updated_at" = NOW()
FROM "users" AS users
WHERE people."player_user_id" = users."id"
  AND people."name" <> users."name";