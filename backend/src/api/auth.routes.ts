import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../db/prismaClient.ts";
import { validate } from "../middleware/validate.ts";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

/**
 * POST /api/auth/login (T022). Issues a JWT with payload
 * { sub: userId, roles: string[] } — a list, not a single role
 * (research.md §5) — returning 200 { token, roles } or 401
 * (api-contract.md Auth).
 */
authRouter.post("/login", validate(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roles: true },
  });

  if (!user) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const roles = user.roles.map((userRole) => userRole.role);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  const token = jwt.sign({ sub: user.id, roles }, secret, { expiresIn: "8h" });

  res.status(200).json({ token, roles });
});
