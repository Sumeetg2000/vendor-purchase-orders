import { jest } from "@jest/globals";
import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { seedPerfDataset } from "../../prisma/seed-perf.ts";
import { buildOutstandingOrdersQuery } from "../../src/domain/reporting.service.ts";

/**
 * T086: performance test (spec.md US5 AS4, SC-004, research.md §12).
 * Depends on T087 (seedPerfDataset), T088 (the query itself), T089/T090
 * (routes) all being implemented for execution, even though it's authored
 * here per the tests-first pattern.
 *
 * Seeds >=10,000 orders / >=50,000 lines directly via Prisma createMany
 * (not through the API — purely for seeding speed, per the task note), then
 * asserts both a wall-clock threshold AND that the query plan actually uses
 * an index — timing alone can pass by coincidence on a fast machine even
 * with a full sequential scan.
 *
 * Both checks live in ONE test (not split across `it` blocks or a
 * `beforeAll`): the shared test harness (tests/setup.ts) truncates all
 * tables in a `beforeEach` for per-test isolation, which would otherwise
 * wipe out a `beforeAll`-seeded dataset before any assertion runs. Seeding
 * inside the test body itself runs after that test's own truncate, avoiding
 * the conflict without touching the shared harness.
 */
describe("Outstanding-orders report performance at scale (T086, spec.md US5 AS4, SC-004)", () => {
  jest.setTimeout(120_000);

  it("returns a page under 2s and uses an index, at 10,000+ orders / 50,000+ lines", async () => {
    await seedPerfDataset({ orderCount: 10_000, linesPerOrder: 5 });
    const { token } = await createUserWithRoles("perf-admin@test.com", ["PROCUREMENT_ADMIN"]);

    const start = Date.now();
    const res = await api
      .get("/api/reports/outstanding-orders?pageSize=50")
      .set("Authorization", `Bearer ${token}`);
    const elapsedMs = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.length).toBeLessThanOrEqual(50);
    expect(elapsedMs).toBeLessThan(2000);

    const query = buildOutstandingOrdersQuery({ pageSize: 50, page: 1 });
    const explainRows = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
      EXPLAIN ANALYZE ${query}
    `;
    const plan = explainRows.map((row) => row["QUERY PLAN"]).join("\n");

    expect(plan).not.toMatch(/Seq Scan on purchase_orders/);
    expect(plan).toMatch(/Index/);
  });
});
