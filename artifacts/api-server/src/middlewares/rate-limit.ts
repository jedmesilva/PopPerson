import type { Request, RequestHandler, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, rateLimitBucketsTable } from "@workspace/db";
import { getClientIp } from "../lib/client-ip";
import { incrementMetric } from "../lib/runtime-metrics";

type RateLimitOptions = {
  name: string;
  windowMs: number;
  max: number;
  keys?: (req: Request, res: Response) => string[];
};

class RateLimitExceeded extends Error {
  constructor(
    readonly resetAt: Date,
  ) {
    super("rate limit exceeded");
  }
}

function defaultKeys(req: Request, res: Response): string[] {
  const keys = [
    `ip:${getClientIp(req)}`,
    `anonymous:${res.locals.anonymousId || "unknown"}`,
  ];
  const userId = res.locals.authenticatedUser?.id;
  if (userId) keys.push(`user:${userId}`);
  return keys;
}

async function consume(
  options: RateLimitOptions,
  keys: string[],
): Promise<{ resetAt: Date; remaining: number }> {
  const uniqueKeys = [...new Set(keys)].slice(0, 8);
  if (uniqueKeys.length === 0) throw new Error("rate limit has no keys");

  return db.transaction(async (tx) => {
    let remaining = options.max;
    let resetAt = new Date(Date.now() + options.windowMs);
    for (const key of uniqueKeys) {
      await tx.execute(
        // A transaction advisory lock also serializes the first request for a
        // previously unseen bucket, where SELECT FOR UPDATE has no row yet.
        sql`SELECT pg_advisory_xact_lock(
          hashtextextended(${`${options.name}:${key}`}, 0)
        )`,
      );
      const [bucket] = await tx
        .select()
        .from(rateLimitBucketsTable)
        .where(
          and(
            eq(rateLimitBucketsTable.name, options.name),
            eq(rateLimitBucketsTable.bucketKey, key),
          ),
        )
        .limit(1);
      const now = new Date();
      if (!bucket || bucket.resetAt <= now) {
        const freshResetAt = new Date(now.getTime() + options.windowMs);
        await tx
          .insert(rateLimitBucketsTable)
          .values({
            name: options.name,
            bucketKey: key,
            count: 1,
            resetAt: freshResetAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              rateLimitBucketsTable.name,
              rateLimitBucketsTable.bucketKey,
            ],
            set: { count: 1, resetAt: freshResetAt, updatedAt: now },
          });
        resetAt = freshResetAt < resetAt ? freshResetAt : resetAt;
        remaining = Math.min(remaining, options.max - 1);
        continue;
      }
      if (bucket.count >= options.max) {
        throw new RateLimitExceeded(bucket.resetAt);
      }
      await tx
        .update(rateLimitBucketsTable)
        .set({
          count: bucket.count + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(rateLimitBucketsTable.name, options.name),
            eq(rateLimitBucketsTable.bucketKey, key),
          ),
        );
      resetAt = bucket.resetAt < resetAt ? bucket.resetAt : resetAt;
      remaining = Math.min(remaining, options.max - bucket.count - 1);
    }
    return { resetAt, remaining: Math.max(0, remaining) };
  });
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return (req, res, next): void => {
    void consume(options, [
      ...defaultKeys(req, res),
      ...(options.keys?.(req, res) ?? []),
    ])
      .then(({ resetAt, remaining }) => {
        res.setHeader("X-RateLimit-Limit", options.max);
        res.setHeader("X-RateLimit-Remaining", remaining);
        res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt.getTime() / 1000));
        incrementMetric(`rate_limit.${options.name}.accepted`);
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof RateLimitExceeded) {
          const retryAfter = Math.max(
            1,
            Math.ceil((error.resetAt.getTime() - Date.now()) / 1000),
          );
          res.setHeader("X-RateLimit-Limit", options.max);
          res.setHeader("X-RateLimit-Remaining", 0);
          res.setHeader("X-RateLimit-Reset", Math.ceil(error.resetAt.getTime() / 1000));
          res.setHeader("Retry-After", retryAfter);
          incrementMetric(`rate_limit.${options.name}.rejected`);
          res.status(429).json({
            error: "Muitas solicitações. Tente novamente em alguns instantes.",
            code: "RATE_LIMITED",
          });
          return;
        }
        incrementMetric(`rate_limit.${options.name}.errors`);
        res.status(503).json({
          error: "Proteção contra excesso de solicitações indisponível.",
          code: "RATE_LIMIT_UNAVAILABLE",
        });
      });
  };
}

export const generalApiRateLimit = rateLimit({
  name: "api",
  windowMs: 60_000,
  max: 180,
});

export const actionRateLimit = rateLimit({
  name: "pop-person-action",
  windowMs: 60_000,
  max: 20,
  keys: (req) => {
    const targetName =
      typeof req.body?.targetName === "string"
        ? req.body.targetName.trim().toLowerCase().slice(0, 160)
        : "";
    return targetName ? [`target:${targetName}`] : [];
  },
});