import { Router, type IRouter } from "express";
import {
  beginXAuthorization,
  clearAuthCookie,
  completeXAuthorization,
  getFrontendRedirectUri,
  getReturnTo,
} from "../lib/x-auth";

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
    await completeXAuthorization(req, res);
    res.redirect(303, getFrontendRedirectUri(req, returnTo));
  } catch (error) {
    req.log.error({ err: error }, "Failed to complete X authentication");
    const errorRedirect = new URL(getFrontendRedirectUri(req, returnTo));
    errorRedirect.searchParams.set("auth", "error");
    res.redirect(303, errorRedirect.toString());
  }
});

router.get("/auth/me", (req, res): void => {
  res.json({ user: res.locals.authenticatedUser ?? null });
});

router.post("/auth/logout", (req, res): void => {
  clearAuthCookie(req, res);
  res.status(204).end();
});

export default router;