import type { RequestHandler } from "express";
import {
  loadAuthenticatedUser,
} from "../lib/auth-session";

export const authenticatedIdentity: RequestHandler = async (req, res, next): Promise<void> => {
  try {
    res.locals.authenticatedUser = await loadAuthenticatedUser(req, res);
    next();
  } catch (error) {
    next(error);
  }
};