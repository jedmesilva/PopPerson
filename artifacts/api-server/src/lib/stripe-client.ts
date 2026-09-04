import Stripe from "stripe";
import { StripeSync, runMigrations } from "stripe-replit-sync";
import { ReplitConnectors } from "@replit/connectors-sdk";

type StripeCredentials = {
  secretKey: string;
  webhookSecret?: string;
};

async function getStripeCredentials(): Promise<StripeCredentials> {
  const connectors = new ReplitConnectors();
  const proxyUrl = connectors.getProxyUrl();
  const connectionApiUrl = new URL("/api/v2/connection", proxyUrl);
  connectionApiUrl.searchParams.set("include_secrets", "true");
  connectionApiUrl.searchParams.set("connector_names", "stripe");
  const response = await fetch(connectionApiUrl, {
    headers: await connectors.getProxyHeaders("stripe"),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Could not load Stripe credentials: ${response.status}.`);
  }

  const data = await response.json() as {
    items?: Array<{ settings?: { secret_key?: string; webhook_secret?: string } }>;
  };
  const settings = data.items?.[0]?.settings;
  if (!settings?.secret_key) {
    throw new Error("Stripe is not connected or has no secret key.");
  }

  return {
    secretKey: settings.secret_key,
    webhookSecret: settings.webhook_secret,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeWebhookSecret(): Promise<string> {
  const { webhookSecret } = await getStripeCredentials();
  if (!webhookSecret) {
    throw new Error("Stripe webhook signing secret is unavailable.");
  }
  return webhookSecret;
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe sync.");

  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}

export async function initializeStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe.");

  await runMigrations({ databaseUrl });
  const stripeSync = await getStripeSync();
  const configuredDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!configuredDomain) {
    throw new Error("REPLIT_DOMAINS is required to configure the Stripe webhook.");
  }

  const webhookBaseUrl = configuredDomain.startsWith("http")
    ? configuredDomain
    : `https://${configuredDomain}`;
  await stripeSync.findOrCreateManagedWebhook(
    `${webhookBaseUrl}/api/stripe/webhook`,
  );
  await stripeSync.syncBackfill();
}