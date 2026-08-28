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

router.get("/pop-person", (_req, res) => {
  res.json(GetPopPersonResponse.parse(getPopPersonBootstrap()));
});

router.get("/pop-person/state", (_req, res) => {
  res.json(GetPopPersonStateResponse.parse(getPopPersonState()));
});

router.post("/pop-person/actions", actionRateLimit, (req, res) => {
  const parsed = CreatePopPersonActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const action = createPopPersonAction(parsed.data);
    res.status(201).json(CreatePopPersonActionResponse.parse(action));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Ação inválida.",
    });
  }
});

export default router;