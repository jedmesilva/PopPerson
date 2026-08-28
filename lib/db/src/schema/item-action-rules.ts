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
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { actionLevelsTable } from "./action-levels";
import { itemsTable } from "./items";

export const itemActionRulesTable = pgTable(
  "item_action_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => itemsTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    actionLevelId: uuid("action_level_id")
      .notNull()
      .references(() => actionLevelsTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    startDelayMs: integer("start_delay_ms"),
    impactMultiplier: numeric("impact_multiplier", { precision: 14, scale: 6 }),
    growthPerHit: numeric("growth_per_hit", { precision: 14, scale: 6 }),
    projectileCount: integer("projectile_count"),
    staggerMs: integer("stagger_ms"),
    durationMs: integer("duration_ms"),
    priceOverride: numeric("price_override", { precision: 14, scale: 2 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("item_action_rules_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("item_action_rules_pair_idx").on(table.itemId, table.actionLevelId),
  ],
);

export const insertItemActionRuleSchema = createInsertSchema(itemActionRulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertItemActionRule = z.infer<typeof insertItemActionRuleSchema>;
export type ItemActionRule = typeof itemActionRulesTable.$inferSelect;