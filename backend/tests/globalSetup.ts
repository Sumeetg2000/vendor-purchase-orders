import { execSync } from "node:child_process";

/**
 * T028: applies pending migrations to the test database once, before the
 * whole suite runs (not per test file / per worker, to avoid concurrent
 * `migrate deploy` calls racing each other). Runs against a real disposable
 * Postgres per research.md §9 — a mocked Prisma client would not actually
 * prove the guarantees these tests exist to check.
 */
export default function globalSetup() {
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
}
