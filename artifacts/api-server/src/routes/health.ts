import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (_req, res): Promise<void> => {
  try {
    await db.execute(sql`select 1`);
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch {
    res.status(503).json({ status: "error" });
  }
});

export default router;
