import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const workerHeartbeatsTable = pgTable(
  "worker_heartbeats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    role: text("role").notNull(),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("worker_heartbeats_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
  ],
);

export const insertWorkerHeartbeatSchema = createInsertSchema(workerHeartbeatsTable).omit({
  id: true,
});
export type InsertWorkerHeartbeat = z.infer<typeof insertWorkerHeartbeatSchema>;
export type WorkerHeartbeat = typeof workerHeartbeatsTable.$inferSelect;