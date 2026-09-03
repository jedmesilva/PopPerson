import { Router, type IRouter } from "express";
import {
  CreatePopPersonActionBody,
  CreatePopPersonActionResponse,
  GetPlayerRegistrationResponse,
  GetPopPersonResponse,
  GetPopPersonStateResponse,
  JoinPopPersonAsPlayerBody,
  JoinPopPersonAsPlayerResponse,
} from "@workspace/api-zod";
import {
  createPopPersonAction,
  getPlayerRegistration,
  getPopPersonBootstrap,
  getPopPersonState,
  joinPopPersonAsPlayer,
  PopPersonOverloadError,
} from "../lib/pop-person";
import { actionRateLimit } from "../middlewares/rate-limit";
import { resolveAccessLocation } from "./access-location";

const router: IRouter = Router();

router.get("/pop-person", async (req, res): Promise<void> => {
  const data = await getPopPersonBootstrap(
    res.locals.anonymousSessionId,
    res.locals.authenticatedUser ?? null,
  );
  res.set("Cache-Control", "no-store");
  res.json(GetPopPersonResponse.parse(data));
});

router.get("/pop-person/state", async (req, res): Promise<void> => {
  const data = await getPopPersonState(res.locals.anonymousSessionId);
  // This is a live multiplayer snapshot. A 304 response has no body, and
  // clients cannot reconcile action progress from it after a reload.
  res.set("Cache-Control", "no-store");
  res.json(GetPopPersonStateResponse.parse(data));
});

router.get("/pop-person/player/registration", async (req, res): Promise<void> => {
  const user = res.locals.authenticatedUser;
  if (!user) {
    res.status(401).json({ error: "Faça login para entrar na disputa." });
    return;
  }

  try {
    const data = await getPlayerRegistration(user);
    res.json(GetPlayerRegistrationResponse.parse(data));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Não foi possível carregar o cadastro.",
    });
  }
});

router.post("/pop-person/player", async (req, res): Promise<void> => {
  const user = res.locals.authenticatedUser;
  if (!user) {
    res.status(401).json({ error: "Faça login para entrar na disputa." });
    return;
  }

  try {
    const parsed = JoinPopPersonAsPlayerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const accessLocation = await resolveAccessLocation(req);
    const player = await joinPopPersonAsPlayer(
      user,
      res.locals.anonymousSessionId,
      parsed.data,
      accessLocation,
    );
    res.status(201).json(JoinPopPersonAsPlayerResponse.parse({ player }));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Não foi possível entrar na disputa. Tente novamente.",
    });
  }
});

router.post("/pop-person/actions", actionRateLimit, async (req, res): Promise<void> => {
  const parsed = CreatePopPersonActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const action = await createPopPersonAction(
      parsed.data,
      res.locals.anonymousSessionId,
      res.locals.authenticatedUser?.id,
    );
    res.status(201).json(CreatePopPersonActionResponse.parse(action));
  } catch (error) {
    if (error instanceof PopPersonOverloadError) {
      res.set("Retry-After", "1");
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        retryAfterMs: 1_000,
      });
      return;
    }
    res.status(400).json({
      error: error instanceof Error ? error.message : "Ação inválida.",
    });
  }
});

export default router;