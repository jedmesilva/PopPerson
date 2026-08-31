import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accessLocationRouter from "./access-location";
import popPersonRouter from "./pop-person";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessLocationRouter);
router.use(popPersonRouter);
router.use(authRouter);

export default router;
