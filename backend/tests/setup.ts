import request from "supertest";
import { createApp } from "../src/app.ts";
import { prisma } from "../src/db/prismaClient.ts";

/** T028: supertest app-import helper — every test file does `import { api } from "../setup.ts"`. */
export const app = createApp();
export const api = request(app);

// Reset to a clean slate before every test (not just once per file), so
// tests never depend on ordering or leftover state from a previous test.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "goods_receipt_events",
      "audit_log_entries",
      "purchase_order_lines",
      "purchase_orders",
      "user_roles",
      "vendors",
      "users"
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});
