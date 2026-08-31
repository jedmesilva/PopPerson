import { Router, type IRouter } from "express";
import {
  beginXAuthorization,
  completeXAuthorization,
  getFrontendRedirectUri,
  getPublicAuthErrorReason,
  getReturnTo,
} from "../lib/x-auth";
import { revokeCurrentAuthSession } from "../lib/auth-session";

const router: IRouter = Router();

router.get("/auth/x/start", (req, res): void => {
  try {
    beginXAuthorization(req, res);
  } catch (error) {
    req.log.error({ err: error }, "Failed to start X authentication");
    res.status(503).json({
      error: "A autenticação com X ainda não está configurada.",
    });
  }
});

router.get("/auth/x/callback", async (req, res): Promise<void> => {
  const returnTo = getReturnTo(req);
  try {
    await completeXAuthorization(req, res, res.locals.anonymousSessionId);
    res.redirect(303, getFrontendRedirectUri(req, returnTo));
  } catch (error) {
    req.log.error({ err: error }, "Failed to complete X authentication");
    const errorRedirect = new URL(getFrontendRedirectUri(req, returnTo));
    errorRedirect.searchParams.set("auth", "error");
    errorRedirect.searchParams.set("reason", getPublicAuthErrorReason(error));
    res.redirect(303, errorRedirect.toString());
  }
});

router.get("/auth/me", (req, res): void => {
  res.json({ user: res.locals.authenticatedUser ?? null });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await revokeCurrentAuthSession(req, res);
  res.status(204).end();
});

export default router;