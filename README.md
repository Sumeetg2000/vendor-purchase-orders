# Vendor & Purchase Order Management

A 2-week POC for managing vendors and purchase orders: vendor directory, PO
creation with a derived/tamper-proof total, an approval workflow with a
configurable auto-approval threshold, goods receipt against approved orders,
and an outstanding-orders-by-vendor-and-age report.

Built with Spec-Driven Development — see `specs/001-vendor-po-management/`
for the constitution, spec, plan, and task breakdown that drove this
implementation.

## Setup

The only required setup step is a `.env` file at the repo root:

```bash
cp .env.example .env
docker compose up --build
```

This starts three services — `postgres`, `backend` (runs Prisma migrations,
then serves the API on `:3000`), and `frontend` (serves the React SPA on
`:5173`) — with no manual steps beyond the `.env` file.

Seed fixture users (Buyer, Approver, Procurement Admin, and one user holding
both Buyer and Approver roles — the last one needed to exercise the
self-approval rule):

```bash
docker compose exec backend npm run seed
```

Fixture credentials (all `password123`): `buyer@example.com`,
`approver@example.com`, `admin@example.com`, `buyer-approver@example.com`.

Open `http://localhost:5173` and log in as one of the fixture users.

## Validating the feature end-to-end

`specs/001-vendor-po-management/quickstart.md` is the full validation guide
(vendor lifecycle, derived-total integrity, approval/locking/segregation of
duties, goods-receipt concurrency, the outstanding-orders report, and the
audit trail) — every scenario there is also covered by an automated test in
`backend/tests/`.

## Architecture

- `backend/` — Express + Prisma + PostgreSQL API, one `domain/` service module
  per aggregate (vendor, purchase order, approval, goods receipt, reporting,
  audit).
- `frontend/` — a TypeScript React SPA that only calls the API; no
  business-rule logic lives here. Supports editing a draft PO in place
  (`PATCH /api/purchase-orders/:id`), viewing per-line goods-receipt history,
  and a readable audit log (action labels plus per-action detail such as the
  order number, receipt quantity/line, or rejection/cancellation reason).
- Money totals and received quantities are computed by the service layer and
  independently re-derived by Postgres triggers + CHECK constraints, so the
  guarantee holds even against a write that bypasses the API.

## Backend tests

```bash
cd backend
npm run typecheck && npm run lint && npm run format:check
npm test
```
