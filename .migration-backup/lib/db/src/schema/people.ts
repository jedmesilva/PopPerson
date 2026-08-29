import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { categoriesTable } from "./categories";
import { locationsTable } from "./locations";

export const peopleTable = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 160 }).notNull().unique(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categoriesTable.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    gender: varchar("gender", { length: 1 }),
    color: varchar("color", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("titular"),
    imageUrl: text("image_url"),
    locationId: uuid("location_id").references(() => locationsTable.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("people_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    index("people_category_idx").on(table.categoryId),
    index("people_location_idx").on(table.locationId),
  ],
);

export const insertPersonSchema = createInsertSchema(peopleTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof peopleTable.$inferSelect;