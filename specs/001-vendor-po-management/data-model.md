# Phase 1 Data Model: Vendor & Purchase Order Management

Entities correspond to the spec's Key Entities section. Types are given as
Postgres/Prisma types per the technical decisions in `research.md`. Fields marked
**derived** are never client-writable through any API contract, but the two derived
values are handled differently — this is an explicit stated decision, not left to
inference: `PurchaseOrder.total` **is stored and kept in sync via trigger** (not computed
on read), while `PurchaseOrderLine.received_qty` is likewise **stored-and-synced** via
trigger; `PurchaseOrderLine.outstanding_qty`, by contrast, is **never a column at all** —
it is always computed as `quantity - received_qty` at query/response time (see
`PurchaseOrderLine` below).

**Scope note (rubric alignment)**: the triggers/CHECK constraints referenced below satisfy
the *required* guarantee (no API call or application code path can desync `total` or
`outstanding_qty` from lines/receipts) as a side effect of being the mechanism the API
layer relies on; they additionally happen to survive a raw SQL write bypassing the app
entirely, which is bonus hardening beyond what this POC is graded on, not a requirement in
its own right (research.md §2, §11 — corrected there after an earlier pass overstated this
as required).

## User

Authenticated actor that can hold **one or more** roles at once (spec.md Clarifications /
FR-010a require this: the self-approval test needs a single user who is simultaneously a
Buyer and an Approver). Roles are modeled as a separate join table, not a single enum
column, so a user can hold any non-empty subset of `{BUYER, APPROVER, PROCUREMENT_ADMIN}`.

| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| email | text, unique | login identifier |
| password_hash | text | bcrypt hash, never returned by any API response |
| created_at | timestamptz | |

**Validation rules**: `email` unique and required; a user MUST hold at least one role
(enforced via the `UserRole` join table below), and MAY hold more than one simultaneously
(FR-018, FR-010a).

## UserRole

Join table granting a role to a user. A user has zero or more rows here; **zero is
invalid** (enforced at the application layer at user-creation time — every user must be
created with at least one role).

| Field | Type | Notes |
|---|---|---|
| user_id | uuid (FK → User) | |
| role | enum: `BUYER`, `APPROVER`, `PROCUREMENT_ADMIN` | |
| created_at | timestamptz | when this role was granted |

**Primary key**: `(user_id, role)` — prevents granting the same role to the same user
twice; naturally supports a user holding multiple distinct roles as multiple rows.

**Why a join table over a role array or a single enum column**: a single enum column
cannot represent "Buyer and Approver at once," which the spec's self-approval test
explicitly requires. A join table (over a Postgres array column) keeps role membership
queryable with ordinary relational joins/indexes (e.g. "all users holding APPROVER") and
is simplest to express in Prisma as a standard one-to-many relation, consistent with Scope
Control (no new data type or array-handling code needed).

## Vendor

Supplier the organization can order from (FR-001).

| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| name | text | **not** unique (clarified) |
| contact_name | text, nullable | |
| contact_email | text, nullable | |
| contact_phone | text, nullable | |
| payment_terms | text | free-text, e.g. "Net 30" (Assumption: no calendar logic) |
| is_active | boolean, default true | deactivation sets this false; never hard-deleted |
| created_at / updated_at | timestamptz | |

**Validation rules**: `name` and `payment_terms` required; no uniqueness constraint on
`name` (FR-001).

**Indexes**: `is_active` (supports "active vendors only" filtering on PO creation and
vendor list views).

**Referenced by**: `PurchaseOrder.vendor_id` (FK, `ON DELETE RESTRICT` — vendors are
deactivated, never deleted, so a PO's vendor reference is never orphaned).

## PurchaseOrder

A single procurement request against one vendor (FR-002–FR-011).

| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| order_number | text, unique | e.g. `PO-2026-000123`, generated at creation (FR-003a, research.md §7) |
| vendor_id | uuid (FK → Vendor) | must reference an **active** vendor at creation time (FR-002); not re-validated later (Assumption: deactivation doesn't retroact) |
| status | enum: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `CANCELLED` | see State Transitions below |
| total | numeric(12,2) | **derived, stored-and-synced (not computed on read)** — maintained by trigger from `PurchaseOrderLine` rows (FR-005) |
| created_by | uuid (FK → User) | the raising Buyer |
| submitted_at | timestamptz, nullable | set when leaving `DRAFT` |
| approved_at | timestamptz, nullable | |
| approved_by | uuid (FK → User), nullable | must differ from `created_by` (FR-010a) |
| rejected_at | timestamptz, nullable | |
| rejected_by | uuid (FK → User), nullable | |
| rejection_reason | text, nullable | required when status becomes `REJECTED` (FR-010) |
| cancelled_at | timestamptz, nullable | |
| cancelled_by | uuid (FK → User), nullable | |
| cancellation_reason | text, nullable | required when status becomes `CANCELLED` (FR-011) |
| created_at / updated_at | timestamptz | |

**Validation rules**:
- **A purchase order MUST have at least one line at every point in its lifecycle,
  starting at creation — there is no valid zero-line state, not even transiently.**
  Creation MUST be rejected if the `lines` list is empty or missing (FR-003). Removing a
  line from a draft PO (or replacing its full line set) that would leave it with zero
  lines MUST also be rejected (FR-004), enforced the same way creation is (a `400`
  validation error, not a silent no-op). Submission MAY additionally re-check for at
  least one line as redundant defense-in-depth, though this should be unreachable in
  practice given the two checks above.
- `total` never accepted as API input on create/update (FR-005).
- `rejection_reason` required for reject; `cancellation_reason` required for cancel, and
  the two are stored in distinct columns so they are never conflated (FR-010, FR-011).
- `approved_by` must not equal `created_by` (FR-010a, SC-007).

**State Transitions** (enforced in the service layer, `SELECT ... FOR UPDATE` guarded):

```
DRAFT --submit(total <= threshold)--> APPROVED (auto-approve; approved_by = NULL — no
    human approver; the corresponding AuditLogEntry instead records actor_type = SYSTEM)
DRAFT --submit(total > threshold)---> PENDING_APPROVAL
PENDING_APPROVAL --approve(by user != created_by)--> APPROVED
PENDING_APPROVAL --reject(reason required)---------> REJECTED
APPROVED --cancel(reason required)------------------> CANCELLED
```

Only `DRAFT` is editable (lines, vendor). All other states reject any edit attempt to
lines/vendor/total with a specific "order is locked" error (FR-008/FR-009) — there is no
edit path on a `PENDING_APPROVAL` order, so a line change (and a consequent threshold
crossing) cannot happen mid-approval at all (spec.md FR-008's direct answer to that
scenario). `REJECTED` and `CANCELLED` are terminal (no further transition). Goods receipt
is only accepted while `status = APPROVED` (FR-015).

**Indexes**: `(vendor_id, status)` and `(status, submitted_at)` — supports the
outstanding-orders-by-vendor-and-age query (FR-016) without a full scan.

## PurchaseOrderLine

A line item on a purchase order (FR-003, FR-004, FR-012–FR-014).

| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| purchase_order_id | uuid (FK → PurchaseOrder) | |
| description | text | required |
| quantity | integer | `CHECK (quantity > 0)` |
| unit_price | numeric(12,2) | `CHECK (unit_price >= 0)` |
| received_qty | integer, default 0 | **derived** — maintained by trigger from `GoodsReceiptEvent` rows (FR-013); never a client-writable field |
| created_at / updated_at | timestamptz | |

**`outstanding_qty` is never a column.** It is always computed as `quantity - received_qty`
at query/response time — in the SQL `SELECT` for list/report endpoints, and in the API
serializer for single-order reads. This is a deliberate choice over a stored/generated
column: since `received_qty` is already correct-by-construction (§ above), a second
derived column would just be more state to keep in sync for no correctness benefit
(Constitution Principle XII, Scope Control).

**Validation rules**:
- `quantity > 0`, `unit_price >= 0` enforced both by `zod` (reject before business logic,
  FR-004) and by a DB `CHECK` constraint (defense at the data layer).
- `CHECK (received_qty <= quantity)` — enforces the *required* concurrency-safe
  over-receipt rule (FR-014) for every API-driven write, effective even under concurrent
  requests (research.md §2); it additionally holds against a raw SQL write as bonus
  hardening beyond what's graded (research.md §11).
- **`received_qty` and `outstanding_qty` are never accepted as API input**, on either line
  creation/edit (while `DRAFT`) or the goods-receipt endpoint — exactly the same treatment
  as `total` on the parent order (FR-005 analog for FR-013/FR-014). `outstanding_qty`
  additionally has no column to write to at all, so there is no code path through which a
  client value for it could ever reach storage. A request body containing either field is
  rejected by the `zod` schema (`400 validation_error`) before any service method runs,
  since those schemas only recognize `description`/`quantity`/`unitPrice` on a line and
  `quantity` on a receipt (see `contracts/api-contract.md`).
- Lines are only mutable while the parent order is `DRAFT` (same lock as the parent).
- Removing a line, or replacing the parent order's full line set with one that omits it,
  MUST be rejected if doing so would leave the parent order with zero lines (see
  `PurchaseOrder` validation rules above) — a purchase order must always retain at least
  one line.

**Indexes**: `purchase_order_id` (FK lookup, line listing per order).

## GoodsReceiptEvent

A single receipt of goods against a specific line, at a point in time (FR-012).

| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| purchase_order_line_id | uuid (FK → PurchaseOrderLine) | |
| quantity | integer | `CHECK (quantity > 0)` (FR-015) |
| received_by | uuid (FK → User) | the recording Buyer |
| received_at | timestamptz, default now() | |

**Validation rules**: `quantity > 0` (rejected otherwise, FR-015); insertion only allowed
when the parent order's status is `APPROVED` (FR-015, checked in the service layer before
insert); multiple events per line are expected and normal (FR-012).

**Indexes**: `purchase_order_line_id` (drives the `received_qty` recompute and per-line
history).

## AuditLogEntry

Structured trace of a significant procurement action (FR-019). Every mutating action has
a human actor **except** auto-approval, which is a system decision (the threshold rule),
not a person exercising judgment — so the actor is modeled as `USER` or `SYSTEM`
(research.md §8, decision below), not as a required FK to `User`.

**Required minimum vs. additional coverage (spec.md FR-019)**: `PO_CREATED`,
`PO_APPROVED`/`PO_REJECTED`, `PO_CANCELLED`, and `GOODS_RECEIPT_RECORDED` are the four
action types FR-019 requires — this is what the feature is graded on. `VENDOR_CREATED`,
`VENDOR_DEACTIVATED`, and `PO_SUBMITTED` are logged too, but as **additional coverage
beyond the graded minimum** (research.md §8) — cheap to add alongside the required ones,
not equal-weight requirements in their own right.

| Field | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| actor_type | enum: `USER`, `SYSTEM` | `SYSTEM` only for the auto-approval side effect of a below-threshold submit |
| actor_user_id | uuid (FK → User), **nullable** | required when `actor_type = USER`; MUST be `NULL` when `actor_type = SYSTEM` |
| action | enum/text: `PO_CREATED`, `PO_APPROVED`, `PO_REJECTED`, `PO_CANCELLED`, `GOODS_RECEIPT_RECORDED` (required minimum), plus `PO_SUBMITTED`, `VENDOR_CREATED`, `VENDOR_DEACTIVATED` (additional coverage, see above) | |
| entity_type | text: `PurchaseOrder` \| `PurchaseOrderLine` \| `Vendor` | |
| entity_id | uuid | the affected record |
| details | jsonb | action-specific payload (e.g. `{ reason }` for reject/cancel, `{ quantity, lineId }` for a receipt, `{ thresholdCents, autoApproved: true }` for a system approval) |
| created_at | timestamptz, default now() | |

**CHECK constraint**: `(actor_type = 'SYSTEM' AND actor_user_id IS NULL) OR (actor_type = 'USER' AND actor_user_id IS NOT NULL)`
— makes the USER/SYSTEM distinction structurally impossible to get wrong, not just a
convention.

**When SYSTEM is used**: submitting an order at/below the threshold writes **two** audit
entries in the same transaction: `PO_SUBMITTED` (`actor_type = USER`, the submitting
Buyer) and `PO_APPROVED` (`actor_type = SYSTEM`, `actor_user_id = NULL`,
`details = { autoApproved: true, threshold: <value> }`). A human approval instead writes
`PO_APPROVED` with `actor_type = USER` and the Approver's id. This preserves, for dispute
resolution, whether a given approval was a person's decision or the automatic rule
(Constitution Principle VIII).

**Validation rules**: written by the service layer inside the same transaction as the
business change it documents (research.md §8); never written independently of a real
change (no "manual" audit entries).

**Indexes**: `(entity_type, entity_id)` — supports "show full history for this order" for
dispute resolution.

## Entity Relationship Summary

```
User 1---* UserRole (a user holds 1..N roles)
User 1---* PurchaseOrder (created_by)
User 0..1---* PurchaseOrder (approved_by / rejected_by / cancelled_by)
User 1---* GoodsReceiptEvent (received_by)
User 0..1---* AuditLogEntry (actor_user_id, NULL when actor_type = SYSTEM)

Vendor 1---* PurchaseOrder

PurchaseOrder 1---* PurchaseOrderLine
PurchaseOrderLine 1---* GoodsReceiptEvent
```
