import type { RequestHandler } from "express";
import {
  X_AUTH_COOKIE_NAME,
  verifyAuthCookie,
} from "../lib/x-auth";

export const authenticatedIdentity: RequestHandler = (req, res, next): void => {
  res.locals.authenticatedUser = verifyAuthCookie(
    req.cookies?.[X_AUTH_COOKIE_NAME],
  );
  next();
};