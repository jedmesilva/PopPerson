import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const actionModeEnum = pgEnum("action_mode", ["atacar", "defender"]);

export const itemsTable = pgTable(
  "items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    mode: actionModeEnum("mode").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    emoji: varchar("emoji", { length: 16 }),
    gender: varchar("gender", { length: 1 }),
    imageUrl: text("image_url"),
    impactPower: numeric("impact_power", { precision: 14, scale: 4 }).notNull(),
    price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("items_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    index("items_mode_active_idx").on(table.mode, table.active),
  ],
);

export const insertItemSchema = createInsertSchema(itemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof itemsTable.$inferSelect;