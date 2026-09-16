import express from "express";
import { authRouter } from "./api/auth.routes.ts";
import { errorHandler } from "./middleware/errorHandler.ts";

/**
 * Express app skeleton (T019). Routers are mounted onto this app by their
 * own story-phase tasks (vendors: T037, purchase-orders: T054/T071/T081/T095,
 * reports: T090) — add new `app.use(...)` router mounts in the marked section
 * below, ABOVE the error handler, since Express error middleware must be
 * registered after the routes it handles errors for.
 */
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // --- Routers (mount future story routers above this line) ---
  app.use("/api/auth", authRouter);

  // Centralized error handler — MUST stay last.
  app.use(errorHandler);

  return app;
}
