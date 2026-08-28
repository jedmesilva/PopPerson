import type { RequestHandler } from "express";
import {
  ANONYMOUS_COOKIE_NAME,
  createAnonymousToken,
  setAnonymousCookie,
  verifyAnonymousToken,
} from "../lib/anonymous-token";

export const anonymousIdentity: RequestHandler = (req, res, next): void => {
  const existingId = verifyAnonymousToken(
    req.cookies?.[ANONYMOUS_COOKIE_NAME],
  );

  if (existingId) {
    res.locals.anonymousId = existingId;
    next();
    return;
  }

  const created = createAnonymousToken();
  res.locals.anonymousId = created.anonymousId;
  setAnonymousCookie(res, created.token);
  next();
};