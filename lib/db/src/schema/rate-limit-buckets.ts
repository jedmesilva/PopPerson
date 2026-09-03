import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  integer,
  pgPolicy,
  pgTable,
  timestamp,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const rateLimitBucketsTable = pgTable(
  "rate_limit_buckets",
  {
    name: text("name").notNull(),
    bucketKey: text("bucket_key").notNull(),
    count: integer("count").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("rate_limit_buckets_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("rate_limit_buckets_name_key_idx").on(table.name, table.bucketKey),
  ],
);

export const insertRateLimitBucketSchema = createInsertSchema(rateLimitBucketsTable);
export type InsertRateLimitBucket = z.infer<typeof insertRateLimitBucketSchema>;
export type RateLimitBucket = typeof rateLimitBucketsTable.$inferSelect;