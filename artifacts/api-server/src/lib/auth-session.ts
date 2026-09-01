import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  accessEventsTable,
  authSessionsTable,
  db,
  anonymousSessionsTable,
  usersTable,
} from "@workspace/db";

export const X_AUTH_COOKIE_NAME = "pop_person_auth";

const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 180;
const AUTH_SESSION_REFRESH_WINDOW_MS = AUTH_SESSION_TTL_MS / 2;

export type AuthenticatedUser = {
  id: string;
  xUserId: string;
  username: string;
  name: string;
  xLocation: string | null;
  avatarUrl: string | null;
  email: string | null;
  createdAt: string;
};

type XProfile = Omit<AuthenticatedUser, "id" | "createdAt">;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function isSecureRequest(req: Request): boolean {
  return req.secure || req.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
}

function cookieAttributes(req: Request, maxAge: number): string {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  const sameSite = process.env.NODE_ENV === "production" ? "None" : "Lax";
  return `Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=${sameSite}${secure}`;
}

export function setAuthCookie(req: Request, res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `${X_AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(
      req,
      Math.floor(AUTH_SESSION_TTL_MS / 1000),
    )}`,
  );
}

export function clearAuthCookie(req: Request, res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${X_AUTH_COOKIE_NAME}=; ${cookieAttributes(req, 0)}`,
  );
}

export async function createAuthenticatedSession(
  req: Request,
  res: Response,
  profile: XProfile,
  anonymousSessionId?: string,
): Promise<AuthenticatedUser> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_SESSION_TTL_MS);
  const token = createSessionToken();
  const tokenHash = hashToken(token);

  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(usersTable)
      .values({
        xUserId: profile.xUserId,
        username: profile.username,
        name: profile.name,
        xLocation: profile.xLocation,
        avatarUrl: profile.avatarUrl,
        email: profile.email,
      })
      .onConflictDoUpdate({
        target: usersTable.xUserId,
        set: {
          username: profile.username,
          name: profile.name,
          xLocation: profile.xLocation,
          avatarUrl: profile.avatarUrl ?? usersTable.avatarUrl,
          email: profile.email ?? usersTable.email,
          updatedAt: now,
          lastLoginAt: now,
        },
      })
      .returning();

    if (!user) throw new Error("Could not persist the X user.");

    const [latestAccess] = anonymousSessionId
      ? await tx
          .select({
            city: accessEventsTable.city,
            region: accessEventsTable.region,
            country: accessEventsTable.country,
            countryCode: accessEventsTable.countryCode,
            timezone: accessEventsTable.timezone,
            locationSource: accessEventsTable.locationSource,
            accessedAt: accessEventsTable.accessedAt,
          })
          .from(accessEventsTable)
          .where(eq(accessEventsTable.sessionId, anonymousSessionId))
          .orderBy(desc(accessEventsTable.accessedAt))
          .limit(1)
      : [];

    if (latestAccess) {
      await tx
        .update(usersTable)
        .set({
          lastAccessCity: latestAccess.city,
          lastAccessRegion: latestAccess.region,
          lastAccessCountry: latestAccess.country,
          lastAccessCountryCode: latestAccess.countryCode,
          lastAccessTimezone: latestAccess.timezone,
          lastAccessLocationSource: latestAccess.locationSource,
          lastAccessLocationAt: latestAccess.accessedAt,
          updatedAt: now,
        })
        .where(eq(usersTable.id, user.id));
    }

    await tx.insert(authSessionsTable).values({
      userId: user.id,
      tokenHash,
      userAgent: req.get("user-agent") ?? null,
      ipAddress: req.ip ?? null,
      expiresAt,
    });

    if (anonymousSessionId) {
      await tx
        .update(anonymousSessionsTable)
        .set({ userId: user.id, lastSeenAt: now })
        .where(eq(anonymousSessionsTable.id, anonymousSessionId));
    }

    return user;
  });

  setAuthCookie(req, res, token);
  return {
    id: result.id,
    xUserId: result.xUserId,
    username: result.username,
    name: result.name,
    xLocation: result.xLocation,
    avatarUrl: result.avatarUrl,
    email: result.email,
    createdAt: result.createdAt.toISOString(),
  };
}

export async function loadAuthenticatedUser(
  req: Request,
  res: Response,
): Promise<AuthenticatedUser | null> {
  const token = req.cookies?.[X_AUTH_COOKIE_NAME];
  if (typeof token !== "string" || token.length === 0) return null;

  const now = new Date();
  const tokenHash = hashToken(token);
  const [session] = await db
    .select({
      sessionId: authSessionsTable.id,
      expiresAt: authSessionsTable.expiresAt,
      id: usersTable.id,
      xUserId: usersTable.xUserId,
      username: usersTable.username,
      name: usersTable.name,
      xLocation: usersTable.xLocation,
      avatarUrl: usersTable.avatarUrl,
      email: usersTable.email,
      createdAt: usersTable.createdAt,
    })
    .from(authSessionsTable)
    .innerJoin(usersTable, eq(authSessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(authSessionsTable.tokenHash, tokenHash),
        isNull(authSessionsTable.revokedAt),
        gt(authSessionsTable.expiresAt, now),
      ),
    )
    .limit(1);

  if (!session) return null;

  if (session.expiresAt.getTime() - now.getTime() <= AUTH_SESSION_REFRESH_WINDOW_MS) {
    const refreshedExpiresAt = new Date(now.getTime() + AUTH_SESSION_TTL_MS);
    await db
      .update(authSessionsTable)
      .set({ lastSeenAt: now, expiresAt: refreshedExpiresAt })
      .where(eq(authSessionsTable.id, session.sessionId));
    setAuthCookie(req, res, token);
  }

  res.locals.authSessionId = session.sessionId;
  return {
    id: session.id,
    xUserId: session.xUserId,
    username: session.username,
    name: session.name,
    xLocation: session.xLocation,
    avatarUrl: session.avatarUrl,
    email: session.email,
    createdAt: session.createdAt.toISOString(),
  };
}

export async function revokeCurrentAuthSession(
  req: Request,
  res: Response,
): Promise<void> {
  const token = req.cookies?.[X_AUTH_COOKIE_NAME];
  if (typeof token === "string" && token.length > 0) {
    await db
      .update(authSessionsTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authSessionsTable.tokenHash, hashToken(token)),
          isNull(authSessionsTable.revokedAt),
        ),
      );
  }
  clearAuthCookie(req, res);
}