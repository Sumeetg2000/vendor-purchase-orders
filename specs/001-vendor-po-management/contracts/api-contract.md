# API Contract: Vendor & Purchase Order Management

The spec leaves the API surface undefined ("design it however fits the workflow"). This
contract is the resulting design — a REST API over Express, JSON in/out, JWT bearer auth
on every route below except `POST /api/auth/login`. Chosen as plain markdown rather than a
formal OpenAPI document: for a solo 2-week POC (Constitution Principle XII, Scope Control),
a maintained spec-and-code pair of a full OpenAPI schema is more ceremony than the feature
needs, while this table is precise enough to write contract tests against.

**Conventions**:
- All money values are strings representing exact decimals (e.g. `"125.50"`), never JS
  floats, to match the `NUMERIC` storage (research.md §3).
- A user may hold more than one role (data-model.md's `UserRole`); every **Role** column
  below means "the caller's role set must include this role," not "the caller's only role
  is this." A caller with `["BUYER", "APPROVER"]` may call both Buyer-only and
  Approver-only routes — except where a specific rule additionally checks *identity*, not
  just role (see `POST .../approve` below, FR-010a).
- **Derived fields are never accepted as request input**: `total` (on a purchase order),
  and `receivedQty`/`outstandingQty` (on a line) do not appear in any request body schema
  below. If a client includes one anyway, the request is rejected the same way as any
  other unrecognized/invalid field — `400 validation_error` — before any service method
  runs (FR-005, FR-013, FR-014; data-model.md's `PurchaseOrderLine` validation rules).
- Validation failures → `400 { "error": "validation_error", "details": [...] }`.
- Business-rule failures → `409 { "error": "business_rule_violation", "reason": "..." }`
  (e.g. locked order, over-receipt, inactive vendor, self-approval, missing reason).
- Not found → `404 { "error": "not_found" }`. Unauthenticated → `401`. Wrong role → `403`.

## Auth

| Method | Path | Role | Body | Response |
|---|---|---|---|---|
| POST | `/api/auth/login` | none | `{ email, password }` | `200 { token, roles: string[] }` or `401` |

## Vendors

| Method | Path | Role | Body | Response |
|---|---|---|---|---|
| POST | `/api/vendors` | Buyer | `{ name, contactName?, contactEmail?, contactPhone?, paymentTerms }` | `201 Vendor` |
| GET | `/api/vendors` | any authenticated | query: `?active=true\|false` | `200 Vendor[]` |
| GET | `/api/vendors/:id` | any authenticated | — | `200 Vendor` or `404` |
| POST | `/api/vendors/:id/deactivate` | Buyer | — | `200 Vendor` (idempotent if already inactive) |

`Vendor` shape: `{ id, name, contactName, contactEmail, contactPhone, paymentTerms, isActive, createdAt }`.

## Purchase Orders

| Method | Path | Role | Body | Response |
|---|---|---|---|---|
| POST | `/api/purchase-orders` | Buyer | `{ vendorId, lines: [{ description, quantity, unitPrice }] }` — `lines` **required, non-empty** | `201 PurchaseOrder` (status `DRAFT`, `total` computed, `orderNumber` assigned); `400 validation_error` if `lines` is empty or missing — same error class as an invalid quantity/price (spec.md FR-003; no valid zero-line state exists) |
| GET | `/api/purchase-orders` | any authenticated | query: `?vendorId=&status=` | `200 PurchaseOrder[]` (paginated) |
| GET | `/api/purchase-orders/:id` | any authenticated | — | `200 PurchaseOrder` (with lines) or `404` |
| PATCH | `/api/purchase-orders/:id` | Buyer | `{ vendorId?, lines?: [{ description, quantity, unitPrice }] }` (full line replacement; each line accepts only these three fields — never `receivedQty`/`outstandingQty`) | `200 PurchaseOrder`, only while `DRAFT`; `409` otherwise (FR-009); **`400 validation_error` if a supplied `lines` array is empty** — a draft can never be edited down to zero lines (spec.md FR-004). There is no separate remove-single-line endpoint in this design; a line is "removed" by `PATCH`ing a `lines` array that omits it, so this same empty-array check is what rejects removing the last remaining line. |
| POST | `/api/purchase-orders/:id/submit` | Buyer | — | `200 PurchaseOrder` — status becomes `APPROVED` or `PENDING_APPROVAL` per threshold (FR-007); `409` if not `DRAFT`. A zero-line order should never reach this endpoint at all (creation and line-edits both reject going to zero lines, FR-003/FR-004); a zero-line check here is unreachable defense-in-depth, not a normal path. |
| POST | `/api/purchase-orders/:id/approve` | Approver | — | `200 PurchaseOrder` (status `APPROVED`); `409` if not `PENDING_APPROVAL`, **or if the caller's user id equals the order's `createdBy`** — checked by identity, not role, so a caller who holds both Buyer and Approver is still blocked from approving their own order (FR-010a) |
| POST | `/api/purchase-orders/:id/reject` | Approver | `{ reason }` | `200 PurchaseOrder` (status `REJECTED`); `400` if `reason` missing; `409` if not `PENDING_APPROVAL` |
| POST | `/api/purchase-orders/:id/cancel` | Approver | `{ reason }` | `200 PurchaseOrder` (status `CANCELLED`); `400` if `reason` missing; `409` if not `APPROVED` |
| GET | `/api/purchase-orders/:id/audit-log` | any authenticated | — | `200 AuditLogEntry[]` (chronological, for dispute resolution) |

`PurchaseOrder` shape: `{ id, orderNumber, vendorId, status, total, lines: [{ id, description, quantity, unitPrice, receivedQty, outstandingQty }], createdBy, submittedAt, approvedAt, approvedBy, rejectedAt, rejectedBy, rejectionReason, cancelledAt, cancelledBy, cancellationReason, createdAt, updatedAt }`.
`receivedQty` and `outstandingQty` on a line are **response-only** — computed at read
time (`outstandingQty = quantity - receivedQty`, never stored; data-model.md's
`PurchaseOrderLine`) — and are rejected if present in any request body.

## Goods Receipts

| Method | Path | Role | Body | Response |
|---|---|---|---|---|
| POST | `/api/purchase-orders/:id/lines/:lineId/receipts` | Buyer | `{ quantity }` — only `quantity`; `receivedQty`/`outstandingQty` are not accepted here either | `201 { id, quantity, receivedBy, receivedAt, line: { receivedQty, outstandingQty } }`; `409` if order not `APPROVED`, or if quantity would exceed outstanding (FR-014/FR-015) |
| GET | `/api/purchase-orders/:id/lines/:lineId/receipts` | any authenticated | — | `200 GoodsReceiptEvent[]` |

`AuditLogEntry` shape: `{ id, actorType: "USER" | "SYSTEM", actorUserId: string | null, action, entityType, entityId, details, createdAt }`. `actorUserId` is `null` if and only if
`actorType` is `"SYSTEM"` (an automatic below-threshold approval; data-model.md's
`AuditLogEntry`). `action` includes the four types FR-019 requires (`PO_CREATED`,
`PO_APPROVED`/`PO_REJECTED`, `PO_CANCELLED`, `GOODS_RECEIPT_RECORDED`) plus
`VENDOR_CREATED`/`VENDOR_DEACTIVATED`/`PO_SUBMITTED` as additional coverage beyond that
graded minimum (data-model.md's `AuditLogEntry`).

## Reporting

| Method | Path | Role | Query | Response |
|---|---|---|---|---|
| GET | `/api/reports/outstanding-orders` | Procurement Admin | `?vendorId=&minAgeDays=&maxAgeDays=&page=&pageSize=` (`pageSize` default/max 50) | `200 { items: [{ orderId, orderNumber, vendorId, vendorName, status, total, ageDays, outstandingLines: [...] }], total, page, pageSize }` |

**Exact filter (FR-016)**: `items` contains only orders where `status = "APPROVED"` **and**
at least one line has `receivedQty < quantity`. `DRAFT`, `PENDING_APPROVAL`, `REJECTED`,
and `CANCELLED` orders never appear — including a `CANCELLED` order that was partially
received before cancellation. Computed via one indexed SQL query (research.md §12), never
a full in-memory scan; a page (`pageSize` ≤ 50) MUST return in under 2 seconds at 10,000+
orders / 50,000+ lines (SC-004).

**`ageDays` reference point (explicit decision, research.md §13)**: `ageDays` is computed
as whole days elapsed since `submittedAt` — **not** since `approvedAt`. This is unambiguous
and unconditional: an order that sat in `PENDING_APPROVAL` for a week before being approved
shows the same age it would if it had auto-approved instantly, since both are measured from
submission. `minAgeDays`/`maxAgeDays` filter against this same `submittedAt`-based value.
