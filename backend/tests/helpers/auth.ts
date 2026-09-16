import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { prisma } from "../../src/db/prismaClient.ts";

/**
 * Test-only helper: creates a user with the given roles and signs a JWT for
 * it, matching the payload shape auth.routes.ts issues (T022): { sub, roles }.
 * Bypasses the real login flow (bcrypt/DB round trip) since these tests are
 * exercising business routes, not the login endpoint itself.
 */
export async function createUserWithRoles(email: string, roles: Role[]) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "unused-in-tests",
      roles: { create: roles.map((role) => ({ role })) },
    },
  });

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  const token = jwt.sign({ sub: user.id, roles }, secret, { expiresIn: "1h" });

  return { user, token };
}
