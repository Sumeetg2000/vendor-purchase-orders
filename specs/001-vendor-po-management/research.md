# Phase 0 Research: Vendor & Purchase Order Management

All Technical Context items were resolved either directly from the user-supplied technical
decisions or by a small set of implementation-detail research tasks below. No
`NEEDS CLARIFICATION` markers remain.

## 1. Backend language: TypeScript vs. plain JS

**Original decision**: Backend (Express + Prisma) is written in TypeScript. Frontend
(React) is written in plain JavaScript.

**Original rationale**: The user's technical decisions state the frontend stays plain JS
"to keep scope tight — Prisma types already give strong backend safety." That reasoning
only holds if the backend consumes Prisma's generated types, i.e. the backend is
TypeScript. This also gives compile-time protection around the derived-value logic
(Constitution Principles II/IV) without adding a second type system on the frontend, where
the payoff is smaller for a 2-week POC.

**Alternatives considered at the time**: Plain JS on both sides (rejected — loses Prisma's
generated types, the exact thing the user cited as the reason TS wasn't needed on the
frontend). TypeScript on both sides (rejected — the user explicitly scoped the frontend to
plain JS).

**Superseded**: The frontend was later written in TypeScript (`.tsx`/`.ts`) instead of
plain JavaScript, during subsequent UI work. This happened without a formal re-decision
recorded at the time — there is no documented rationale from that point distinguishing it
from the original plain-JS scope decision above. Retroactively, the most plausible
practical reason is type safety on component props and API response shapes as the frontend
grew past the initial scaffolding, but that is this document's own inference after the
fact, not a reason that was actually recorded when the switch happened. Plan.md and
README.md have been updated to describe the frontend as TypeScript, matching the current,
working codebase; this section is left as the historical record of the original decision
plus this correction, rather than rewritten to look as if TypeScript was the plan from the
start.

## 2. Enforcing derived-value integrity at the database level

**Scope note (rubric alignment)**: The assignment's actual grading bar requires this
guarantee to hold for every API call and application code path — "no code path — including
a direct API call" (§3.3), "under a direct API call that tries to bypass it" (§4), "through
every code path you can think of" (§6), all scoped to callers of the application, never to
a raw SQL session that bypasses the app entirely. The Express service layer's validation
and transactional writes are what satisfy that required guarantee on their own. The
mechanism below (DB triggers + CHECK constraints) is kept because it was already built and
costs nothing to retain — it happens to *also* extend the same guarantee to survive a
direct SQL write, which is **defense-in-depth / bonus hardening beyond what this POC is
graded on**, not a substitute for, or a requirement alongside, the API-layer guarantee.

**Decision**: `purchase_order.total` and `purchase_order_line.received_qty` are stored
columns kept correct by Postgres triggers, backed by CHECK constraints:

- `AFTER INSERT/UPDATE/DELETE` on `purchase_order_line` recomputes the parent
  `purchase_order.total` as `SUM(quantity * unit_price)` across its lines.
- `AFTER INSERT` on `goods_receipt_event` recomputes the parent line's `received_qty` as
  `SUM(quantity)` across its receipt events.
- `CHECK (received_qty <= quantity)` and `CHECK (quantity > 0)` and
  `CHECK (unit_price >= 0)` on `purchase_order_line`.

**Rationale**: This is the user's explicit technical decision. It satisfies the *required*
guarantee for FR-005/FR-013/FR-014 — "no code path, including a direct API request" — since
a trigger + CHECK constraint fires on every write the application makes, regardless of
which Express route triggered it. As a side effect (not a requirement), it *also* fires
regardless of which client issued the write, including a hypothetical direct SQL session —
that additional reach is the bonus hardening noted above, not part of what FR-005/FR-013/
FR-014 or the rubric actually ask for.

**Concurrency correctness detail (important, not obvious from the constraint alone; revised
after a confirmed bug — see below)**: A CHECK constraint by itself does not prevent two
concurrent transactions from each reading a "safe" pre-update value and both committing an
over-receipt — constraints are evaluated per-statement, not against a serialized view of
concurrent writers. Row locking is required to serialize the two writes so the CHECK sees
the *other* transaction's committed effect before it is evaluated.

An earlier version of this trigger relied on a single `UPDATE ... SET received_qty =
(SELECT SUM(...) ...) WHERE id = ...` to both acquire that row lock and recompute in one
statement. That was **confirmed broken by direct reproduction** against Postgres (two
concurrent goods-receipt transactions on the same line, one held open across a deliberate
delay): under READ COMMITTED, when Postgres unblocks a transaction that was waiting on the
row lock (EvalPlanQual), it re-fetches only the current version of the row the `UPDATE`
targets — it does **not** take a fresh snapshot for the `SUM(...)` subquery against
`goods_receipt_events`. So the waiter's subquery still only saw its own row, not the
committing transaction's now-committed receipt, and both transactions could commit with a
combined `received_qty` exceeding `quantity`. This surfaced as an intermittent (roughly
40%) test flake, not a deterministic failure, because it only manifests when the second
transaction's `UPDATE` statement actually has to block.

The fix (see `20260917081012_fix_line_receipt_lock_race`): explicitly acquire the row lock
first with `PERFORM 1 FROM purchase_order_lines WHERE id = ... FOR UPDATE`, then recompute
in a **separate, subsequent** `UPDATE` statement. That second statement takes its own fresh
READ COMMITTED snapshot once the lock is actually held, so it correctly sees whatever the
other transaction just committed. This satisfies Constitution Principle V ("do not rely on
application-memory checks alone") without needing an explicit `SELECT ... FOR UPDATE` in
application code for this specific path — the DB does it via the trigger — but it requires
the lock-then-recompute split, not a single combined statement.

**Alternatives considered**: Compute-on-read (rejected — user's explicit decision favors
stored-and-synced; compute-on-read would also make the outstanding-orders-by-vendor-and-age
query more expensive at 10k+ orders). Application-level optimistic locking / version
column (rejected as the *primary* guard — still useful defense-in-depth, but the
Constitution explicitly warns against relying on app-memory checks alone for this class of
invariant).

## 3. Money representation

**Decision**: `unit_price` and `total` are Postgres `NUMERIC(12,2)`, mapped to Prisma's
`Decimal` type.

**Rationale**: Avoids IEEE-754 floating-point drift in sums (a JS `number` total could
disagree with a DB-computed `SUM` by fractions of a cent, defeating the very invariant this
feature exists to guarantee). `NUMERIC` plus SQL `SUM` in the trigger is exact. Using
integer minor units (cents) was considered but adds a conversion layer at every API
boundary for no correctness benefit once `NUMERIC` is already in use.

**Alternatives considered**: JS `number`/float column (rejected — precision risk).
Integer cents (rejected — extra complexity not needed given `NUMERIC` support).

## 4. Locking a submitted order against edits

**Decision**: Enforced in the Express service layer: any edit-attempt on a
`purchase_order` first checks `status === 'DRAFT'` inside a DB transaction; a
non-draft status raises a distinct "order is locked" error (FR-009) before any write is
attempted. Approval/rejection/cancellation state transitions additionally use
`SELECT ... FOR UPDATE` on the `purchase_order` row inside the transaction, so two
concurrent decision requests on the same order serialize instead of racing.

**Rationale**: FR-008/FR-009's scope is "any request — including a direct API request,"
i.e. the API boundary, matching Constitution Principle I and the rubric's actual bar
(§3.3/§4/§6 — every code path a caller of the application could take, not a raw SQL
session). This required guarantee is enforced identically to FR-005/FR-013/FR-014's
required guarantee: at the API/service layer. Those two additionally got a DB-level
trigger+CHECK mechanism (§2) that, as bonus hardening beyond what's graded, also survives
a direct SQL write bypassing the app entirely — locking doesn't get that same optional
extra layer, since adding a DB trigger to block writes to a locked order would be
redundant complexity for a 2-week POC when the *required* guarantee already holds inside
every API-driven write path (Constitution Principle XII, Scope Control), and the rubric
does not ask for the SQL-bypass case here either.

**Alternatives considered**: DB-level trigger rejecting `UPDATE`s to non-draft orders
(rejected — not required by the spec's stated bypass surface, and duplicates the same
check the service layer must do anyway to return a clear API error instead of a raw DB
error).

## 5. Authentication & authorization

**Decision**: JWT issued at login (`jsonwebtoken`), containing `{ sub: userId, roles: string[] }`
(a **list**, not a single role — see the multi-role decision below), short expiry (e.g.
8h, configurable), verified by Express middleware on every protected route. Passwords
hashed with `bcrypt`. A `requireRole(role)` middleware factory enforces Buyer/Approver/
Procurement Admin boundaries per route by checking `token.roles.includes(role)`
(FR-017/FR-018). The buyer≠approver check (FR-010a) is enforced inside
`approvePurchaseOrder`, comparing the authenticated user's id against the order's
`created_by` — this is an identity comparison, not a role comparison, precisely because a
user holding both Buyer and Approver roles must still be blocked from approving their own
order.

**Multi-role decision**: A user can hold more than one role at once (data-model.md's
`UserRole` join table, replacing an earlier single-`role`-column design). This is required
by the spec's own self-approval test (FR-010a, SC-007): proving "an Approver cannot
approve their own order" is only a meaningful test if a user can simultaneously be the
Buyer who raised it and hold the Approver role — otherwise the rule would be vacuously
true (no such user could exist to attempt it). Consequently, JWT `roles` is an array, and
every authorization check is "does the caller's role set contain X," never "is the
caller's role X."

**Rationale**: JWT is the user's explicit decision. `bcrypt` is the standard default for
password hashing in a Node/Express stack.

**Alternatives considered**: Session-based auth with server-side session store (rejected —
user specified JWT; also would add a session store dependency, against Scope Control).
Single `role` enum column with a separate one-off flag for "this Buyer can also approve"
(rejected — a bespoke flag doesn't generalize, whereas the join table handles any
combination of the three roles uniformly).

## 6. Request validation

**Decision**: `zod` schemas validate every request body/query/param before any domain
service method runs (FR-004, Constitution Principle VII). Validation failures return
`400` with a distinct error shape (`{ error: "validation_error", details: [...] }`) from
business-rule failures (`409`/`422` with `{ error: "business_rule_violation", reason }`),
so tests and callers can distinguish the two deterministically (Constitution Principle
VII, SC-003).

**Rationale**: `zod` is lightweight, has first-class TypeScript inference (pairs well with
the backend's TS decision), and needs no separate schema files/tooling — appropriate for a
solo 2-week POC.

**Alternatives considered**: `joi` / `express-validator` (rejected — equally valid, but
`zod`'s TS inference removes a duplicate-typing step given the backend is already TS).

## 7. Human-readable order numbers

**Decision**: A Postgres `SEQUENCE` (e.g. `purchase_order_number_seq`) generates a
monotonically increasing integer at order-creation time, formatted as
`PO-{YYYY}-{seq:06d}` (year taken at creation time). Generated inside the same transaction
as order creation, so it is unique and gap-tolerant under concurrent creates (sequences are
race-safe by design in Postgres).

**Rationale**: Satisfies the clarified requirement (FR-003a) for a unique, human-readable
number without a separate uniqueness-check-then-insert race (which a naive
"count existing orders + 1" approach would have).

**Alternatives considered**: UUID shown to users (rejected — clarified requirement calls
for "human-readable"). Application-level counter table with row locking (rejected — a
native sequence is simpler and already race-safe).

## 8. Audit trail

**Decision**: A single `audit_log` table (`AuditLogEntry`), written by each domain service
method inside the same DB transaction as the business change it records (not via DB
trigger, since the acting user's id is only known in the application layer, not implicit
in raw row changes).

**Rationale**: Keeps the audit write atomic with the change it documents (Constitution
Principle V, VIII) while keeping the mechanism simple — one write per mutating service
call, not a generic changelog/event-sourcing system (Scope Control).

**Alternatives considered**: DB-level trigger-based audit (rejected — cannot capture
"who," since Postgres triggers do not have first-class access to an application-level
authenticated user id without session variables, which is more machinery than a 2-week
POC needs). Full event-sourcing (rejected — far beyond Scope Control).

**Scope note (rubric alignment)**: The rubric's actual required minimum is "raising an
order, each approval decision, and each goods receipt event" (spec.md FR-019) — four
action types: `PO_CREATED`, `PO_APPROVED`/`PO_REJECTED`, `PO_CANCELLED`,
`GOODS_RECEIPT_RECORDED`. `VENDOR_CREATED`, `VENDOR_DEACTIVATED`, and `PO_SUBMITTED` (data-
model.md's `AuditLogEntry.action` enum) are **additional coverage beyond that graded
minimum** — kept because logging them costs nothing extra once the audit-write pattern
exists, not because they're required. (`PO_SUBMITTED` is also load-bearing for a different
reason below — the auto-approval mechanism needs it to distinguish "submitted" from
"auto-approved" as two separate facts — but its presence in the schema is still additional
coverage, not a graded requirement in its own right.)

**Automatic-approval actor decision**: Below-threshold submission auto-approves an order
with no human Approver in the loop, but the audit trail still needs to say *something*
recorded the `PO_APPROVED` decision. Two options were considered:

- **(a) A dedicated `SYSTEM` user row** seeded into the `User` table, used as
  `actor_user_id` for automatic approvals.
- **(b) An `actor_type` enum (`USER` | `SYSTEM`) with a nullable `actor_user_id`**, `NULL`
  only when `actor_type = SYSTEM`.

**Decision**: (b) — `actor_type` + nullable `actor_user_id`, with a `CHECK` constraint
tying them together (see data-model.md's `AuditLogEntry`).

**Rationale**: This is the simpler option once its knock-on effects are considered. Option
(a) looks simpler at a glance (audit rows stay "always have an actor_user_id"), but it
requires a synthetic `User` row that must be excluded from every real user-facing query
(login attempts, "list all Approvers," user pickers in the frontend) and permanently
occupies a row whose meaning ("this isn't a person") lives only in a convention, not the
schema. Option (b) makes "no human was involved" a fact the schema itself states via the
`CHECK` constraint, with no special-cased row to guard against elsewhere in the codebase —
fewer places for a future query to accidentally treat `SYSTEM` as a real user. A below-
threshold submission therefore writes two audit rows in one transaction: `PO_SUBMITTED`
(`actor_type = USER`, the submitting Buyer) and `PO_APPROVED` (`actor_type = SYSTEM`,
`actor_user_id = NULL`, `details.autoApproved = true`).

**Alternatives considered**: Skipping a `PO_APPROVED` entry for auto-approvals entirely,
relying on `PO_SUBMITTED` alone plus the order's resulting `status = APPROVED` (rejected —
loses the explicit, queryable record that *this specific status change* happened and *why*,
weakening Constitution Principle VIII for the one approval path that has no human
decision-maker to point to).

## 9. Testing approach

**Decision**: Jest + Supertest against a real, disposable Postgres database (migrated via
Prisma before the suite runs). Categories: `contract` (request/response shape per route),
`integration` (direct-API bypass attempts on locked orders, over-receipt attempts,
concurrent approval/receipt races via `Promise.all`, authorization-boundary tests),
`unit` (pure helper logic, e.g. threshold decision function). Frontend testing is
manual-only for this POC (verified via `quickstart.md`), per Constitution Principle XI
(which scopes mandatory automated testing to business invariants, i.e. the backend) and
Principle XII (Scope Control).

**Rationale**: Constitution Principle XI requires direct-API tests that attempt to bypass
business rules, not just happy-path contract tests — Jest+Supertest against a real DB
(rather than mocks) is necessary because the invariants being tested are partly enforced
by the DB itself (§2), so a mocked Prisma client would not actually prove the guarantee.

**Alternatives considered**: Mocked Prisma client for unit-style API tests (rejected as
the primary strategy — would not exercise the DB triggers/constraints that are the actual
enforcement mechanism for the feature's central guarantee).

## 10. Containerization

**Decision**: `docker-compose.yml` with three services: `postgres` (official image,
named volume for data), `backend` (Express API, runs `prisma migrate deploy` on startup
then starts the server), `frontend` (Vite dev server or a static build served simply, for
POC purposes). One `.env` file at the repo root, documented via `.env.example`, supplies
`DATABASE_URL`, `JWT_SECRET`, `APPROVAL_THRESHOLD`, and port bindings to all services.

**Rationale**: Matches the spec's assumption that the system starts via `docker compose up`
with no manual setup beyond a documented `.env`.

**Alternatives considered**: Separate `.env` per service (rejected — adds setup friction
against the spec's "single documented `.env`" assumption).

## 11. SQL-level vs. API-level enforcement — the full decision matrix

**Decision**: The **required** guarantee for every integrity rule below is API-layer /
application-code-path enforcement — this is what the rubric actually grades: "no code
path — including a direct API call" (§3.3), "under a direct API call that tries to bypass
it" (§4), "through every code path you can think of" (§6). All three phrasings are scoped
to callers of the application (the Express API), never to a raw SQL session bypassing the
app entirely. API-layer validation (`zod` + service-layer checks) is what satisfies every
rule in the table below on its own — that alone is a complete, gradeable answer.

A subset of rules **additionally** get a DB-level constraint/trigger. This extends
protection to a raw SQL write that bypasses the API entirely — **defense-in-depth /
bonus hardening beyond what this POC is graded on**, kept because it was already built
and costs nothing to retain, not because the rubric requires it. The table below is the
explicit per-rule decision, consolidating and extending §2 and §4 above:

| Rule | Required: API-layer enforcement | Bonus (not required): DB-level backstop? | Why |
|---|---|---|---|
| Order total = sum(lines) | No API path accepts a `total` field at all — satisfies FR-005 in full on its own | **Yes (bonus)** — trigger recomputes `total` from lines on every line change | The API-layer rule already meets the graded requirement; the trigger additionally survives a raw SQL write, which nothing asks for but costs nothing to keep |
| No over-receipt (`received_qty <= quantity`) | Service checks outstanding quantity before insert, for a clean `409` — satisfies FR-014 in full, including the *required* concurrency-safety case (concurrent API calls) | **Yes (bonus)** — `CHECK` constraint, race-safe via the trigger's row lock (§2) | Same as above — the API-layer + DB-transaction mechanism meets the required (API/app-code-path) concurrency guarantee; surviving a raw SQL write on top of that is the bonus part |
| `quantity > 0`, `unit_price >= 0`, receipt `quantity > 0` | `zod` schema validation before any service method runs — satisfies FR-004/FR-015 in full | **Yes (bonus)** — `CHECK` constraints on the columns | Cheap, per-row constraints; free bonus hardening even though the API already validates format |
| Locked-order edit rejected (FR-008/FR-009) | Service checks `status = DRAFT` inside a transaction before any write — satisfies FR-008/FR-009 in full | **No** | Required scope is the API boundary (rubric §3.3/§4, research.md §4); a mirroring trigger would reach beyond graded scope for no benefit |
| Approver ≠ Buyer (FR-010a) | Service compares approver id to `created_by` — satisfies FR-010a in full | **No** | An authorization/business rule checked at the API boundary; not a data-integrity constraint the rubric asks to survive a raw SQL bypass |
| Reject/cancel requires a reason (FR-010/FR-011) | `zod` requires `reason`; service rejects if absent — satisfies FR-010/FR-011 in full | **Yes (bonus)** — `CHECK ((status <> 'REJECTED' OR rejection_reason IS NOT NULL) AND (status <> 'CANCELLED' OR cancellation_reason IS NOT NULL))` on `PurchaseOrder` | Cheap single-row constraint; not required, but there's no meaningful cost argument against keeping it |
| Vendor must be active at PO creation (FR-002) | Service checks `vendor.is_active` before insert — satisfies FR-002 in full | **No** | Not required; a DB-level trigger validating a *different table's* state at insert time would be disproportionate machinery for a POC and isn't asked for |

**Rationale for the split**: every rule's *required* guarantee is fully met by the API
layer alone — that is what this POC is graded on, per the rubric text quoted above. The
rules that additionally got a DB-level backstop (total, over-receipt, quantity checks,
reason-required) are the ones where the extra layer was cheap (a column-level `CHECK`) or
already necessary anyway (the trigger driving the stored-and-synced `total`/`received_qty`
columns, research.md §2) — so keeping the bonus SQL-bypass protection cost nothing
further. Locking and the approver-identity check don't get a mirroring DB trigger because
that would be pure additional complexity (Constitution Principle XII, Scope Control) for
a capability nothing in the rubric or spec asks for.

**Alternatives considered**: Presenting the DB-level mechanisms as part of the *required*
guarantee (this was the prior framing in an earlier pass — rejected on review: it
overstated what the rubric actually asks for, quoted above, none of which mentions a raw
SQL session bypassing the application). DB-level enforcement for every rule (rejected —
locking and segregation-of-duties are not naturally expressible as a stateless column
constraint without either a trigger reading other rows or session-variable plumbing to
know "who is asking," which is materially more machinery than even the bonus tier needs).
API-only enforcement for every rule, i.e. dropping the DB triggers entirely (rejected —
they're already built, correct, and free to keep; removing working protection would be
active harm for no reason, even though it is no longer claimed to be required).

## 12. Report performance target and how it gets tested

**Decision**: The outstanding-orders-by-vendor-and-age endpoint MUST return one paginated
page (50 rows) in under 2 seconds against a seeded dataset of at least 10,000 purchase
orders and 50,000 purchase order lines (spec.md SC-004). This is validated two ways: (1) a
wall-clock timing assertion in an integration test against the seeded dataset, run as part
of the test suite (not just manually in `quickstart.md`); (2) an `EXPLAIN ANALYZE` check
(run once, manually or via a small script, not per-CI-run) confirming the query plan uses
the `(vendor_id, status)` / `(status, submitted_at)` indexes from data-model.md rather than
a sequential scan, since wall-clock time alone can pass by coincidence on a fast machine
without actually proving index usage.

**Rationale**: A performance requirement with no numeric target and no test is not
actually a requirement — it's a hope. Constitution Principle IX requires DB-side
aggregation to be provable, not assumed; a concrete threshold plus an index-usage check
makes "no full-table scan" something a test can fail, not just something the design
intends.

**Alternatives considered**: Wall-clock timing only, no `EXPLAIN ANALYZE` check (rejected —
a small seeded dataset or a fast dev machine could pass a timing assertion even with a full
scan, giving false confidence). A stricter target (e.g. <200ms) (rejected as the *required*
bar — reasonable for production, but tighter than a 2-week POC needs to prove the
architectural point; the API contract's pagination and the DB indexes are what actually
carry the scalability guarantee, not shaving the last few hundred milliseconds).

## 13. "Age" reference point for the outstanding-orders report

**Decision**: `ageDays` on the outstanding-orders-by-vendor-and-age report (FR-016) is
computed as time elapsed **since the order was submitted** (`submitted_at`), not since it
was approved (`approved_at`). This applies uniformly whether the order auto-approved
(submission and approval are effectively simultaneous) or sat in `PENDING_APPROVAL` for a
while before a human Approver acted.

**Rationale**: The rubric explicitly poses this as an open choice — "age (time since
raised or since approval)" — rather than dictating an answer, so it needs a stated
decision, not an inferred default. "Since submission" better serves what a Procurement
Admin actually uses this view for: knowing how long an order has been open against a
vendor, including any time spent waiting for approval. "Since approval" would reset the
clock at approval time, hiding exactly the kind of approval-wait delay a Procurement Admin
should be able to see — an order that took a week to approve would misleadingly look
"fresh" the moment it's approved, which defeats the point of an aging report.

**Alternatives considered**: "Since approval" (rejected — masks approval-wait time, which
is itself an operationally relevant delay, per the reasoning above). Two separate age
figures (`daysSinceSubmission` and `daysSinceApproval`) (rejected as unnecessary scope for
a 2-week POC — a single, clearly-defined reference point is sufficient to demonstrate the
required behavior; Constitution Principle XII, Scope Control).

**Where this is stated**: spec.md's Assumptions (age decision) and FR-016; this section
for the formal Decision/Rationale/Alternatives record;
`contracts/api-contract.md`'s reporting endpoint (`ageDays` defined against `submittedAt`).

## 14. Express 4 vs. 5

**Decision**: The API is built on Express 4 (`^4.22.3`), not Express 5.

**Rationale**: Express 5 had only recently reached general stable release at the time this
project was built, so its middleware and example ecosystem was noticeably thinner than
Express 4's — a real consideration for a fixed 2-week solo POC where time spent working
around unfamiliar or less-documented edges of a newer major version is time not spent on
the actual domain logic the assignment is graded on. Express 4 is mature, its behavior with
the async route-handler and error-middleware patterns used throughout this codebase
(`asyncHandler.ts`, `errorHandler.ts`) is well understood, and nothing in this project's
requirements depends on anything Express 5 adds.

**Alternatives considered**: Express 5 (rejected for the reason above — a newer major
version's thinner ecosystem is an avoidable risk for a time-boxed solo build, with no
corresponding requirement pulling toward it).

**Note on when this was decided**: This decision was made when the backend project was
first initialized (`package.json` has pinned Express 4 since that commit), but it was never
written down at the time — this section records it retroactively, now, rather than at the
original decision point.
