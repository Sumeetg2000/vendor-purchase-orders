import { PrismaClient } from "@prisma/client";

/** Singleton Prisma client — one connection pool per process. */
export const prisma = new PrismaClient();
