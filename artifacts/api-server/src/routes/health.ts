import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { and, desc, gt, eq } from "drizzle-orm";
import { db, workerHeartbeatsTable } from "@workspace/db";
import { getRuntimeMetrics } from "../lib/runtime-metrics";

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

router.get("/metrics", (_req, res): void => {
  res.set("Cache-Control", "no-store");
  res.json(getRuntimeMetrics());
});

router.get("/readyz", async (_req, res): Promise<void> => {
  try {
    await db.execute(sql`select 1`);
    const [worker] = await db
      .select({ id: workerHeartbeatsTable.id })
      .from(workerHeartbeatsTable)
      .where(
        and(
          eq(workerHeartbeatsTable.role, "pop-person-actions"),
          eq(workerHeartbeatsTable.status, "running"),
          gt(
            workerHeartbeatsTable.lastSeenAt,
            new Date(Date.now() - 15_000),
          ),
        ),
      )
      .orderBy(desc(workerHeartbeatsTable.lastSeenAt))
      .limit(1);
    if (!worker) {
      res.status(503).json({ status: "not_ready", reason: "action_worker_unavailable" });
      return;
    }
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not_ready", reason: "database_unavailable" });
  }
});

export default router;
