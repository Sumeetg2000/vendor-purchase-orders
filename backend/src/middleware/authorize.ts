import type { Request, Response, NextFunction } from "express";
import type { Role } from "@prisma/client";

/**
 * requireRole(role) (T024): "the caller's role set must include this role,"
 * never "is the caller's only role this" (api-contract.md Conventions,
 * research.md §5) — a caller holding multiple roles may pass any of the
 * checks that apply to any role they hold.
 */
export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!req.user.roles.includes(role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
