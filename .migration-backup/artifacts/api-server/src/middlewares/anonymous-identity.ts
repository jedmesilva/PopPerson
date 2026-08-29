import type { RequestHandler } from "express";
import {
  ANONYMOUS_COOKIE_NAME,
  createAnonymousToken,
  setAnonymousCookie,
  verifyAnonymousToken,
} from "../lib/anonymous-token";
import { ensureAnonymousSession } from "../lib/anonymous-session";

export const anonymousIdentity: RequestHandler = async (req, res, next): Promise<void> => {
  let token = req.cookies?.[ANONYMOUS_COOKIE_NAME];
  const existingId = verifyAnonymousToken(
    token,
  );

  if (existingId) {
    res.locals.anonymousId = existingId;
  } else {
    const created = createAnonymousToken();
    token = created.token;
    res.locals.anonymousId = created.anonymousId;
    setAnonymousCookie(res, created.token);
  }

  try {
    res.locals.anonymousSessionId = await ensureAnonymousSession(
      res.locals.anonymousId,
      token,
      req.get("user-agent") ?? undefined,
    );
    next();
  } catch (error) {
    next(error);
  }
};