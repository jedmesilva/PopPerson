import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { actionTypesTable } from "./action-types";
import { actionLevelsTable } from "./action-levels";
import { anonymousSessionsTable } from "./sessions";
import { cellsTable } from "./cells";
import { roomsTable } from "./rooms";

export const actionModeEnum = pgEnum("action_mode", ["atacar", "defender"]);

export const actionStatusEnum = pgEnum("action_status", [
  "queued",
  "running",
  "completed",
  "cancelled",
  "rejected",
  "failed",
]);

export const actionsTable = pgTable(
  "actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => roomsTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    cellId: uuid("cell_id")
      .notNull()
      .references(() => cellsTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sourceCellId: uuid("source_cell_id").references(() => cellsTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    sessionId: uuid("session_id").references(() => anonymousSessionsTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actionTypeId: uuid("action_type_id").references(() => actionTypesTable.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    actionLevelId: uuid("action_level_id")
      .notNull()
      .references(() => actionLevelsTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    mode: actionModeEnum("mode").notNull(),
    status: actionStatusEnum("status").notNull().default("queued"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    startDelayMs: integer("start_delay_ms").notNull().default(0),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    completesAt: timestamp("completes_at", { withTimezone: true }).notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    effectiveImpact: numeric("effective_impact", { precision: 14, scale: 6 }),
    priceCharged: numeric("price_charged", { precision: 14, scale: 2 }),
    priceCurrency: varchar("price_currency", { length: 3 }).notNull().default("usd"),
    ruleSnapshot: jsonb("rule_snapshot").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("actions_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("actions_session_idempotency_idx").on(table.sessionId, table.idempotencyKey),
    index("actions_room_status_idx").on(table.roomId, table.status),
    index("actions_cell_requested_at_idx").on(table.cellId, table.requestedAt),
    index("actions_source_cell_idx").on(table.sourceCellId),
    index("actions_scheduled_for_idx").on(table.status, table.scheduledFor),
  ],
);

export const insertActionSchema = createInsertSchema(actionsTable).omit({
  id: true,
  requestedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAction = z.infer<typeof insertActionSchema>;
export type Action = typeof actionsTable.$inferSelect;