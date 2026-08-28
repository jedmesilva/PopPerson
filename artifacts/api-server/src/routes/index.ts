import { Router, type IRouter } from "express";
import healthRouter from "./health";
import popPersonRouter from "./pop-person";

const router: IRouter = Router();

router.use(healthRouter);
router.use(popPersonRouter);

export default router;
