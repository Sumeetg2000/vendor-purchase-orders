import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedUser {
  id: string;
  roles: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * JWT verification middleware (T023). Rejects with 401 when the
 * Authorization header is missing, malformed, or the token doesn't verify;
 * otherwise attaches `{ id, roles }` to `req.user` for downstream middleware
 * (authorize.ts, T024) and route handlers.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  const token = header.slice("Bearer ".length);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  try {
    const payload = jwt.verify(token, secret) as { sub: string; roles: string[] };
    req.user = { id: payload.sub, roles: payload.roles };
    next();
  } catch {
    res.status(401).json({ error: "unauthenticated" });
  }
}
