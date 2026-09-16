import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Express 4 does not automatically catch a rejected promise returned by an
 * async route handler (unlike Express 5) — without this wrapper, a thrown
 * domain error (NotFoundError, BusinessRuleViolationError) would leave the
 * request hanging instead of reaching errorHandler (T021). Wrap every async
 * route handler with this.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
