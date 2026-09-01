import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const countriesTable = pgTable(
  "countries",
  {
    code2: varchar("code2", { length: 2 }).primaryKey(),
    code3: varchar("code3", { length: 3 }).notNull().unique(),
    name: text("name").notNull(),
    nameEnglish: text("name_english").notNull(),
    aliases: text("aliases").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("countries_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
  ],
);

export const insertCountrySchema = createInsertSchema(countriesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertCountry = z.infer<typeof insertCountrySchema>;
export type Country = typeof countriesTable.$inferSelect;