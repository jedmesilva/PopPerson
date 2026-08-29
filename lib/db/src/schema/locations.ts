import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const locationsTable = pgTable(
  "locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    stateCode: varchar("state_code", { length: 16 }).notNull(),
    country: text("country").notNull(),
    countryCode: varchar("country_code", { length: 8 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("locations_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("locations_country_state_city_idx").on(
      table.countryCode,
      table.stateCode,
      table.city,
    ),
  ],
);

export const insertLocationSchema = createInsertSchema(locationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locationsTable.$inferSelect;