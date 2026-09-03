import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { actionsTable } from "./actions";
import { cellsTable } from "./cells";
import { roomsTable } from "./rooms";

export const realtimeOutboxTable = pgTable(
  "realtime_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => roomsTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    actionId: uuid("action_id").references(() => actionsTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    cellId: uuid("cell_id").references(() => cellsTable.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    topic: varchar("topic", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("realtime_outbox_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("realtime_outbox_sequence_idx").on(table.sequence),
    index("realtime_outbox_room_sequence_idx").on(table.roomId, table.sequence),
    index("realtime_outbox_retention_idx").on(table.retentionUntil),
    index("realtime_outbox_action_idx").on(table.actionId, table.sequence),
  ],
);

export const insertRealtimeOutboxSchema = createInsertSchema(realtimeOutboxTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRealtimeOutbox = z.infer<typeof insertRealtimeOutboxSchema>;
export type RealtimeOutbox = typeof realtimeOutboxTable.$inferSelect;