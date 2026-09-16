import bcrypt from "bcrypt";
import { prisma } from "../src/db/prismaClient.ts";
import type { Role } from "@prisma/client";

/**
 * T026: seed fixture users. Four are required at minimum (quickstart.md
 * Prerequisites): one Buyer-only, one Approver-only, one Procurement-Admin-
 * only, and one holding BOTH Buyer and Approver — the last one is required
 * for the self-approval test (FR-010a/SC-007): proving an Approver can't
 * approve their own order only means something if such a dual-role user can
 * exist.
 */
const FIXTURES: { email: string; password: string; roles: Role[] }[] = [
  { email: "buyer@example.com", password: "password123", roles: ["BUYER"] },
  { email: "approver@example.com", password: "password123", roles: ["APPROVER"] },
  {
    email: "admin@example.com",
    password: "password123",
    roles: ["PROCUREMENT_ADMIN"],
  },
  {
    email: "buyer-approver@example.com",
    password: "password123",
    roles: ["BUYER", "APPROVER"],
  },
];

async function main() {
  for (const fixture of FIXTURES) {
    const passwordHash = await bcrypt.hash(fixture.password, 10);
    const user = await prisma.user.upsert({
      where: { email: fixture.email },
      update: { passwordHash },
      create: { email: fixture.email, passwordHash },
    });

    for (const role of fixture.roles) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId: user.id, role } },
        update: {},
        create: { userId: user.id, role },
      });
    }

    console.log(`seeded ${fixture.email} with roles [${fixture.roles.join(", ")}]`);
  }
}

await main();
await prisma.$disconnect();
