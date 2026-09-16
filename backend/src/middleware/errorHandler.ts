import type { ErrorRequestHandler } from "express";
import { BusinessRuleViolationError, NotFoundError } from "../domain/errors.ts";

/**
 * Centralized error-handling middleware (T021). Distinguishes:
 * - validation_error (400) — handled directly by `validate` (T020), never
 *   reaches here
 * - business_rule_violation (409) — BusinessRuleViolationError
 * - not_found (404) — NotFoundError
 * - anything else -> 500 (unexpected — logged, not exposed to the client)
 *
 * Per api-contract.md Conventions.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof BusinessRuleViolationError) {
    res.status(409).json({ error: "business_rule_violation", reason: err.reason });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal_error" });
};
