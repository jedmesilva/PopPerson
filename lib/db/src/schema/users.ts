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
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    xUserId: text("x_user_id").notNull(),
    username: text("username").notNull(),
    name: text("name").notNull(),
    xLocation: text("x_location"),
    lastAccessCity: text("last_access_city"),
    lastAccessRegion: text("last_access_region"),
    lastAccessCountry: text("last_access_country"),
    lastAccessCountryCode: varchar("last_access_country_code", { length: 8 }),
    lastAccessTimezone: text("last_access_timezone"),
    lastAccessLocationSource: varchar("last_access_location_source", { length: 32 }),
    lastAccessLocationAt: timestamp("last_access_location_at", { withTimezone: true }),
    avatarUrl: text("avatar_url"),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("users_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("users_x_user_id_idx").on(table.xUserId),
    index("users_username_idx").on(table.username),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;