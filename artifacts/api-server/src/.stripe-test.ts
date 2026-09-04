import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db, peopleTable, usersTable, actionLevelsTable } from "@workspace/db";
import { createPopPersonCheckout } from "./lib/pop-person-store";
void (async () => {
  const [user] = await db.select().from(usersTable).orderBy(asc(usersTable.createdAt)).limit(1);
  const [person] = await db.select({ name: peopleTable.name }).from(peopleTable).where(eq(peopleTable.active, true)).orderBy(asc(peopleTable.name)).limit(1);
  const [level] = await db.select().from(actionLevelsTable).where(eq(actionLevelsTable.code, "hate_incomodado")).limit(1);
  if (!user || !person || !level) throw new Error("Missing payment test fixtures");
  const checkout = await createPopPersonCheckout({ actionType: "hate", level: level.code, targetName: person.name, idempotencyKey: randomUUID() }, undefined, { id: user.id, email: user.email }, "http://localhost:5173");
  console.log(JSON.stringify({ paymentOrderId: checkout.paymentOrderId, checkoutSessionId: checkout.checkoutSessionId, amount: checkout.amount, currency: checkout.currency, checkoutUrlHost: new URL(checkout.checkoutUrl).host }));
})().catch((error) => { console.error(error); process.exitCode = 1; });
