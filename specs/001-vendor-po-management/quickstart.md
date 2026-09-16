# Quickstart: Vendor & Purchase Order Management

Validation guide for proving the feature works end-to-end. See `data-model.md` for entity
shapes and `contracts/api-contract.md` for exact request/response formats.

## Prerequisites

- Docker and Docker Compose installed.
- A `.env` file at the repo root (copy `.env.example`), providing at least:
  `DATABASE_URL`, `JWT_SECRET`, `APPROVAL_THRESHOLD` (default `5000`).

## Setup

```bash
docker compose up --build
```

This starts `postgres`, `backend` (runs Prisma migrations, then serves the API), and
`frontend`. No manual setup beyond the `.env` file (spec Assumption).

Seed at least: one Buyer-only user, one Approver-only user, one Procurement-Admin-only
user, and **one user holding both Buyer and Approver roles** (required for Scenario 3's
self-approval check) — via a seed script run as part of `backend` startup or a one-off
`docker compose exec backend npm run seed`.

## Scenario 1 — Vendor directory (User Story 1)

1. Log in as Buyer → `POST /api/auth/login`.
2. Create a vendor: `POST /api/vendors { name: "Acme Supplies", paymentTerms: "Net 30" }`.
   Expect `201` with `isActive: true`.
3. Create a second vendor with the **same name** → expect `201` (duplicate names allowed,
   distinguished by `id`).
4. Deactivate the first vendor: `POST /api/vendors/:id/deactivate` → expect
   `isActive: false`.
5. Attempt `POST /api/purchase-orders` against the deactivated vendor's id → expect `409`
   before any order is created.

## Scenario 2 — Derived, tamper-proof total (User Story 2)

1. As Buyer, `POST /api/purchase-orders` against the active vendor with two lines
   (e.g. `3 × $10`, `2 × $25`) → expect `201`, `status: "DRAFT"`, `total: "80.00"`.
2. `PATCH` the order to add a third line → expect `total` recalculated.
3. Attempt to `PATCH`/create with a `total` field in the body directly → expect the field
   to be ignored/rejected, never reflected in the stored value (no contract endpoint
   accepts `total` as input at all — confirm the response `total` still equals the true
   line sum).
4. Attempt a line with `quantity: -1` or `unitPrice: -5` → expect `400 validation_error`.
5. `POST /api/purchase-orders { vendorId }` with **no `lines` field at all** (or
   `lines: []`) → expect `400 validation_error` with a message such as "A purchase order
   must have at least one line item" — there is no valid empty-draft state (FR-003).
6. Create a draft with **exactly one line**, then `PATCH` it with `lines: []` (attempting
   to remove the only line) → expect `400 validation_error` — a draft can never be edited
   down to zero lines (FR-004). Confirm the order still has its original one line
   afterward.

## Scenario 3 — Approval, locking, segregation of duties (User Story 3)

1. Create and submit an order **at or below** `APPROVAL_THRESHOLD` →
   `POST /api/purchase-orders/:id/submit` → expect `status: "APPROVED"` immediately, no
   manual approval step.
2. Create and submit an order **above** the threshold → expect `status: "PENDING_APPROVAL"`.
3. Attempt `PATCH` on either submitted order (lines/vendor) → expect `409` with a specific
   "order is locked" reason, not a silent no-op. **This is the direct test for "what if a
   line changes while mid-approval and the total crosses the threshold"** (spec.md FR-008):
   attempt to `PATCH` the `PENDING_APPROVAL` order's lines to push its total across the
   threshold in either direction → expect `409` every time — there is no edit path on a
   `PENDING_APPROVAL` order, so this can never actually happen.
4. Using the seeded Buyer+Approver user, raise and submit an order above the threshold,
   then attempt `POST /api/purchase-orders/:id/approve` with that **same user's**
   credentials → expect `409` (FR-010a / SC-007) — this is an identity check
   (`approvedBy` id vs. `createdBy` id), not a role check, so holding the Approver role is
   not sufficient.
5. Log in as a **different** Approver → `POST .../approve` → expect `200`,
   `status: "APPROVED"`.
6. On a `PENDING_APPROVAL` order, `POST .../reject` with no `reason` → expect `400`; with a
   `reason` → expect `200`, `status: "REJECTED"`.
7. On an `APPROVED` order, `POST .../cancel` with no `reason` → expect `400`; with a
   `reason` → expect `200`, `status: "CANCELLED"`, and confirm the cancellation reason is
   stored separately from any rejection reason.

## Scenario 4 — Goods receipt integrity (User Story 4)

1. On an `APPROVED` order with a 10-unit line, `POST .../lines/:lineId/receipts
   { quantity: 4 }` → expect `201`, `receivedQty: 4`, `outstandingQty: 6`.
2. `POST` a second receipt of `6` → expect `receivedQty: 10`, `outstandingQty: 0`.
3. Attempt a third receipt of `1` (now over-ordered) → expect `409`.
4. Reset to a line with `6` outstanding; fire two concurrent requests
   (`quantity: 4` and `quantity: 3`) via `Promise.all` from a test script → expect exactly
   one `201` and one `409`, and the final `receivedQty` never exceeds `quantity`.
5. Attempt a receipt against a `CANCELLED` order → expect `409`.

## Scenario 5 — Outstanding orders by vendor and age (User Story 5)

1. Seed (or use the optional 10,000-order dataset generator) a mix across several vendors:
   Draft, Pending Approval, Rejected, Cancelled, fully-received Approved, partially-received
   Approved, unreceived Approved, and an Approved order that was partially received and
   then cancelled — with varying `submittedAt` timestamps.
2. As Procurement Admin, `GET /api/reports/outstanding-orders` → expect **only** orders
   with `status: "APPROVED"` and at least one line where `receivedQty < quantity`. Confirm
   every Draft, Pending Approval, Rejected, and Cancelled order is absent — including the
   cancelled-after-partial-receipt order (FR-016).
3. `GET .../outstanding-orders?vendorId=X` → expect only that vendor's outstanding orders.
4. Confirm each result's `ageDays` matches time elapsed since `submittedAt`, **not**
   `approvedAt` (research.md §13): submit an order, wait (or seed it with a past
   `submittedAt`), leave it `PENDING_APPROVAL` for a while, then approve it — its `ageDays`
   should reflect the full time since submission, not reset to ~0 at the moment of
   approval.
5. With the 10,000-order / 50,000-line dataset loaded, request a page (`pageSize=50`) and
   confirm it returns in **under 2 seconds** (SC-004) — this is a hard, testable
   threshold, not just "feels fast." Additionally run `EXPLAIN ANALYZE` on the underlying
   query to confirm it uses the `(vendor_id, status)` / `(status, submitted_at)` indexes
   rather than a sequential scan (research.md §12) — wall-clock time alone can pass by
   coincidence without proving index usage.

## Authentication & authorization sanity checks

- Any request above without an `Authorization: Bearer <token>` header → `401`.
- A Buyer token used against `POST .../approve` → `403`.
- A Procurement Admin token used against `POST /api/purchase-orders` (raise an order) →
  `403`.

## Audit trail check

- After Scenarios 2–4, `GET /api/purchase-orders/:id/audit-log` → expect one entry per
  creation, approval/rejection decision, cancellation, and goods receipt (the four
  FR-019-**required** types), each identifying the acting user and a timestamp (FR-019,
  SC-005). Submission entries also appear, but as additional coverage beyond that graded
  minimum, not a required check in their own right.
- For the order auto-approved below the threshold in Scenario 3 step 1, confirm the log
  contains **two** entries for that transition: `PO_SUBMITTED` with `actorType: "USER"`
  (the Buyer), and `PO_APPROVED` with `actorType: "SYSTEM"` and `actorUserId: null`
  (data-model.md's `AuditLogEntry`) — distinguishing an automatic approval from a human
  Approver's decision.
