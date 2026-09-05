import Stripe from "stripe";
import { StripeSync, runMigrations } from "stripe-replit-sync";
import { ReplitConnectors } from "@replit/connectors-sdk";

type StripeCredentials = {
  secretKey: string;
};

function getConfiguredStripeSecret(): string | undefined {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  return secretKey || undefined;
}

async function getStripeCredentials(): Promise<StripeCredentials> {
  const configuredSecret = getConfiguredStripeSecret();
  if (configuredSecret) {
    return { secretKey: configuredSecret };
  }

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
    throw new Error(
      `Could not load Stripe credentials: ${response.status}. Set STRIPE_SECRET_KEY outside Replit.`,
    );
  }

  const data = await response.json() as {
    items?: Array<{ settings?: { secret?: string; secret_key?: string } }>;
  };
  const settings = data.items?.[0]?.settings;
  const secretKey = settings?.secret_key ?? settings?.secret;
  if (!secretKey) {
    throw new Error(
      "Stripe is not connected or has no secret key. Set STRIPE_SECRET_KEY outside Replit.",
    );
  }

  return { secretKey };
}

function getConfiguredWebhookBaseUrl(): string {
  const configuredUrl =
    process.env.STRIPE_WEBHOOK_BASE_URL?.trim() ||
    process.env.PUBLIC_API_URL?.trim() ||
    process.env.RAILWAY_PUBLIC_DOMAIN?.trim() ||
    process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();

  if (!configuredUrl) {
    throw new Error(
      "A public URL is required to configure the Stripe webhook. Set STRIPE_WEBHOOK_BASE_URL.",
    );
  }

  const normalizedUrl = configuredUrl.startsWith("http")
    ? configuredUrl
    : `https://${configuredUrl}`;
  return normalizedUrl.replace(/\/+$/, "");
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe sync.");

  const { secretKey } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
  });
}

export async function initializeStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe.");

  await runMigrations({ databaseUrl });
  const stripeSync = await getStripeSync();
  const webhookBaseUrl = getConfiguredWebhookBaseUrl();
  await stripeSync.findOrCreateManagedWebhook(
    `${webhookBaseUrl}/api/stripe/webhook`,
  );
  await stripeSync.syncBackfill();
}