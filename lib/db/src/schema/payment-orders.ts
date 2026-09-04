import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
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
import { anonymousSessionsTable } from "./sessions";
import { roomsTable } from "./rooms";
import { usersTable } from "./users";

export const paymentProviderEnum = pgEnum("payment_provider", ["stripe", "efi"]);
export const paymentOrderStatusEnum = pgEnum("payment_order_status", [
  "pending",
  "paid",
  "failed",
  "expired",
  "cancelled",
]);

export const paymentOrdersTable = pgTable(
  "payment_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => roomsTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict", onUpdate: "cascade" }),
    sessionId: uuid("session_id").references(() => anonymousSessionsTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    provider: paymentProviderEnum("provider").notNull().default("stripe"),
    status: paymentOrderStatusEnum("status").notNull().default("pending"),
    targetName: text("target_name").notNull(),
    actionType: varchar("action_type", { length: 16 }).notNull(),
    actionLevel: varchar("action_level", { length: 80 }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("brl"),
    basePriceMinor: integer("base_price_minor").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    stripeProductId: text("stripe_product_id"),
    stripePriceId: text("stripe_price_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    actionId: uuid("action_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    pgPolicy("payment_orders_server_only", {
      for: "all",
      to: "public",
      using: sql`false`,
      withCheck: sql`false`,
    }),
    uniqueIndex("payment_orders_user_idempotency_idx").on(table.userId, table.idempotencyKey),
    uniqueIndex("payment_orders_stripe_checkout_session_idx").on(table.stripeCheckoutSessionId),
    index("payment_orders_status_idx").on(table.status),
    index("payment_orders_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const insertPaymentOrderSchema = createInsertSchema(paymentOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPaymentOrder = z.infer<typeof insertPaymentOrderSchema>;
export type PaymentOrder = typeof paymentOrdersTable.$inferSelect;