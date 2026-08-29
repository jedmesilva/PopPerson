import { Router, type IRouter } from "express";
import {
  CreatePopPersonActionBody,
  CreatePopPersonActionResponse,
  GetPopPersonResponse,
  GetPopPersonStateResponse,
} from "@workspace/api-zod";
import {
  createPopPersonAction,
  getPopPersonBootstrap,
  getPopPersonState,
} from "../lib/pop-person";
import { actionRateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();

router.get("/pop-person", async (req, res): Promise<void> => {
  const data = await getPopPersonBootstrap(res.locals.anonymousSessionId);
  res.json(GetPopPersonResponse.parse(data));
});

router.get("/pop-person/state", async (req, res): Promise<void> => {
  const data = await getPopPersonState(res.locals.anonymousSessionId);
  res.json(GetPopPersonStateResponse.parse(data));
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
    );
    res.status(201).json(CreatePopPersonActionResponse.parse(action));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Ação inválida.",
    });
  }
});

export default router;