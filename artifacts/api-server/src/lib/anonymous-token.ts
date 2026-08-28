import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Response } from "express";

export const ANONYMOUS_COOKIE_NAME = "pop_person_anon";
const ANONYMOUS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

type AnonymousTokenPayload = {
  sub: string;
  iat: number;
  exp: number;
};

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required to issue anonymous access tokens.");
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

export function createAnonymousToken(now = Math.floor(Date.now() / 1000)): {
  token: string;
  anonymousId: string;
} {
  const payload: AnonymousTokenPayload = {
    sub: randomUUID(),
    iat: now,
    exp: now + ANONYMOUS_TOKEN_TTL_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return {
    token: `${encodedPayload}.${sign(encodedPayload)}`,
    anonymousId: payload.sub,
  };
}

export function verifyAnonymousToken(token: unknown): string | null {
  if (typeof token !== "string") return null;

  const [encodedPayload, providedSignature, ...extraParts] = token.split(".");
  if (!encodedPayload || !providedSignature || extraParts.length > 0) return null;

  const expectedSignature = sign(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<AnonymousTokenPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.sub !== "string" ||
      payload.sub.length < 20 ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= now ||
      payload.iat > now + 60
    ) {
      return null;
    }
    return payload.sub;
  } catch {
    return null;
  }
}

export function setAnonymousCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${ANONYMOUS_COOKIE_NAME}=${token}; Max-Age=${ANONYMOUS_TOKEN_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}