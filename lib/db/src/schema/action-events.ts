import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { actionsTable } from "./actions";
import { cellsTable } from "./cells";
import { roomsTable } from "./rooms";
import { actionStatusEnum } from "./actions";

export const actionEventTypeEnum = pgEnum("action_event_type", [
  "queued",
  "started",
  "hit",
  "completed",
  "cancelled",
  "failed",
]);

export const actionEventsTable = pgTable(
  "action_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actionsTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => roomsTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    cellId: uuid("cell_id")
      .notNull()
      .references(() => cellsTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sequence: numeric("sequence", { precision: 20, scale: 0 }).notNull(),
    eventType: actionEventTypeEnum("event_type").notNull(),
    status: actionStatusEnum("status"),
    deltaValue: numeric("delta_value", { precision: 14, scale: 6 }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("action_events_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("action_events_action_sequence_idx").on(table.actionId, table.sequence),
    index("action_events_room_occurred_at_idx").on(table.roomId, table.occurredAt),
    index("action_events_cell_occurred_at_idx").on(table.cellId, table.occurredAt),
  ],
);

export const insertActionEventSchema = createInsertSchema(actionEventsTable).omit({
  id: true,
  occurredAt: true,
});
export type InsertActionEvent = z.infer<typeof insertActionEventSchema>;
export type ActionEvent = typeof actionEventsTable.$inferSelect;