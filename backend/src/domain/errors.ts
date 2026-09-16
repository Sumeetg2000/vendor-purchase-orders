/**
 * Domain error types thrown by service-layer code (T049+) and translated into
 * HTTP responses by the centralized error handler (T021), per api-contract.md
 * Conventions: business-rule failures -> 409, not-found -> 404.
 */

export class BusinessRuleViolationError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "BusinessRuleViolationError";
    this.reason = reason;
  }
}

export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
