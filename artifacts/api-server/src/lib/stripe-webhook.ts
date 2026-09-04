import Stripe from "stripe";
import { getStripeSync } from "./stripe-client";
import { fulfillStripeCheckout } from "./pop-person-store";

export async function processStripeWebhook(payload: Buffer, signature: string): Promise<void> {
  if (!Buffer.isBuffer(payload)) {
    throw new Error("Stripe webhook payload must be a raw Buffer.");
  }

  // Keep the managed Stripe mirror synchronized as well as fulfilling the
  // application-specific payment order. StripeSync validates the signature
  // using the managed webhook secret stored in the stripe schema.
  const stripeSync = await getStripeSync();
  await stripeSync.processWebhook(payload, signature);
  const event = JSON.parse(payload.toString("utf8")) as Stripe.Event;

  if (
    event.type === "checkout.session.completed"
    && (event.data.object as Stripe.Checkout.Session).payment_status === "paid"
  ) {
    await fulfillStripeCheckout(event.data.object as Stripe.Checkout.Session);
  } else if (event.type === "checkout.session.async_payment_succeeded") {
    await fulfillStripeCheckout(event.data.object as Stripe.Checkout.Session);
  }
}