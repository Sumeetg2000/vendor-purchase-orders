# Feature Specification: Vendor & Purchase Order Management

**Feature Branch**: `001-vendor-po-management`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "Vendor and Purchase Orders — Feature Specification Input: a vendor list with contact and payment terms, purchase orders raised with line items whose total is always derived, an approval gate above a threshold amount, and goods receipt tracked against each order — including partial receipts — so outstanding orders by vendor and age are a real, trustworthy view. Center of gravity: derived-value integrity under editing (order total, outstanding quantity) must never drift from the numbers it is computed from, under any code path including direct API calls."

## Clarifications

### Session 2026-09-14

- Q: Does each purchase order need a unique, human-readable order number that users see and reference, or is an internal system ID sufficient? → A: Yes — every PO gets a unique, human-readable order number generated at creation.
- Q: Can the same user who raised a purchase order also approve it, or must the approver always be a different person from the buyer? → A: Must be different people — a user cannot approve a PO they raised themselves, even if they hold the Approver role.
- Q: Must vendor names be unique across the system, or can multiple vendor records share the same name? → A: Vendor names may repeat — uniqueness is not enforced; vendors are distinguished only by internal identifier.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Maintain a Trustworthy Vendor Directory (Priority: P1)

A Buyer maintains the list of vendors the organization can order from — name, contact
details, and payment terms (e.g. net 30) — and can deactivate a vendor that should no
longer receive new orders.

**Why this priority**: Every purchase order depends on referencing a real, active vendor.
Without a trustworthy vendor directory, the referential guarantee at the center of this
feature ("you cannot raise an order against a vendor that doesn't exist or has been
deactivated") has nothing to stand on.

**Independent Test**: Can be fully tested by creating, viewing, and deactivating a vendor
record, independent of any purchase order, and confirming a deactivated vendor can no
longer be referenced by new orders.

**Acceptance Scenarios**:

1. **Given** no vendor record exists for "Acme Supplies", **When** a Buyer creates one with
   contact details and payment terms, **Then** the vendor appears in the vendor list as
   active and available to reference on a purchase order.
2. **Given** an active vendor with existing purchase orders, **When** a Buyer deactivates
   that vendor, **Then** the vendor no longer appears as a valid choice for new purchase
   orders, while its existing purchase orders remain unaffected.
3. **Given** a vendor has been deactivated, **When** anyone attempts to raise a new
   purchase order against it (including via a direct API call), **Then** the request is
   rejected with a clear reason before any order is created.
4. **Given** an active vendor named "Acme Supplies" already exists, **When** a Buyer
   creates another vendor record with the same name, **Then** the new vendor is created
   successfully as a distinct record (duplicate names are permitted; vendors are
   distinguished only by internal identifier).

---

### User Story 2 - Raise a Purchase Order With a Guaranteed-Correct Total (Priority: P1)

A Buyer raises a purchase order against an active vendor, adding one or more line items
(description, quantity, unit price). The order's total is always exactly the sum of
quantity × unit price across its lines — it is never a number the Buyer (or any client)
enters directly.

**Why this priority**: This is the core problem the feature exists to solve: spreadsheet
totals that silently disagree with their own line items. A purchase order whose total
cannot be trusted has no value over the status quo.

**Independent Test**: Can be fully tested by creating a draft order with several lines,
confirming the displayed/stored total always equals the computed sum, and confirming that
no request — including one that tries to set the total field directly — can make the two
disagree.

**Acceptance Scenarios**:

1. **Given** an active vendor, **When** a Buyer raises a purchase order with two line items
   (e.g. 3 units at $10 and 2 units at $25), **Then** the order is created in draft state
   with a total of $80, computed from the lines, not supplied by the Buyer.
2. **Given** a draft purchase order, **When** a Buyer adds, removes, or edits a line item,
   **Then** the order's total is recalculated to match the new set of lines.
3. **Given** any request (via any client, including a direct API call) that attempts to
   create or update a purchase order with a total that does not equal the sum of its
   lines, **When** that request is submitted, **Then** it is rejected and no order is left
   in a mismatched state.
4. **Given** a draft purchase order with exactly one line item, **When** a Buyer attempts
   to remove that line (whether via a dedicated remove operation or a full line-set
   replacement that omits it), **Then** the request is rejected and the order retains its
   one existing line — a purchase order must never be left with zero lines, even
   transiently on an existing draft.
5. **Given** a line item with a negative or zero quantity, or a negative unit price,
   **When** it is submitted as part of a purchase order, **Then** the request is rejected
   before any order or line is created or modified.
6. **Given** an active vendor, **When** a Buyer attempts to create a purchase order with no
   line items at all (an empty or missing `lines` list), **Then** the request is rejected
   before any order is created — a purchase order MUST have at least one line item from
   the moment it exists; there is no valid empty-draft state, not even as a starting point
   for adding lines incrementally.

---

### User Story 3 - Approve, Lock, and Cancel Purchase Orders (Priority: P2)

Once a Buyer submits a draft purchase order, it leaves the draft state: orders at or below
a configured threshold amount auto-approve immediately, and orders above the threshold
enter a pending-approval state until an Approver approves them. From the moment of
submission, the order's lines, vendor, and total are locked. An Approver can cancel an
approved order, but only by providing a reason, and cancellation is recorded distinctly
from an edit.

**Why this priority**: Approval is the control point where financial authority is
exercised. It matters immediately after ordering integrity (P1) because an order that can
still be edited after submission or approval makes the approval meaningless.

**Independent Test**: Can be fully tested by submitting an order below the threshold and
confirming it auto-approves, submitting one above the threshold and confirming it requires
an Approver action, and then confirming that no edit endpoint can alter a submitted
order's lines, vendor, or total regardless of its approval state.

**Acceptance Scenarios**:

1. **Given** a draft purchase order with a total at or below the configured threshold,
   **When** the Buyer submits it, **Then** it is automatically approved with no manual
   approval step, and it is immediately locked against edits.
2. **Given** a draft purchase order with a total above the configured threshold, **When**
   the Buyer submits it, **Then** it enters a pending-approval state, is immediately
   locked against edits, and awaits an Approver's decision.
3. **Given** an order pending approval, **When** an Approver approves it, **Then** the
   order becomes approved and remains locked; **When** an Approver rejects it with a
   stated reason, **Then** the order is recorded as rejected with that reason and does not
   proceed to goods receipt.
4. **Given** an order pending approval, **When** an Approver attempts to reject it without
   providing a reason, **Then** the rejection is refused and the order remains pending
   approval.
5. **Given** a submitted order (pending approval or already approved), **When** any client
   — including a direct API call — attempts to modify its lines, vendor, or total,
   **Then** the request is rejected with a specific, actionable error identifying that the
   order is locked, and nothing is changed.
6. **Given** an approved purchase order, **When** an Approver cancels it with a stated
   reason, **Then** the order is marked cancelled, the reason is recorded, and the
   cancellation is distinguishable in the order's history from a draft edit.
7. **Given** an approved purchase order, **When** an Approver attempts to cancel it
   without providing a reason, **Then** the cancellation is rejected.
8. **Given** a purchase order pending approval, **When** the same user who raised that
   order (even if they also hold the Approver role) attempts to approve it, **Then** the
   approval is rejected because the approver must be a different person from the buyer
   who raised the order.

---

### User Story 4 - Record Goods Receipts Against an Order (Priority: P2)

A Buyer records goods received against an approved purchase order, per line item. Receipts
can be partial and can happen across multiple separate events over time. The outstanding
quantity for each line is always exactly the ordered quantity minus the sum of everything
received against it, and a receipt can never push the received total above what was
ordered.

**Why this priority**: This closes the loop the feature is built for — knowing what is
still outstanding. It depends on P1 (an order with a trustworthy total and lines) and P2
approval/locking, since only a locked, approved order should be receivable against.

**Independent Test**: Can be fully tested by recording two or more partial receipts
against a single line and confirming the outstanding quantity always reflects exactly what
remains, and confirming an over-receipt attempt is rejected every time, including when two
receipt requests for the same line are submitted at the same time.

**Acceptance Scenarios**:

1. **Given** an approved order line for 10 units, **When** a Buyer records a receipt of 4
   units, **Then** the line shows 4 received and 6 outstanding.
2. **Given** the same line now at 4 received, **When** a Buyer records a second receipt of
   6 units, **Then** the line shows 10 received and 0 outstanding.
3. **Given** a line with 6 units outstanding, **When** a Buyer attempts to record a receipt
   of 7 units, **Then** the request is rejected and the recorded received quantity is
   unchanged.
4. **Given** a line with 6 units outstanding, **When** two receipt requests for 4 and 3
   units are submitted at effectively the same time, **Then** at most one of them succeeds
   (whichever the outstanding quantity permits) and the other is rejected — the line's
   received quantity never exceeds the ordered quantity.
5. **Given** a purchase order that has been cancelled, **When** anyone attempts to record a
   goods receipt against it, **Then** the request is rejected.

---

### User Story 5 - View Outstanding Orders by Vendor and Age (Priority: P3)

A Procurement Admin views purchase orders that are **Approved** but not yet fully received
(Draft, Pending Approval, Rejected, and Cancelled orders never count as "outstanding," even
a Cancelled order that was partially received before cancellation — see FR-016), filterable
or groupable by vendor, with visibility into how long each has been outstanding.

**Why this priority**: This is the payoff view described in the background — "nobody can
say with confidence what's still outstanding against a given vendor" — but it is a
read-only reporting capability that depends on P1–P2 data existing first, so it is lower
priority than the integrity guarantees it reports on.

**Independent Test**: Can be fully tested by creating orders in every status (Draft,
Pending Approval, Approved, Rejected, Cancelled) with varying receipt states and ages
across multiple vendors, then confirming the view returns exactly the Approved-and-not-
fully-received ones (per FR-016's precise scope), correctly grouped/filtered by vendor and
showing accurate age, without requiring any other feature to be exercised first.

**Acceptance Scenarios**:

1. **Given** a mix of Approved orders (some fully received, some partially received, some
   unreceived) plus Draft, Pending Approval, Rejected, and Cancelled orders across several
   vendors, **When** a Procurement Admin requests outstanding orders, **Then** only
   Approved orders with at least one line not yet fully received are returned — every
   Draft, Pending Approval, Rejected, and Cancelled order is excluded, and every fully
   received Approved order is excluded.
2. **Given** outstanding orders across multiple vendors, **When** a Procurement Admin
   filters by a specific vendor, **Then** only that vendor's outstanding orders are
   returned.
3. **Given** outstanding orders of varying ages, **When** a Procurement Admin views the
   list, **Then** each order shows an age consistent with the time since it was submitted.
4. **Given** a dataset of many thousands of orders, **When** a Procurement Admin requests
   the outstanding-orders view, **Then** the result is produced without the system loading
   every order and line into memory to compute it, and a single paginated page (50 rows)
   is returned in under 2 seconds at 10,000+ orders / 50,000+ lines (SC-004).
5. **Given** an Approved order that was partially received and then cancelled, **When** a
   Procurement Admin requests outstanding orders, **Then** that order does not appear —
   cancellation ends the outstanding obligation regardless of how much was received
   beforehand.

---

### Edge Cases

- Submitting a purchase order whose total exactly equals the configured approval
  threshold: the order auto-approves (threshold is inclusive of "at or below").
- Attempting to approve, reject, or cancel an order that is still in draft state (never
  submitted): rejected, since only submitted orders have an approval/cancellation
  lifecycle.
- Attempting to approve an order that has already been approved, rejected, or cancelled:
  rejected as an invalid state transition.
- Attempting to record a goods receipt of zero or negative quantity: rejected.
- Attempting to record a goods receipt against an order that is still pending approval
  (not yet approved): rejected, since receipt only applies to approved orders.
- A vendor is deactivated while it still has orders pending approval or approved but not
  fully received: those existing orders are unaffected and continue through approval and
  receipt normally; only new orders against that vendor are blocked.
- Two concurrent requests both attempt to approve the same pending order: only one
  approval decision is recorded; the other is rejected as the order is no longer pending.
- A user who raised a purchase order also holds the Approver role and attempts to approve
  that same order: rejected, since the approver must be a different person from the buyer
  who raised it.
- **A line item is added or changed while an order is mid-approval (Pending Approval) and
  the total would consequently cross the threshold**: this cannot occur. FR-008 locks an
  order's lines, vendor, and total the instant it leaves Draft, so there is no edit path
  on a Pending Approval order — a line change cannot happen while an order is mid-approval
  at all, and therefore the total can never cross the threshold after submission. Any code
  path that allowed this would be a bug against FR-008/FR-009, not intended behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST maintain a vendor directory recording, at minimum, each
  vendor's name, payment terms, and an active/inactive status, with optional contact
  details (contact name, email, phone). Vendor names are not required to be unique — the
  system distinguishes vendor records solely by their internal identifier, and duplicate
  names are permitted.
- **FR-002**: The system MUST reject creation of a purchase order that references a vendor
  that does not exist or is inactive, before any order record is created.
- **FR-003**: The system MUST allow a purchase order to be created in a draft state, and
  MUST require **at least one line item** (description, quantity, unit price) at the
  moment of creation. A creation request with an empty or missing `lines` list MUST be
  rejected with the same error class as any other invalid input (e.g. a negative
  quantity) before any order record is created. There is no valid zero-line state — not
  at creation, and not transiently while editing an existing draft (see FR-004).
- **FR-003a**: The system MUST generate a unique, human-readable order number for each
  purchase order at creation (e.g. `PO-2026-000123`), which users can reference instead of
  the internal identifier.
- **FR-004**: The system MUST reject a purchase order line item with a non-positive
  quantity or a negative unit price before any business logic is applied. The system MUST
  also reject any edit to an existing draft's lines — including removing a line, or
  replacing the full line set — that would leave the order with zero line items; this,
  together with FR-003, means a purchase order always has at least one line at every point
  in its lifecycle. Submission-time re-validation of "at least one line" MAY additionally
  be kept as redundant defense-in-depth, since a correctly enforced order should never
  reach submission with zero lines in the first place — but FR-003/this rule, not the
  submission check, are the load-bearing enforcement.
- **FR-005**: The system MUST compute a purchase order's total exclusively from its line
  items (sum of quantity × unit price), and MUST NOT allow the total to be supplied or
  altered independently of its lines through any code path, including direct API requests.
- **FR-006**: The system MUST allow a draft purchase order's vendor, lines, and quantities/
  prices to be edited, recomputing the total accordingly, for as long as the order remains
  in draft state.
- **FR-007**: A new purchase order is always created in **Draft** state, regardless of its
  total — draft orders are never evaluated against the threshold. The system MUST support
  a configurable approval threshold amount, and the choice between auto-approval and
  pending-approval is decided **only** at the moment of explicit submission, based on the
  order's total at that moment: when a purchase order is submitted (leaves draft state),
  the system MUST auto-approve it immediately if its total is at or below the threshold,
  and MUST place it into a pending-approval state if its total is above the threshold.
- **FR-008**: The system MUST lock a purchase order's lines, vendor, and total against any
  further edits at the moment it leaves draft state (upon submission), regardless of
  whether it is auto-approved or pending approval, and MUST continue to enforce this lock
  once the order is approved. **Direct answer to "what if a line changes total while
  mid-approval"**: this cannot happen. Because the lock applies the instant an order
  leaves Draft — before it can ever be Pending Approval — there is no edit path on a
  Pending Approval order at all. A line item cannot be added or changed while an order is
  mid-approval, so the total cannot cross the threshold after submission; the threshold
  decision (FR-007) is made exactly once, at submission, and is never re-evaluated
  afterward. If any implementation is ever found to allow editing a line on a Pending
  Approval order, that is a bug against this requirement, not an alternate intended
  behavior.
- **FR-009**: The system MUST reject any request — including a direct API request — that
  attempts to modify the lines, vendor, or total of a submitted (pending-approval,
  approved, or cancelled) purchase order, and MUST return a specific error identifying
  that the order is locked rather than a silent no-op or a generic failure.
- **FR-010**: The system MUST allow an Approver to approve or reject a purchase order that
  is pending approval, and MUST reject attempts to approve/reject/cancel an order that is
  not in a state where that action is valid (e.g. still draft, or already decided).
  Rejecting a pending order MUST require a reason, recorded distinctly from a cancellation
  reason (FR-011).
- **FR-010a**: The system MUST reject an approval attempt where the approving user is the
  same user who raised (submitted) the purchase order, regardless of what role(s) that
  user holds — the approver must always be a different person from the buyer.
- **FR-011**: The system MUST allow an Approver to cancel an approved purchase order only
  when a reason is supplied, and MUST record the cancellation as an action distinct from
  an edit.
- **FR-012**: The system MUST allow goods receipts to be recorded against individual lines
  of an approved purchase order, supporting partial quantities and multiple receipt events
  over time per line.
- **FR-013**: The system MUST derive each line's outstanding quantity exclusively from its
  ordered quantity minus the sum of all receipts recorded against it, and MUST NOT allow
  outstanding quantity to be set or altered independently of the underlying receipts
  through any code path.
- **FR-014**: The system MUST reject any goods receipt (including concurrent, simultaneous
  receipt attempts on the same line) that would cause the total received quantity for a
  line to exceed its ordered quantity, and MUST guarantee this even when multiple receipt
  requests race against each other.
- **FR-015**: The system MUST reject a goods receipt with a non-positive quantity, and
  MUST reject a goods receipt against an order that is not approved (e.g. draft, pending
  approval, rejected, or cancelled).
- **FR-016**: The system MUST provide a view of outstanding purchase orders, precisely
  defined as: orders with status **Approved** where at least one line's received quantity
  is less than its ordered quantity. Orders in **Draft** or **Pending Approval** status
  MUST NEVER appear (they are not yet a confirmed vendor commitment — a pending order might
  still be rejected, so nothing is yet "outstanding" against the vendor). Orders in
  **Rejected** or **Cancelled** status MUST NEVER appear, even if some quantity was
  received before cancellation — once an order is rejected or cancelled, the organization
  no longer expects the remaining goods, so it is no longer outstanding. This view MUST be
  filterable or groupable by vendor, MUST report each order's age (time elapsed since it
  was submitted), and MUST be computed and filtered using database-side querying rather
  than loading all orders and lines into application memory.
- **FR-017**: The system MUST require every business action (vendor management, raising an
  order, approving, cancelling, recording a receipt, viewing outstanding orders) to be
  performed by an authenticated user; no action is available anonymously.
- **FR-018**: The system MUST enforce that only users holding the appropriate role may
  perform an action: raising orders and recording receipts require the Buyer role;
  approving and cancelling orders require the Approver role; viewing outstanding orders
  by vendor and age requires the Procurement Admin role. A user MAY hold more than one
  role at once; role-based access is checked per action against the set of roles the
  acting user holds, not against a single assumed role. Enforcement MUST occur on the
  backend regardless of client.
- **FR-019**: The system MUST produce a structured, queryable audit record for each
  purchase order creation, each approval decision (approve/reject), each cancellation, and
  each goods receipt event, identifying the acting user, the action, the affected order
  (and line, where applicable), and the time it occurred. **This is the required minimum**
  — these four action types are the ones this feature is graded on. The design additionally
  produces audit records for vendor creation, vendor deactivation, and purchase order
  submission, since they were cheap to add alongside the required ones and preserve a more
  complete history — but these three are **additional audit coverage beyond the graded
  minimum**, not equal-weight requirements; their absence would not fail this requirement.

### Key Entities

- **Vendor**: A supplier the organization can order from. Attributes include name, contact
  details, payment terms, and active/inactive status. Referenced by purchase orders.
  Distinguished only by internal identifier; names are not required to be unique.
- **Purchase Order**: A single procurement request against one vendor. Attributes include
  a unique, human-readable order number, its vendor reference, status (draft, pending
  approval, approved, rejected, cancelled), its derived total, and submission/approval/
  cancellation timestamps and reasons where applicable. Contains one or more purchase
  order lines.
- **Purchase Order Line**: A single line item on a purchase order — description,
  quantity, unit price — plus its derived outstanding quantity based on the goods receipt
  events recorded against it.
- **Goods Receipt Event**: A record of goods received against a specific purchase order
  line at a point in time, including the quantity received and who recorded it. Multiple
  events may exist per line.
- **Audit Record**: A structured trace of a significant procurement action (order
  creation, approval decision, cancellation, goods receipt), identifying the actor, the
  action, the target order/line, and the timestamp/details, used to resolve disputes.
- **User**: An authenticated actor holding one or more of the roles Buyer, Approver, or
  Procurement Admin — a user may hold more than one role simultaneously (this is required
  for the approval segregation-of-duties rule to be meaningfully testable: a user who
  holds both Buyer and Approver must still be blocked from approving their own order, see
  FR-010a). Used to enforce authorization on every action above.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of attempts — across every tested code path, including direct API
  calls that bypass normal flow — to leave a purchase order with a stored total that does
  not equal the sum of its line items are rejected.
- **SC-002**: 100% of attempts — including concurrent, simultaneous attempts — to record
  goods receipts that would cause a line's received quantity to exceed its ordered
  quantity are rejected, with the line's outstanding quantity remaining accurate.
- **SC-003**: 100% of attempts to modify the lines, vendor, or total of a purchase order
  that has left draft state are rejected with a specific, identifiable error rather than a
  silent no-op or a generic failure.
- **SC-004**: The outstanding-orders-by-vendor-and-age view returns a paginated page of
  results (50 rows) in under 2 seconds when the dataset contains at least 10,000 purchase
  orders and 50,000 line items, using database-side filtering, grouping, and pagination —
  not a full scan of every order and line loaded into memory.
- **SC-005**: 100% of purchase order creations, approval decisions, cancellations, and
  goods receipt events produce a structured audit record sufficient to identify who did
  what, to which order, and when.
- **SC-006**: 0% of business actions (raising an order, approving, cancelling, recording a
  receipt, viewing outstanding orders) can be completed without a valid authenticated
  identity, and 0% succeed when attempted by a user whose role does not permit that
  action.
- **SC-007**: 100% of attempts by a user to approve a purchase order they themselves raised
  are rejected, even when that user holds the Approver role.

## Assumptions

- The approval threshold amount is a configurable value rather than a fixed number in this
  specification; its exact default is a planning-phase decision.
- **"Age" decision (the rubric explicitly offers a choice here — time since raised, or
  time since approval — and requires it to be documented)**: age is measured as time
  elapsed **since the order was submitted** (left draft state), not since it was approved.
  This applies uniformly to auto-approved orders (where submission and approval are
  effectively simultaneous) and to orders that sat in Pending Approval for a while before
  a human Approver acted. Reasoning: "since submission" is more consistent with what
  Procurement Admin actually needs from this view — the total time an order has been open
  against the vendor, including any time spent waiting for approval. "Since approval"
  would understate the age of an order that took a week to get approved, hiding exactly
  the kind of delay a Procurement Admin should see. (Rejected alternative: "since
  approval" — would reset the clock at approval time and mask approval-wait time, which is
  itself an operationally relevant delay this view should surface, not hide.)
- Payment terms are recorded as a descriptive value (e.g. "Net 30") without this
  specification mandating any calendar/due-date computation logic in this POC.
- A rejected (not approved) purchase order is treated as terminal for that submission
  attempt in this POC; re-submission as a new draft, rather than resurrecting the rejected
  order, is the assumed path, since no re-submission workflow was described.
- Standard authenticated-session or token-based identity is assumed for "a real,
  authenticated user"; the specific authentication mechanism is a planning-phase decision.
- The system is expected to be startable from a clean environment via a single
  containerized command with configuration through a documented environment file, and no
  additional manual setup steps, consistent with this being a self-contained POC.
- Deactivating a vendor does not retroactively affect purchase orders already raised
  against it; it only prevents that vendor from being referenced by new orders.
- A purchase order always has at least one line item at every point in its lifecycle,
  starting immediately upon creation — there is no valid empty-draft state. This applies
  uniformly to creation and to any later edit (including line removal) on an existing
  draft (FR-003/FR-004; constitution.md Principle II, "A PO MUST contain one or more
  lines," which has no draft-state exception).
- A user may hold more than one role at once (e.g. both Buyer and Approver); role checks
  are per-action against the set of roles a user holds, not a single assumed role — this
  is required for the approval segregation-of-duties rule (FR-010a) to be a meaningful,
  testable check rather than one that's vacuously true because roles never overlap.
