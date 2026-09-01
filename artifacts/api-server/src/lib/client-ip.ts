import { isIP } from "node:net";
import type { Request } from "express";

function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;

  let candidate = value.trim().replace(/^"|"$/g, "");
  if (!candidate) return null;

  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  }

  const directIp = isIP(candidate) ? candidate : null;
  if (directIp) return directIp;

  // Some proxies send an IPv4 address with a port.
  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return ipv4WithPort && isIP(ipv4WithPort[1]) ? ipv4WithPort[1] : null;
}

function firstValidIp(value: string | undefined): string | null {
  if (!value) return null;
  return value
    .split(",")
    .map((part) => normalizeIp(part))
    .find((candidate): candidate is string => Boolean(candidate)) ?? null;
}

/**
 * Express req.ip is the canonical value after applying the configured proxy
 * trust policy. Platform-specific headers are only fallbacks: using them first
 * would let a direct client spoof its address and bypass the rate limit.
 */
export function getClientIp(req: Request): string {
  const expressIp = normalizeIp(req.ip);
  if (expressIp) return expressIp;

  const platformIp =
    normalizeIp(req.get("cf-connecting-ip")) ??
    normalizeIp(req.get("true-client-ip")) ??
    normalizeIp(req.get("x-real-ip"));

  return (
    platformIp ??
    firstValidIp(req.get("x-forwarded-for")) ??
    normalizeIp(req.socket.remoteAddress) ??
    "unknown"
  );
}