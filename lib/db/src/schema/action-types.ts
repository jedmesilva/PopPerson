import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const actionTypeCodeEnum = pgEnum("action_type_code", ["hate", "fan"]);

export const actionTypesTable = pgTable(
  "action_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: actionTypeCodeEnum("code").notNull().unique(),
    label: varchar("label", { length: 80 }).notNull(),
    basePriceCurrent: numeric("base_price_current", { precision: 14, scale: 2 })
      .notNull()
      .default("1"),
    basePriceMinimum: numeric("base_price_minimum", { precision: 14, scale: 2 })
      .notNull()
      .default("0.1"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("action_types_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    index("action_types_active_idx").on(table.active),
  ],
);

export const insertActionTypeSchema = createInsertSchema(actionTypesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertActionType = z.infer<typeof insertActionTypeSchema>;
export type ActionType = typeof actionTypesTable.$inferSelect;