import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ZodType } from "zod";

type ValidationTarget = "body" | "query" | "params";

/**
 * Generic zod-validation middleware (T020). On failure, responds
 * 400 { error: "validation_error", details: [...] } (api-contract.md
 * Conventions) before any route handler / service method runs.
 */
export function validate(schema: ZodType, target: ValidationTarget = "body"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      res.status(400).json({
        error: "validation_error",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    (req as { [key in ValidationTarget]?: unknown })[target] = result.data;
    next();
  };
}
