---

description: "Task list for Vendor & Purchase Order Management"
---

# Tasks: Vendor & Purchase Order Management

**Input**: Design documents from `/specs/001-vendor-po-management/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contract.md, quickstart.md

**Tests**: Included. Constitution Principle XI ("Business invariants MUST have automated
tests. Direct API tests MUST verify that protected operations cannot bypass business
rules... at minimum: rejection of edits to an approved PO; correctness of derived totals;
partial and multiple goods receipts; prevention of over-receipt; concurrency-sensitive
receipt behavior; authorization rules") makes testing a graded requirement, not optional,
for this feature.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P1/P2/P2/P3) to
enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Every task names its exact file path

## Path Conventions

Web application layout per plan.md: `backend/src/`, `backend/prisma/`, `backend/tests/`
(contract/integration/unit), `frontend/src/`, `frontend/tests/`, plus `docker-compose.yml`
and `.env.example` at the repo root.

---

## Phase 1: Setup

**Purpose**: Project initialization — no business logic yet.

- [X] T001 Create the directory structure per plan.md's Project Structure:
  `backend/src/{domain,api,middleware,db}`, `backend/prisma/`,
  `backend/tests/{contract,integration,unit}`, `frontend/src/{components,pages,services}`,
  `frontend/tests/`
- [X] T002 Initialize the backend Node.js/TypeScript project — `backend/package.json`,
  `backend/tsconfig.json` — with dependencies `express`, `@prisma/client` + `prisma` (dev),
  `jsonwebtoken`, `bcrypt`, `zod` (plan.md Primary Dependencies: "Express 4.x... Prisma
  5.x... jsonwebtoken... bcrypt... zod")
- [X] T003 [P] Initialize the frontend project in `frontend/package.json` — React 18 +
  Vite, **plain JavaScript, no TypeScript** (plan.md: "Frontend written in plain
  JavaScript (ES2022+, no TypeScript) using React 18")
- [X] T004 [P] Configure ESLint + Prettier for the backend TypeScript project in
  `backend/eslint.config.js` / `backend/.prettierrc.json` (ESLint 9+ removed `.eslintrc*`
  in favor of flat config — `eslint.config.js` is the current equivalent)
- [X] T005 Run `prisma init` in `backend/`, wiring the `DATABASE_URL` env var into the
  `datasource` block of `backend/prisma/schema.prisma` (depends on T002)

**Checkpoint**: Repo scaffolding exists; no code yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, migrations, auth, and shared middleware that every user story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

> Prisma requires one schema file, so the seven data-model.md entities are defined as
> sequential tasks against the same `schema.prisma` (not `[P]`), each quoting that
> entity's data-model.md constraints verbatim so they aren't left to implementation-time
> discretion. Everything after schema+migrations is independent-file work and marked `[P]`.

- [X] T006 Define the `User` model in `backend/prisma/schema.prisma`: `id` (uuid PK),
  `email` (text, unique), `password_hash` (text), `created_at` (timestamptz). Quote
  data-model.md verbatim: "`email` unique and required; a user MUST hold at least one role
  (enforced via the `UserRole` join table below), and MAY hold more than one simultaneously
  (FR-018, FR-010a)."
- [X] T007 Define the `UserRole` model in `backend/prisma/schema.prisma`: `user_id` (FK →
  User), `role` (enum `BUYER`/`APPROVER`/`PROCUREMENT_ADMIN`), `created_at`; composite PK
  `(user_id, role)`. Quote data-model.md verbatim: "A user has zero or more rows here; zero
  is invalid (enforced at the application layer at user-creation time — every user must be
  created with at least one role)." (depends on T006)
- [X] T008 Define the `Vendor` model in `backend/prisma/schema.prisma`: `id`, `name` (text),
  `contact_name`/`contact_email`/`contact_phone` (nullable text), `payment_terms` (text),
  `is_active` (boolean, default `true`), timestamps. Quote data-model.md verbatim: "`name`
  and `payment_terms` required; no uniqueness constraint on `name` (FR-001)." (depends on
  T007)
- [X] T009 Define the `PurchaseOrder` model in `backend/prisma/schema.prisma`: `id`,
  `order_number` (text, unique), `vendor_id` (FK → Vendor), `status` (enum `DRAFT`/
  `PENDING_APPROVAL`/`APPROVED`/`REJECTED`/`CANCELLED`), `total` (numeric(12,2)),
  `created_by` (FK → User), `submitted_at`/`approved_at`/`rejected_at`/`cancelled_at`
  (nullable timestamptz), `approved_by`/`rejected_by`/`cancelled_by` (nullable FK → User),
  `rejection_reason`/`cancellation_reason` (nullable text), timestamps. Quote data-model.md
  verbatim: "A purchase order MUST have at least one line at every point in its lifecycle,
  starting at creation — there is no valid zero-line state, not even transiently" and
  "`approved_by` must not equal `created_by` (FR-010a, SC-007)" and "`rejection_reason`
  required for reject; `cancellation_reason` required for cancel, and the two are stored in
  distinct columns so they are never conflated." (depends on T008)
- [X] T010 Define the `PurchaseOrderLine` model in `backend/prisma/schema.prisma`: `id`,
  `purchase_order_id` (FK → PurchaseOrder), `description` (text), `quantity` (integer),
  `unit_price` (numeric(12,2)), `received_qty` (integer, default 0), timestamps. Quote
  data-model.md verbatim: "`CHECK (quantity > 0)`", "`CHECK (unit_price >= 0)`", and
  "`CHECK (received_qty <= quantity)` — enforces the *required* concurrency-safe
  over-receipt rule (FR-014)." Note: `outstanding_qty` is **not** a column — "it is always
  computed as `quantity - received_qty` at query/response time." (depends on T009)
- [X] T011 Define the `GoodsReceiptEvent` model in `backend/prisma/schema.prisma`: `id`,
  `purchase_order_line_id` (FK → PurchaseOrderLine), `quantity` (integer), `received_by`
  (FK → User), `received_at` (timestamptz, default now()). Quote data-model.md verbatim:
  "`quantity > 0` (rejected otherwise, FR-015); insertion only allowed when the parent
  order's status is `APPROVED`." (depends on T010)
- [X] T012 Define the `AuditLogEntry` model in `backend/prisma/schema.prisma`: `id`,
  `actor_type` (enum `USER`/`SYSTEM`), `actor_user_id` (nullable FK → User), `action`
  (enum/text — `PO_CREATED`, `PO_APPROVED`, `PO_REJECTED`, `PO_CANCELLED`,
  `GOODS_RECEIPT_RECORDED` are the FR-019-required minimum; `PO_SUBMITTED`,
  `VENDOR_CREATED`, `VENDOR_DEACTIVATED` are additional coverage beyond that minimum),
  `entity_type`, `entity_id`, `details` (jsonb), `created_at`. Quote data-model.md verbatim:
  "required when `actor_type = USER`; MUST be `NULL` when `actor_type = SYSTEM`." (depends
  on T011)
- [X] T013 Add indexes in `backend/prisma/schema.prisma`: `Vendor.is_active`;
  `PurchaseOrder(vendor_id, status)` and `PurchaseOrder(status, submitted_at)` — "supports
  the outstanding-orders-by-vendor-and-age query (FR-016) without a full scan";
  `PurchaseOrderLine.purchase_order_id`; `GoodsReceiptEvent.purchase_order_line_id`;
  `AuditLogEntry(entity_type, entity_id)` (depends on T012)
- [X] T014 Generate the initial structural Prisma migration (tables, FKs, enums — no CHECK
  constraints or triggers yet, since Prisma schema syntax can't express those) by running
  `prisma migrate dev` in `backend/` (depends on T013)
- [X] T015 Write a raw-SQL migration in
  `backend/prisma/migrations/<timestamp>_core_constraints_and_triggers/migration.sql`
  adding the CHECK constraints Prisma can't express: `quantity > 0`, `unit_price >= 0`,
  `received_qty <= quantity` on `purchase_order_line`; the reason-required constraint
  quoted verbatim from research.md §11: `CHECK ((status <> 'REJECTED' OR rejection_reason
  IS NOT NULL) AND (status <> 'CANCELLED' OR cancellation_reason IS NOT NULL))` on
  `purchase_order`; and the actor CHECK from data-model.md: `(actor_type = 'SYSTEM' AND
  actor_user_id IS NULL) OR (actor_type = 'USER' AND actor_user_id IS NOT NULL)` on
  `audit_log_entry`. Label this migration's purpose per research.md §11: bonus/
  defense-in-depth backstop, not the load-bearing enforcement (the service layer is)
  (depends on T014)
- [X] T016 In the same migration file, add the derived-total trigger (research.md §2):
  `AFTER INSERT/UPDATE/DELETE` on `purchase_order_line` recomputes the parent
  `purchase_order.total` as `SUM(quantity * unit_price)` across its lines (depends on T015)
- [X] T017 In the same migration file, add the derived-received-quantity trigger
  (research.md §2): `AFTER INSERT` on `goods_receipt_event` recomputes the parent line's
  `received_qty` as `SUM(quantity)` across its receipt events — note in a comment that this
  trigger's row lock on the `UPDATE` is what makes concurrent receipts serialize safely
  (research.md §2's concurrency-correctness detail) (depends on T016)
- [X] T018a In the same migration file, create the `purchase_order_number_seq` Postgres
  sequence (research.md §7) (depends on T017)
- [X] T018b [P] Implement a pure order-number formatting utility in
  `backend/src/domain/orderNumber.ts`: `formatOrderNumber(sequenceValue, year)` →
  `PO-{YYYY}-{seq:06d}` (research.md §7)
- [X] T018c In the same file, implement `generateOrderNumber(tx)` — reads
  `nextval('purchase_order_number_seq')` via the given Prisma transaction client and
  returns `formatOrderNumber(...)`, ready to be called from `raisePurchaseOrder` (T049)
  inside its own transaction (depends on T018a, T018b)
- [X] T019 [P] Create the Express app skeleton and Prisma client singleton:
  `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/db/prismaClient.ts` (depends
  on T014)
- [X] T020 [P] Implement the generic zod-validation middleware in
  `backend/src/middleware/validate.ts`, producing `400 { error: "validation_error",
  details: [...] }` on schema failure (api-contract.md Conventions)
- [X] T021 [P] Implement centralized error-handling middleware in
  `backend/src/middleware/errorHandler.ts` distinguishing `validation_error` (400) from
  `business_rule_violation` (409/422) from `not_found` (404), per api-contract.md
  Conventions
- [X] T022 Implement `POST /api/auth/login` in `backend/src/api/auth.routes.ts`: verifies
  credentials with `bcrypt`, issues a JWT via `jsonwebtoken` with payload `{ sub: userId,
  roles: string[] }` (research.md §5 — "a **list**, not a single role"), returns
  `200 { token, roles: string[] }` or `401` (api-contract.md Auth) (depends on T019)
- [X] T023 [P] Implement the `authenticate` middleware (JWT verification) in
  `backend/src/middleware/authenticate.ts` (depends on T019)
- [X] T024 Implement the `requireRole(role)` middleware factory in
  `backend/src/middleware/authorize.ts`, checking `token.roles.includes(role)` — "the
  caller's role set must include this role," never "is the caller's only role this"
  (api-contract.md Conventions, research.md §5) (depends on T023)
- [X] T025 [P] Implement `audit.service.ts` in `backend/src/domain/audit.service.ts`:
  `recordAuditEntry` helper writing an `AuditLogEntry` row inside a caller-supplied Prisma
  transaction, supporting both `actor_type: USER` (with `actorUserId`) and
  `actor_type: SYSTEM` (`actorUserId: null`) (depends on T019)
- [X] T026 Write the seed script `backend/prisma/seed.ts` creating four fixture users:
  one Buyer-only, one Approver-only, one Procurement-Admin-only, and **one holding both
  Buyer and Approver roles** (required for the self-approval test, quickstart.md
  Prerequisites) (depends on T024)
- [X] T027 [P] Create `docker-compose.yml` at the repo root (services: `postgres`,
  `backend`, `frontend`), `backend/Dockerfile`, `frontend/Dockerfile`, and `.env.example`
  documenting `DATABASE_URL`, `JWT_SECRET`, `APPROVAL_THRESHOLD` (default `5000`), and port
  bindings (research.md §10, quickstart.md Prerequisites)
- [X] T028 [P] Configure the Jest + Supertest test harness: `backend/jest.config.*`, a
  test-database reset/migrate helper run before the suite (against a real disposable
  Postgres per research.md §9 — "a mocked Prisma client would not actually prove the
  guarantee"), and a supertest app-import helper — `backend/tests/setup.ts`

**Checkpoint**: Schema, migrations, auth, middleware, audit, seed, and test harness are all
in place — every user story phase below can now proceed.

---

## Phase 3: User Story 1 - Maintain a Trustworthy Vendor Directory (Priority: P1)

**Goal**: A Buyer can create, list, and deactivate vendors; deactivated vendors can't be
referenced by new orders; duplicate vendor names are permitted.

**Independent Test**: Create, view, and deactivate a vendor record independent of any
purchase order; confirm a deactivated vendor no longer appears as a valid choice.

> Note: spec.md's US1 Acceptance Scenario 3 ("a deactivated vendor blocks a new PO") is
> tested in **US2** instead (T047), since it requires the PO-creation endpoint that only
> exists once US2 is built — keeping this phase's tests strictly vendor-only preserves
> US1's independent testability.

### Tests for User Story 1

- [X] T029 [P] [US1] Contract test `POST /api/vendors` in
  `backend/tests/contract/vendors.create.test.ts`
- [X] T030 [P] [US1] Contract test `GET /api/vendors` (incl. `?active=true|false`) in
  `backend/tests/contract/vendors.list.test.ts`
- [X] T031 [P] [US1] Contract test `GET /api/vendors/:id` in
  `backend/tests/contract/vendors.get.test.ts`
- [X] T032 [P] [US1] Contract test `POST /api/vendors/:id/deactivate` (idempotent if
  already inactive) in `backend/tests/contract/vendors.deactivate.test.ts`
- [X] T033 [P] [US1] Integration test: creating a vendor with a name that already exists
  succeeds as a distinct record (spec.md US1 AS4, FR-001: "no uniqueness constraint on
  `name`") in `backend/tests/integration/vendor-duplicate-name.test.ts`

### Implementation for User Story 1

- [X] T034 [P] [US1] Implement `vendor.service.ts` — `createVendor`, `listVendors
  (activeFilter)`, `getVendorById`, `deactivateVendor` (idempotent) — writing
  `VENDOR_CREATED`/`VENDOR_DEACTIVATED` audit entries (additional coverage beyond FR-019's
  graded minimum, per spec.md's FR-019 note) — `backend/src/domain/vendor.service.ts`
- [X] T035 [US1] Implement zod schemas for the vendor create body and the `?active=`
  list-query param in `backend/src/api/vendors.routes.ts`
- [X] T036 [US1] Wire `vendors.routes.ts`: `POST` (Buyer), `GET` list (any authenticated),
  `GET :id` (any authenticated), `POST :id/deactivate` (Buyer) —
  `backend/src/api/vendors.routes.ts` (depends on T034, T035)
- [X] T037 [US1] Mount the vendors router in `backend/src/app.ts` (depends on T036)

**Checkpoint**: Vendor directory is fully functional and independently testable.

---

## Phase 4: User Story 2 - Raise a Purchase Order With a Guaranteed-Correct Total (Priority: P1)

**Goal**: A Buyer raises a purchase order against an active vendor with ≥1 line item; the
total is always exactly the sum of its lines and can never be set independently, at any
code path — and a purchase order can never exist with zero lines, at creation or by later
edit.

**Independent Test**: Create a draft order with several lines; confirm the stored total
always equals the computed sum; confirm no request (including one that tries to set
`total` directly, or create/edit down to zero lines) can violate either invariant.

### Tests for User Story 2

- [X] T038 [P] [US2] Contract test `POST /api/purchase-orders` (required, non-empty
  `lines`) in `backend/tests/contract/purchase-orders.create.test.ts`
- [X] T039 [P] [US2] Contract test `GET /api/purchase-orders` (`?vendorId=&status=`) in
  `backend/tests/contract/purchase-orders.list.test.ts`
- [X] T040 [P] [US2] Contract test `GET /api/purchase-orders/:id` (with lines) in
  `backend/tests/contract/purchase-orders.get.test.ts`
- [X] T041 [P] [US2] Contract test `PATCH /api/purchase-orders/:id` (full line replacement,
  DRAFT only) in `backend/tests/contract/purchase-orders.patch.test.ts`
- [X] T042 [US2] Integration test: the total is recomputed to equal
  `sum(quantity × unitPrice)` across create, and add/remove/edit line on a draft (spec.md
  US2 AS1/AS2) in `backend/tests/integration/po-total-integrity.test.ts`
- [X] T043 [US2] Integration test: every attempt to set `total` directly (create body,
  patch body) is rejected/ignored and the stored total never disagrees with the line sum
  (spec.md US2 AS3, FR-005, SC-001: "100% of attempts — across every tested code path,
  including direct API calls") in
  `backend/tests/integration/po-total-direct-write-rejected.test.ts`
- [X] T043a [US2] Integration test: a create-PO or patch-PO request body containing
  `receivedQty` or `outstandingQty` on a line is rejected `400 validation_error` — the same
  treatment as `total` (api-contract.md Conventions: "Derived fields are never accepted as
  request input"; data-model.md `PurchaseOrderLine` validation rules: "`received_qty` and
  `outstanding_qty` are never accepted as API input") in
  `backend/tests/integration/po-line-derived-field-rejected.test.ts`
- [X] T044 [US2] Integration test: creating a PO with an empty or missing `lines` list is
  rejected `400` before any order is created (spec.md US2 AS6, FR-003: "There is no valid
  zero-line state — not at creation") in
  `backend/tests/integration/po-create-requires-line.test.ts`
- [X] T045 [US2] Integration test: a draft with exactly one line rejects `PATCH`ing
  `lines: []` to remove it, leaving the original line intact (spec.md US2 AS4, FR-004:
  "MUST also reject any edit... that would leave the order with zero line items") in
  `backend/tests/integration/po-cannot-remove-last-line.test.ts`
- [X] T046 [US2] Integration test: a line with non-positive quantity or negative unit price
  is rejected `400` before any order/line is created or modified (spec.md US2 AS5, FR-004)
  in `backend/tests/integration/po-line-validation.test.ts`
- [X] T047 [US2] Integration test: creating a PO against a vendor that doesn't exist or is
  inactive is rejected before any order record is created (spec.md US1 AS3, FR-002 — placed
  here since it needs this story's create endpoint) in
  `backend/tests/integration/po-requires-active-vendor.test.ts`
- [X] T048 [US2] Integration test: each created PO gets a unique, human-readable
  `orderNumber` (e.g. `PO-2026-000123`), unique even under concurrent creates (spec.md
  FR-003a, research.md §7) in `backend/tests/integration/po-order-number.test.ts`

### Implementation for User Story 2

- [X] T049 [US2] Implement `raisePurchaseOrder` in
  `backend/src/domain/purchaseOrder.service.ts` — validates the vendor is active (FR-002),
  requires ≥1 line (FR-003), rejects invalid line quantity/price (FR-004), computes the
  total from lines, generates the order number (T018c), writes the lines, records a
  `PO_CREATED` audit entry — all in one Prisma transaction
- [X] T050 [US2] Implement `editDraftOrder` in the same file — allows vendor/line edits
  only while `status = DRAFT` (FR-006), rejects any edit that would leave zero lines
  (FR-004), recomputes the total (depends on T049)
- [X] T051 [US2] Implement `listPurchaseOrders`/`getPurchaseOrderById` read methods in the
  same file, with lines and `outstandingQty` computed as `quantity - receivedQty` at
  response time (data-model.md) (depends on T049)
- [X] T052 [US2] Implement zod schemas: create-PO body (`vendorId` required, `lines`
  required non-empty array of `{description, quantity > 0, unitPrice >= 0}`) and PATCH body
  (same line shape, non-empty if `lines` supplied) in
  `backend/src/api/purchaseOrders.routes.ts`
- [X] T053 [US2] Wire `purchaseOrders.routes.ts`: `POST`, `GET` list, `GET :id`, `PATCH :id`
  (Buyer for writes, any authenticated for reads) (depends on T049–T052)
- [X] T054 [US2] Mount the purchase-orders router in `backend/src/app.ts` (depends on T053)

**Checkpoint**: Vendors + guaranteed-correct, always-≥1-line purchase orders are fully
functional and independently testable.

---

## Phase 5: User Story 3 - Approve, Lock, and Cancel Purchase Orders (Priority: P2)

**Goal**: Submitting a draft auto-approves at/below the threshold or enters pending
approval above it; a submitted order's lines/vendor/total are permanently locked; an
Approver (never the raising Buyer) approves/rejects a pending order or cancels an approved
one with a required reason.

**Independent Test**: Submit an order below the threshold and confirm auto-approval;
submit one above and confirm it requires an Approver action; confirm no edit endpoint can
alter a submitted order regardless of its approval state.

### Tests for User Story 3

- [X] T055 [P] [US3] Contract test `POST /api/purchase-orders/:id/submit` in
  `backend/tests/contract/po-submit.test.ts`
- [X] T056 [P] [US3] Contract test `POST /api/purchase-orders/:id/approve` in
  `backend/tests/contract/po-approve.test.ts`
- [X] T057 [P] [US3] Contract test `POST /api/purchase-orders/:id/reject` in
  `backend/tests/contract/po-reject.test.ts`
- [X] T058 [P] [US3] Contract test `POST /api/purchase-orders/:id/cancel` in
  `backend/tests/contract/po-cancel.test.ts`
- [X] T059 [US3] Integration test: submitting an order at/below `APPROVAL_THRESHOLD`
  auto-approves immediately, no manual step (spec.md US3 AS1, FR-007) in
  `backend/tests/integration/po-auto-approve.test.ts`
- [X] T060 [US3] Integration test: submitting an order above the threshold enters
  `PENDING_APPROVAL` (spec.md US3 AS2, FR-007) in
  `backend/tests/integration/po-pending-approval.test.ts`
- [X] T061 [US3] Integration test: attempting to `PATCH` a `PENDING_APPROVAL` or `APPROVED`
  order's lines/vendor/total — including specifically trying to push the total across the
  threshold — is rejected `409` with a specific "order is locked" error every time (spec.md
  US3 AS5, FR-008/FR-009 — the direct mid-approval-threshold-crossing answer, quickstart.md
  Scenario 3 step 3) in `backend/tests/integration/po-locked-after-submission.test.ts`
- [X] T062 [US3] Integration test: an Approver approves a pending order → `APPROVED`;
  rejects with a reason → `REJECTED` with that reason stored; rejecting without a reason is
  refused `400` (spec.md US3 AS3/AS4, FR-010) in
  `backend/tests/integration/po-approve-reject.test.ts`
- [X] T063 [US3] Integration test: the user who raised a PO cannot approve it even while
  also holding the Approver role — an identity check, not a role check — using the seeded
  Buyer+Approver fixture (spec.md US3 AS8, FR-010a, SC-007) in
  `backend/tests/integration/po-self-approval-rejected.test.ts`
- [X] T064 [US3] Integration test: cancelling an approved order requires a reason (`400`
  without one), and the reason is stored distinctly from any rejection reason (spec.md US3
  AS6/AS7, FR-011) in `backend/tests/integration/po-cancel-requires-reason.test.ts`
- [X] T065 [US3] Integration test: approving/rejecting/cancelling a Draft order, or an
  order already Approved/Rejected/Cancelled, is rejected as an invalid state transition
  (spec.md Edge Cases) in `backend/tests/integration/po-invalid-state-transitions.test.ts`
- [X] T066 [US3] Integration test: two concurrent approval requests on the same pending
  order — only one decision is recorded, the other rejected (spec.md Edge Cases,
  Constitution Principle V) via `Promise.all` in
  `backend/tests/integration/po-concurrent-approval.test.ts`

### Implementation for User Story 3

- [X] T067 [US3] Implement `submitPurchaseOrder` in
  `backend/src/domain/approval.service.ts` — requires ≥1 line as redundant defense-in-depth
  (FR-004), reads `APPROVAL_THRESHOLD` from env, decides `APPROVED` vs `PENDING_APPROVAL`,
  locks the order against further edits (FR-008), writes a `PO_SUBMITTED` audit entry plus
  — for auto-approval — a `PO_APPROVED` entry with `actor_type: SYSTEM` (data-model.md
  "When SYSTEM is used")
- [X] T068 [US3] Implement `approvePurchaseOrder` in the same file — `SELECT ... FOR UPDATE`
  on the order row (concurrency-safe decision, T066), rejects if not `PENDING_APPROVAL`,
  rejects if `approverId === order.createdBy` (FR-010a), writes a `PO_APPROVED` audit entry
  (depends on T067)
- [X] T069 [US3] Implement `rejectPurchaseOrder` and `cancelPurchaseOrder` in the same
  file — both require a `reason`, each written to its own distinct column, each writing a
  `PO_REJECTED`/`PO_CANCELLED` audit entry (depends on T067)
- [X] T070 [US3] Implement zod schemas requiring a non-empty `reason` string for the
  reject/cancel request bodies in `backend/src/api/purchaseOrders.routes.ts`
- [X] T071 [US3] Wire the submit/approve/reject/cancel routes onto
  `purchaseOrders.routes.ts` (Buyer for submit, Approver for approve/reject/cancel)
  (depends on T067–T070)

**Checkpoint**: Approval, locking, and cancellation are fully functional and independently
testable on top of US1+US2.

---

## Phase 6: User Story 4 - Record Goods Receipts Against an Order (Priority: P2)

**Goal**: A Buyer records partial or multiple goods receipts against an approved order's
lines; outstanding quantity is always derived and correct; over-receipt is rejected even
under concurrency.

**Independent Test**: Record two or more partial receipts against a single line, confirm
outstanding quantity always reflects exactly what remains, and confirm an over-receipt
attempt is rejected every time, including concurrently.

### Tests for User Story 4

- [X] T072 [P] [US4] Contract test `POST /api/purchase-orders/:id/lines/:lineId/receipts`
  in `backend/tests/contract/po-receipts.create.test.ts`
- [X] T073 [P] [US4] Contract test `GET /api/purchase-orders/:id/lines/:lineId/receipts` in
  `backend/tests/contract/po-receipts.list.test.ts`
- [X] T074 [US4] Integration test: a partial receipt updates `receivedQty`/`outstandingQty`
  correctly; a second partial receipt on the same line accumulates correctly (spec.md US4
  AS1/AS2) in `backend/tests/integration/po-receipt-partial.test.ts`
- [X] T075 [US4] Integration test: a receipt that would push received quantity above
  ordered quantity is rejected `409`, recorded quantity unchanged (spec.md US4 AS3, FR-014,
  SC-002) in `backend/tests/integration/po-receipt-over-receipt.test.ts`
- [X] T076 [US4] Integration test: two concurrent receipt requests on the same line where
  only one fits — exactly one succeeds, the other is rejected, received quantity never
  exceeds ordered quantity (spec.md US4 AS4, FR-014, SC-002) via `Promise.all` in
  `backend/tests/integration/po-receipt-concurrent.test.ts`
- [X] T077 [US4] Integration test: a receipt against a Cancelled, Draft, or
  Pending-Approval order is rejected (spec.md US4 AS5, Edge Cases, FR-015) in
  `backend/tests/integration/po-receipt-requires-approved.test.ts`
- [X] T078 [US4] Integration test: a receipt with zero or negative quantity is rejected
  (spec.md Edge Cases, FR-015) in `backend/tests/integration/po-receipt-validation.test.ts`
- [X] T078a [US4] Integration test: a goods-receipt request body containing `receivedQty`
  or `outstandingQty` (instead of or alongside `quantity`) is rejected
  `400 validation_error` — the same treatment as `total` (api-contract.md Conventions;
  data-model.md `PurchaseOrderLine` validation rules) in
  `backend/tests/integration/po-receipt-derived-field-rejected.test.ts`

### Implementation for User Story 4

- [X] T079 [US4] Implement `receiveGoods` in
  `backend/src/domain/goodsReceipt.service.ts` — checks the parent order's
  `status = APPROVED` (FR-015), validates `quantity > 0`, inserts the `GoodsReceiptEvent`
  (trigger + `CHECK (received_qty <= quantity)` recompute/reject per research.md §2),
  writes a `GOODS_RECEIPT_RECORDED` audit entry
- [X] T080 [US4] Implement the zod schema for the receipt body (`quantity` positive
  integer) in `backend/src/api/purchaseOrders.routes.ts`
- [X] T081 [US4] Wire the receipts `POST`/`GET` routes onto `purchaseOrders.routes.ts`
  (Buyer for `POST`, any authenticated for `GET`) (depends on T079, T080)

**Checkpoint**: Goods receipt integrity is fully functional and independently testable on
top of US1–US3.

---

## Phase 7: User Story 5 - View Outstanding Orders by Vendor and Age (Priority: P3)

**Goal**: A Procurement Admin sees exactly the Approved-and-not-fully-received orders,
filterable by vendor, with age measured since submission — computed entirely database-side
even at 10,000+ orders.

**Independent Test**: Create orders in every status and receipt state across multiple
vendors and ages; confirm the view returns exactly the Approved-and-not-fully-received
ones, correctly filtered and aged, without exercising any other feature first.

### Tests for User Story 5

- [X] T082 [P] [US5] Contract test `GET /api/reports/outstanding-orders` in
  `backend/tests/contract/reports.outstanding-orders.test.ts`
- [X] T083 [US5] Integration test: only `APPROVED` orders with ≥1 line where
  `receivedQty < quantity` are returned; every Draft/Pending Approval/Rejected/Cancelled
  order is excluded, including a Cancelled order partially received before cancellation
  (spec.md US5 AS1/AS5, FR-016) in `backend/tests/integration/report-exact-filter.test.ts`
- [X] T084 [US5] Integration test: `?vendorId=` returns only that vendor's outstanding
  orders (spec.md US5 AS2) in `backend/tests/integration/report-vendor-filter.test.ts`
- [X] T085 [US5] Integration test: `ageDays` is computed from `submittedAt`, not
  `approvedAt` — an order that sat in Pending Approval for a while shows its full
  submission-based age after approval (spec.md US5 AS3, research.md §13) in
  `backend/tests/integration/report-age-reference-point.test.ts`
- [X] T086 [US5] Performance test: using the seeded ≥10,000-order/≥50,000-line dataset,
  request a page (`pageSize=50`), assert response time < 2s, and run `EXPLAIN ANALYZE` to
  confirm the `(vendor_id, status)`/`(status, submitted_at)` indexes are used rather than a
  sequential scan (spec.md US5 AS4, SC-004, research.md §12) in
  `backend/tests/integration/report-performance.test.ts` (depends on T087–T090 for
  execution, though authored earlier per the tests-first pattern)

### Implementation for User Story 5

- [X] T087 [US5] Write a dataset seed/generator script producing ≥10,000 purchase orders /
  ≥50,000 lines with varied vendors, statuses, and `submitted_at` timestamps, for
  performance testing (research.md §12) in `backend/prisma/seed-perf.ts`
- [X] T088 [US5] Implement `outstandingOrdersByVendorAndAge` in
  `backend/src/domain/reporting.service.ts` — one indexed SQL query
  (`status = 'APPROVED' AND EXISTS (line where received_qty < quantity)`), computes
  `ageDays` from `submitted_at`, supports `vendorId`/`minAgeDays`/`maxAgeDays` filters and
  `page`/`pageSize` pagination, entirely database-side (FR-016, Constitution Principle IX)
- [X] T089 [US5] Implement the zod schema for report query params and wire
  `GET /api/reports/outstanding-orders` (Procurement Admin only) in
  `backend/src/api/reports.routes.ts` (depends on T088)
- [X] T090 [US5] Mount the reports router in `backend/src/app.ts` (depends on T089)

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Concerns that span multiple stories.

- [ ] T091 [P] Contract test `GET /api/purchase-orders/:id/audit-log` in
  `backend/tests/contract/audit-log.test.ts`
- [ ] T092 Integration test: every PO creation, approval decision (approve/reject),
  cancellation, and goods receipt produces a structured audit record identifying actor,
  action, target, and timestamp — the FR-019 **required minimum** (spec.md FR-019, SC-005)
  in `backend/tests/integration/audit-required-minimum.test.ts`
- [ ] T093 Integration test: an auto-approved order's audit log contains both a
  `PO_SUBMITTED` (`actorType: USER`) entry and a `PO_APPROVED` (`actorType: SYSTEM`,
  `actorUserId: null`) entry (data-model.md "When SYSTEM is used") in
  `backend/tests/integration/audit-system-actor.test.ts`
- [ ] T094 Integration test: every route rejects an unauthenticated request `401`, and
  rejects a caller whose role set doesn't permit the action `403` (spec.md SC-006,
  quickstart.md Authentication & authorization sanity checks) in
  `backend/tests/integration/authz-sanity.test.ts`
- [ ] T095 Implement `GET /api/purchase-orders/:id/audit-log` in
  `backend/src/api/purchaseOrders.routes.ts`, returning a chronological
  `AuditLogEntry[]` for that order (depends on T049, T067, T079 having audit-writing in
  place)
- [ ] T096 [P] Build minimal frontend pages per plan.md's Project Structure — Vendor list,
  Raise PO, Approvals queue, Outstanding Orders report — in `frontend/src/pages/` (React,
  plain JavaScript, calling the API only; no business-rule logic, per Constitution
  Principle I)
- [ ] T097 [P] Finalize `.env.example` and a README section confirming `docker compose up`
  plus the documented `.env` file is the only required setup step (spec.md Assumption)
- [ ] T098 Run the full `quickstart.md` validation guide end-to-end against a freshly
  started `docker compose up` stack and confirm every scenario's expected outcome
  (depends on all prior tasks)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational; T047 also depends on US1's vendor
  service existing (T034) since it exercises vendor-inactive rejection through the PO
  create endpoint.
- **User Story 3 (Phase 5)**: Depends on Foundational + US2 (needs `raisePurchaseOrder`,
  the PO to submit against).
- **User Story 4 (Phase 6)**: Depends on Foundational + US3 (receipts only apply to an
  `APPROVED` order).
- **User Story 5 (Phase 7)**: Depends on Foundational + US3/US4 (reports over orders that
  have been approved and partially/fully received). T086 specifically also depends on
  T087–T090 (the perf dataset generator, the reporting query, route wiring, and router
  mount) all being complete before it can actually execute — it's authored earlier in the
  phase only because tests are written first, not because it can run before them.
- **Polish (Phase 8)**: Depends on all five user stories (the audit-log endpoint reads
  entries written by US1–US4; the quickstart run exercises every story).

### Within Each User Story

- Contract tests → integration tests → service implementation → route wiring → router
  mount, in that order per story.
- Tests are written first (and should fail) before their story's implementation tasks.

### Parallel Opportunities

- All Setup `[P]` tasks (T003, T004) can run together.
- Within Foundational, T019–T028 marked `[P]` touch independent files and can run together
  once the schema/migration chain (T006–T018c, necessarily sequential — one schema file,
  one migration file) is done.
- Within each story, all contract tests marked `[P]` can run together; most integration
  tests are listed sequentially only because they build on the same fixtures within a
  file-sharing test suite, not because of a hard ordering requirement.
- US1 and the vendor-independent parts of US2 (T038–T046, T048–T054) could be staffed in
  parallel by different developers once Foundational is done; T047 is the one deliberate
  cross-story link (documented above).

---

## Parallel Example: User Story 1

```bash
# Launch all contract tests for User Story 1 together:
Task: "Contract test POST /api/vendors in backend/tests/contract/vendors.create.test.ts"
Task: "Contract test GET /api/vendors in backend/tests/contract/vendors.list.test.ts"
Task: "Contract test GET /api/vendors/:id in backend/tests/contract/vendors.get.test.ts"
Task: "Contract test POST /api/vendors/:id/deactivate in backend/tests/contract/vendors.deactivate.test.ts"
Task: "Integration test duplicate vendor name in backend/tests/integration/vendor-duplicate-name.test.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 — both P1)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational) — Foundational is the larger lift
   here (schema, triggers, auth) but it's what every story stands on.
2. Complete Phase 3 (US1) and Phase 4 (US2) — together these are the MVP: a trustworthy
   vendor directory plus a purchase order whose total can never drift from its lines and
   can never exist with zero lines.
3. **STOP and VALIDATE**: run US1+US2's tests and quickstart Scenarios 1–2 independently.
4. Deploy/demo if ready — this alone answers the feature's stated "center of gravity"
   (derived-value integrity under editing).

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 + US2 → MVP (vendor integrity + tamper-proof, always-≥1-line orders) → validate.
3. US3 → approval/locking/cancellation → validate (adds the financial-authority control).
4. US4 → goods receipt integrity → validate (closes the "what's outstanding" loop).
5. US5 → outstanding-orders report → validate (the payoff view, now that there's data to
   report on).
6. Polish → audit-log endpoint, frontend, docs, full quickstart run.

Each story adds value without breaking the previous ones, consistent with Constitution
Principle XII (Scope Control) — this is a solo 2-week POC, so sequential delivery in
priority order (rather than a parallel-team strategy) is the realistic default.

---

## Notes

- `[P]` tasks touch different files with no completion-order dependency.
- `[Story]` labels map every user-story-phase task to spec.md's US1–US5 for traceability.
- Tests are included per Constitution Principle XI; write them first and confirm they fail
  before implementing.
- T047 (vendor-inactive blocks PO creation) is deliberately placed in US2, not US1, even
  though it's spec.md's US1 Acceptance Scenario 3 — it needs the PO-create endpoint, so
  testing it under US1 would break that story's independent testability.
- Commit after each task or logical group; stop at any checkpoint to validate a story
  independently before moving on.
