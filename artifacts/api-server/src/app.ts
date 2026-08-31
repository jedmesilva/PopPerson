import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { anonymousIdentity } from "./middlewares/anonymous-identity";
import { authenticatedIdentity } from "./middlewares/authenticated-identity";
import { generalApiRateLimit } from "./middlewares/rate-limit";

const app: Express = express();

app.set("trust proxy", 1);

const corsOrigins = new Set(
  (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const isProduction = process.env.NODE_ENV === "production";

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || corsOrigins.has(origin) || (!isProduction && corsOrigins.size === 0)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS."));
    },
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", anonymousIdentity, authenticatedIdentity, generalApiRateLimit);
app.use("/api", router);

export default app;
