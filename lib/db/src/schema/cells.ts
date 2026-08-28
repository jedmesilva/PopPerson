import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  numeric,
  pgPolicy,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { peopleTable } from "./people";
import { roomsTable } from "./rooms";

export const cellsTable = pgTable(
  "cells",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => roomsTable.id, { onDelete: "cascade", onUpdate: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => peopleTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    backgroundColor: varchar("background_color", { length: 32 }).notNull(),
    currentValue: numeric("current_value", { precision: 14, scale: 4 }).notNull().default("10"),
    minimumValue: numeric("minimum_value", { precision: 14, scale: 4 }).notNull().default("2"),
    maximumValue: numeric("maximum_value", { precision: 14, scale: 4 }),
    stateVersion: numeric("state_version", { precision: 20, scale: 0 }).notNull().default("0"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    pgPolicy("cells_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("cells_room_person_idx").on(table.roomId, table.personId),
    index("cells_room_updated_idx").on(table.roomId, table.updatedAt),
  ],
);

export const insertCellSchema = createInsertSchema(cellsTable).omit({
  id: true,
  stateVersion: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCell = z.infer<typeof insertCellSchema>;
export type Cell = typeof cellsTable.$inferSelect;