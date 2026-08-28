import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, anonymousSessionsTable } from "@workspace/db";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export async function ensureAnonymousSession(
  anonymousId: string,
  token: string | undefined,
  userAgent: string | undefined,
): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const tokenHash = createHash("sha256")
    .update(token ?? anonymousId)
    .digest("hex");
  const [session] = await db
    .insert(anonymousSessionsTable)
    .values({
      anonymousId,
      tokenHash,
      userAgent: userAgent ?? null,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: anonymousSessionsTable.anonymousId,
      set: {
        tokenHash,
        userAgent: userAgent ?? null,
        lastSeenAt: now,
        expiresAt,
        revokedAt: null,
      },
    })
    .returning({ id: anonymousSessionsTable.id });
  if (!session) throw new Error("Could not create anonymous session.");
  return session.id;
}