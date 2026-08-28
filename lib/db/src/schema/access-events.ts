import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  index,
  inet,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { anonymousSessionsTable } from "./sessions";

export const accessEventsTable = pgTable(
  "access_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").references(() => anonymousSessionsTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    city: text("city"),
    region: text("region"),
    country: text("country"),
    countryCode: varchar("country_code", { length: 8 }),
    timezone: text("timezone"),
    locationSource: varchar("location_source", { length: 32 }),
    requestPath: text("request_path"),
    accessedAt: timestamp("accessed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("access_events_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    index("access_events_session_idx").on(table.sessionId),
    index("access_events_accessed_at_idx").on(table.accessedAt),
  ],
);

export const insertAccessEventSchema = createInsertSchema(accessEventsTable).omit({
  id: true,
  accessedAt: true,
});
export type InsertAccessEvent = z.infer<typeof insertAccessEventSchema>;
export type AccessEvent = typeof accessEventsTable.$inferSelect;