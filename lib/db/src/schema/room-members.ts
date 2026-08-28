import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgPolicy,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { roomsTable } from "./rooms";
import { anonymousSessionsTable } from "./sessions";

export const roomMembersTable = pgTable(
  "room_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => roomsTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => anonymousSessionsTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    active: boolean("active").notNull().default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    pgPolicy("room_members_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("room_members_room_session_idx").on(table.roomId, table.sessionId),
    index("room_members_room_active_idx").on(table.roomId, table.active),
    index("room_members_last_seen_idx").on(table.lastSeenAt),
  ],
);

export const insertRoomMemberSchema = createInsertSchema(roomMembersTable).omit({
  id: true,
  joinedAt: true,
  lastSeenAt: true,
});
export type InsertRoomMember = z.infer<typeof insertRoomMemberSchema>;
export type RoomMember = typeof roomMembersTable.$inferSelect;