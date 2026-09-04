import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { actionTypesTable } from "./action-types";

export const actionLevelsTable = pgTable(
  "action_levels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    actionTypeId: uuid("action_type_id").references(() => actionTypesTable.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    label: varchar("label", { length: 120 }).notNull(),
    powerLabel: varchar("power_label", { length: 32 }),
    emoji: varchar("emoji", { length: 16 }),
    multiplier: numeric("multiplier", { precision: 14, scale: 2 }).notNull().default("1"),
    sortOrder: integer("sort_order").notNull(),
    startDelayMs: integer("start_delay_ms").notNull().default(0),
    projectileCount: integer("projectile_count").notNull(),
    staggerMs: integer("stagger_ms").notNull(),
    durationMs: integer("duration_ms").notNull(),
    growthPerHit: numeric("growth_per_hit", { precision: 14, scale: 6 }).notNull(),
    impactMultiplier: numeric("impact_multiplier", { precision: 14, scale: 6 }).notNull().default("1"),
    shake: boolean("shake").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("action_levels_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("action_levels_sort_order_idx").on(table.sortOrder),
    index("action_levels_type_sort_idx").on(table.actionTypeId, table.sortOrder),
  ],
);

export const insertActionLevelSchema = createInsertSchema(actionLevelsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertActionLevel = z.infer<typeof insertActionLevelSchema>;
export type ActionLevel = typeof actionLevelsTable.$inferSelect;