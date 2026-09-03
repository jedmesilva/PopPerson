import type { RequestHandler } from "express";
import { getClientIp } from "../lib/client-ip";
import { incrementMetric } from "../lib/runtime-metrics";

type RateLimitOptions = {
  name: string;
  windowMs: number;
  max: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function removeExpiredBuckets(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return (req, res, next): void => {
    const now = Date.now();
    removeExpiredBuckets(now);
    const keys = [
      `${options.name}:ip:${getClientIp(req)}`,
      `${options.name}:anonymous:${res.locals.anonymousId || "unknown"}`,
    ];
    const currentBuckets = keys.map((key) => {
      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        const fresh = { count: 0, resetAt: now + options.windowMs };
        buckets.set(key, fresh);
        return fresh;
      }
      return existing;
    });
    const limitedBucket = currentBuckets.find(
      (bucket) => bucket.count >= options.max,
    );

    if (limitedBucket) {
      incrementMetric(`rate_limit.${options.name}.rejected`);
      const retryAfter = Math.max(
        1,
        Math.ceil((limitedBucket.resetAt - now) / 1000),
      );
      res.setHeader("X-RateLimit-Limit", options.max);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader(
        "X-RateLimit-Reset",
        Math.ceil(limitedBucket.resetAt / 1000),
      );
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({
        error: "Muitas solicitações. Tente novamente em alguns instantes.",
        code: "RATE_LIMITED",
      });
      return;
    }

    currentBuckets.forEach((bucket) => {
      bucket.count += 1;
    });
    incrementMetric(`rate_limit.${options.name}.accepted`);
    const resetAt = Math.min(...currentBuckets.map((bucket) => bucket.resetAt));
    res.setHeader("X-RateLimit-Limit", options.max);
    res.setHeader(
      "X-RateLimit-Remaining",
      Math.max(
        0,
        options.max - Math.max(...currentBuckets.map((bucket) => bucket.count)),
      ),
    );
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));
    next();
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
});