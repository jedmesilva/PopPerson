import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
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

export const actionLevelsTable = pgTable(
  "action_levels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    label: varchar("label", { length: 120 }).notNull(),
    powerLabel: varchar("power_label", { length: 32 }),
    emoji: varchar("emoji", { length: 16 }),
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
  ],
);

export const insertActionLevelSchema = createInsertSchema(actionLevelsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertActionLevel = z.infer<typeof insertActionLevelSchema>;
export type ActionLevel = typeof actionLevelsTable.$inferSelect;