import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const anonymousSessionsTable = pgTable(
  "anonymous_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    anonymousId: uuid("anonymous_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    pgPolicy("anonymous_sessions_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("anonymous_sessions_anonymous_id_idx").on(table.anonymousId),
    uniqueIndex("anonymous_sessions_token_hash_idx").on(table.tokenHash),
    index("anonymous_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const insertAnonymousSessionSchema = createInsertSchema(anonymousSessionsTable).omit({
  id: true,
  createdAt: true,
  lastSeenAt: true,
});
export type InsertAnonymousSession = z.infer<typeof insertAnonymousSessionSchema>;
export type AnonymousSession = typeof anonymousSessionsTable.$inferSelect;