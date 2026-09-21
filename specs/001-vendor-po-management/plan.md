# Implementation Plan: Vendor & Purchase Order Management

**Branch**: `001-vendor-po-management` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-vendor-po-management/spec.md`

## Summary

A procurement POC that replaces spreadsheet purchase orders with a system where the order
total and each line's outstanding quantity are always derived and provably tamper-proof —
even against a direct API call. Purchase orders reference an active vendor, carry one or
more lines, auto-approve at or below a configurable threshold and otherwise require a
distinct Approver (never the buyer who raised the order), lock completely once submitted,
and accept partial/multiple goods receipts that can never push received quantity above
ordered quantity. A Procurement Admin gets a database-efficient outstanding-orders view by
vendor and age.

Technical approach: an Express + TypeScript API backed by PostgreSQL via Prisma, with a
TypeScript React frontend. **The required guarantee** — that the order total and
each line's outstanding quantity can never drift from their lines/receipts through any API
call or application code path — is met by the Express service layer's validation and
transactional writes, not application-memory checks alone, so the invariant holds under
concurrent requests. Database triggers and CHECK constraints additionally back this up so
the same guarantee also survives a raw SQL write that bypasses the API entirely; that
extra reach is **defense-in-depth beyond what this POC is graded on**, kept because it was
already built, not because it's a required part of the assignment. Everything else
(locking, role separation, approval segregation of duties, audit trail) is enforced in an
explicit Express service layer, never a generic CRUD abstraction. The whole stack runs via
`docker compose up` with a single `.env` file.

## Technical Context

**Language/Version**: Node.js 20 LTS. Backend written in TypeScript 5.x (so Prisma's
generated types are used directly, per the project's technical decisions). Frontend
also written in TypeScript 5.x using React 18.

**Primary Dependencies**: Express 4.x (API), Prisma 5.x (ORM + migrations, PostgreSQL
driver), `jsonwebtoken` (JWT issuance/verification), `bcrypt` (password hashing), `zod`
(request validation schemas), React 18 + Vite (frontend dev/build tooling, TypeScript
template).

**Storage**: PostgreSQL 16, accessed exclusively through Prisma from the API. Money
columns (`unit_price`, `total`) use `NUMERIC(12,2)` (Prisma `Decimal`) to avoid
floating-point drift in totals — not JavaScript floats and not integer cents, since
Postgres `NUMERIC` plus Prisma `Decimal` gives exact decimal arithmetic without a
minor-unit conversion layer.

**Testing**: Jest + Supertest for backend contract, integration, and unit tests, run
against a real disposable Postgres instance (via Prisma migrate against a `test` database,
docker-composed alongside the app). Automated testing is concentrated on backend business
invariants per Constitution Principle XI; the frontend is verified manually via the
`quickstart.md` scenarios, consistent with Scope Control (Principle XII) for a 2-week solo
POC.

**Target Platform**: Linux containers (Docker Compose) for Postgres and the Express API;
any modern browser for the React SPA.

**Project Type**: Web application (frontend + backend, detected from the spec's distinct
Buyer/Approver/Procurement Admin UI needs and the API-exposure section).

**Performance Goals**: The outstanding-orders-by-vendor-and-age query (FR-016, SC-004) MUST
return one paginated page (50 rows) in under 2 seconds against a seeded dataset of at least
10,000 purchase orders / 50,000 lines, backed by indexed, database-side filtering/
aggregation — verified both by a timing assertion and an `EXPLAIN ANALYZE` index-usage
check (research.md §12), not just at small scale.

**Constraints**: Order total and line outstanding-quantity integrity (FR-005, FR-013,
FR-014) MUST hold for every API call and application code path — this is the required,
graded guarantee, enforced in the Express service layer with transactional writes, per
Constitution Principles II, IV, and V. Submitted-order locking (FR-008/FR-009) and
approval segregation-of-duties (FR-010a) are enforced the same way — in the Express
service layer inside a database transaction with row-level locking — the correctness
boundary for all of these is "any API path, including a direct API call" (Constitution
Principle I). Database triggers + CHECK constraints additionally back the total/
outstanding-quantity guarantee so it also survives a raw SQL write bypassing the API
entirely; this is defense-in-depth beyond what this POC is graded on (research.md §11),
not a requirement this plan is scoped against.

**Scale/Scope**: Solo, 2-week POC (Constitution Principle XII). Optional dataset of up to
10,000 purchase orders for validating query scalability. Three roles, ~5-6 top-level
resources (vendors, purchase orders, purchase order lines, goods receipts, audit log,
users/auth).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I. Domain Invariants Over Convenience | Backend (Express services) is the sole enforcement boundary; frontend has no rule-enforcement role | **PASS** — all FRs are enforced in Express services and/or the DB; frontend is presentation-only |
| II. Purchase-Order Integrity | PO must reference active vendor; total derived, never independently editable, no API call/application code path can desync it | **PASS** — FK to active vendor checked in service layer (FR-002); required guarantee met by no API contract ever exposing a `total` write path (FR-005); a Postgres trigger additionally keeps `total` in sync as bonus hardening against raw SQL, beyond what's graded (research.md §11) |
| III. Approval Integrity | Threshold-based approval, explicit auto-approve rule, locking, distinct cancellation with reason, auditable decisions | **PASS** — FR-007/008/009/010/010a/011 map directly to explicit service methods (`submitPurchaseOrder`, `approvePurchaseOrder`, `rejectPurchaseOrder`, `cancelPurchaseOrder`), each producing an audit record; no edit path exists on a Pending Approval order, so a line change can never cross the threshold mid-approval (spec.md FR-008 edge case) |
| IV. Goods-Receipt Integrity | Partial/multiple receipts; outstanding qty derived; over-receipt rejected; concurrency-safe | **PASS** — required concurrency-safe over-receipt prevention (FR-014) is met because every API-driven receipt request runs inside a DB transaction where the trigger's `UPDATE` on the line takes a row lock, serializing concurrent requests before `CHECK (received_qty <= quantity)` is evaluated; this same mechanism happens to also hold against a raw SQL write, which is bonus hardening, not a required part of the guarantee (research.md §11) |
| V. Transactional Correctness | Multi-step writes atomic; concurrency-sensitive ops use DB transaction/locking, not app-memory checks alone | **PASS** — goods receipt insert + line update run in one DB transaction guarded by the CHECK constraint and row lock; approval/cancel state transitions use `SELECT ... FOR UPDATE` inside a Prisma transaction to prevent double-decision races |
| VI. Authentication and Authorization | Every action authenticated; roles distinct; backend-enforced; direct API calls subject to same rules | **PASS** — JWT required on every protected route via Express middleware; role-check middleware enforces Buyer/Approver/Procurement Admin boundaries (FR-017/018) plus the buyer≠approver check (FR-010a) |
| VII. API Validation | Invalid input rejected before business logic; consistent, explicit validation; clear error responses | **PASS** — `zod` schemas validate every request body/param before a service method is invoked (FR-004); validation failures return a distinct error shape from business-rule failures |
| VIII. Auditability | Structured audit records for PO creation, approval decisions, cancellation, goods receipts; actor/action/target/timestamp | **PASS** — the four FR-019-required action types (PO creation, approval decision, cancellation, goods receipt) each write an `AuditLogEntry` row in the same transaction as the business change; vendor create/deactivate and PO submission are additionally logged the same way as coverage beyond the graded minimum (spec.md FR-019) |
| IX. Query Correctness and Scalability | Outstanding-by-vendor-and-age computed in the DB, not in Node memory; indexes support access patterns | **PASS** — single indexed SQL query with `WHERE`/`GROUP BY` on `vendor_id`, `status`, `submitted_at`; no full-table load into the API process (FR-016) |
| X. Architecture | Simple modular monolith; explicit domain operations, not generic CRUD; clear frontend/API/domain/persistence separation | **PASS** — one Express app; service layer exposes named operations (`raisePurchaseOrder`, `approvePurchaseOrder`, `receiveGoods`, etc.); Prisma is the only persistence access point |
| XI. Testing | Automated tests for invariants, direct-API bypass attempts, locking, derived totals, receipts, over-receipt, concurrency, authorization | **PASS** — `tasks.md` now exists with contract/integration test tasks per user story covering exactly this list (direct-API bypass attempts on locked orders, derived-total tampering, partial/concurrent receipts, over-receipt, authorization boundaries); `quickstart.md` remains the manual end-to-end validation guide |
| XII. Scope Control | Simplest approach; no unnecessary infra/abstractions | **PASS** — single Postgres instance, no message queue/cache/microservice; Prisma instead of hand-rolled SQL layer is the one added dependency, justified by ORM+migration convenience for a solo 2-week build |
| XIII. Spec-Driven Development | Implementation traces to spec requirements | **PASS** — every design decision above cites the FR/SC it satisfies |

No violations requiring justification. Complexity Tracking table is intentionally empty.

**Post-Phase 1 re-check**: `data-model.md`, `contracts/api-contract.md`, and
`quickstart.md` were reviewed against the same table after design — no new violations were
introduced (no new services, no generic CRUD layer, no additional infrastructure beyond
Postgres). Status unchanged: all gates **PASS**.

**Post-Phase 2 (Tasks) re-check**: `tasks.md` (102 tasks across Setup, Foundational, and
five user-story phases) was reviewed against the same table after task generation — no new
violations were introduced (no additional services, infrastructure, or abstractions beyond
what this table already accounts for). Row XI above is updated accordingly now that the
task breakdown exists. Status unchanged: all gates **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/001-vendor-po-management/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── api-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma           # User, UserRole, Vendor, PurchaseOrder,
│   │                           # PurchaseOrderLine, GoodsReceiptEvent, AuditLogEntry
│   └── migrations/
│       └── ..._core_schema/    # includes the derived-total/outstanding-qty
│           migration.sql       # triggers and CHECK constraints (raw SQL, since
│                                # Prisma schema alone cannot express triggers)
├── src/
│   ├── domain/                 # explicit business operations, one module per aggregate
│   │   ├── vendor.service.ts       # createVendor, deactivateVendor
│   │   ├── purchaseOrder.service.ts# raisePurchaseOrder, editDraftOrder, submitPurchaseOrder
│   │   ├── approval.service.ts     # approvePurchaseOrder, rejectPurchaseOrder, cancelPurchaseOrder
│   │   ├── goodsReceipt.service.ts # receiveGoods
│   │   ├── reporting.service.ts    # outstandingOrdersByVendorAndAge
│   │   └── audit.service.ts        # recordAuditEntry (called from the above, same transaction)
│   ├── api/                    # Express routers/controllers (thin: validate → call domain → respond)
│   │   ├── auth.routes.ts
│   │   ├── vendors.routes.ts
│   │   ├── purchaseOrders.routes.ts
│   │   └── reports.routes.ts
│   ├── middleware/
│   │   ├── authenticate.ts     # JWT verification
│   │   ├── authorize.ts        # role-based access checks
│   │   └── validate.ts         # zod schema validation
│   ├── db/
│   │   └── prismaClient.ts
│   └── app.ts / server.ts
└── tests/
    ├── contract/                # one file per route group, validates request/response shape
    ├── integration/             # direct-API bypass attempts, locking, over-receipt, concurrency
    └── unit/                    # pure domain logic (e.g., threshold decision, total computation helpers)

frontend/
├── src/
│   ├── components/
│   ├── pages/                  # Vendor list, Raise PO, Approvals queue, Outstanding Orders report
│   └── services/                # API client (fetch wrapper + JWT attach)
└── tests/                       # minimal, smoke-level only (see Technical Context)

docker-compose.yml                # postgres, backend, frontend services
.env.example                      # documented config: DATABASE_URL, JWT_SECRET,
                                   # APPROVAL_THRESHOLD, ports
```

**Structure Decision**: Web application layout (Option 2: `backend/` + `frontend/`), since
the spec requires three distinct user-facing roles with different screens (buyer, approver,
procurement admin) sitting in front of one API. `backend/` holds the Express+Prisma
service, structured as a modular monolith with one `domain/` module per aggregate
(Constitution Principle X) rather than a generic CRUD/resource-controller pattern.
`frontend/` is a TypeScript React SPA that only calls the API — it holds no
business-rule logic (Constitution Principle I). `docker-compose.yml` and a single
`.env` file at the repo root wire the three runtime pieces together (Postgres, backend,
frontend), satisfying the spec's Assumption that the system starts with `docker compose up`
and no manual setup beyond a documented `.env`.

## Complexity Tracking

*No entries — Constitution Check reported no violations requiring justification.*
