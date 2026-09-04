import Stripe from "stripe";
import { getStripeSync, getStripeWebhookSecret, getUncachableStripeClient } from "./stripe-client";
import { fulfillStripeCheckout } from "./pop-person-store";

export async function processStripeWebhook(payload: Buffer, signature: string): Promise<void> {
  if (!Buffer.isBuffer(payload)) {
    throw new Error("Stripe webhook payload must be a raw Buffer.");
  }

  const stripe = await getUncachableStripeClient();
  const webhookSecret = await getStripeWebhookSecret();
  const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

  // Keep the managed Stripe mirror synchronized as well as fulfilling the
  // application-specific payment order.
  const stripeSync = await getStripeSync();
  await stripeSync.processWebhook(payload, signature);

  if (
    event.type === "checkout.session.completed"
    && (event.data.object as Stripe.Checkout.Session).payment_status === "paid"
  ) {
    await fulfillStripeCheckout(event.data.object as Stripe.Checkout.Session);
  } else if (event.type === "checkout.session.async_payment_succeeded") {
    await fulfillStripeCheckout(event.data.object as Stripe.Checkout.Session);
  }
}