<!--
Sync Impact Report
- Version change: (none, template) → 1.0.0
- Rationale: Initial ratification of the project constitution. The prior file on disk
  contained only unpopulated template placeholders, so this is treated as first adoption
  (MAJOR version) rather than an amendment.
- Modified principles: n/a (initial creation)
- Added sections:
  - Core Principles I–XIII (Domain Invariants Over Convenience; Purchase-Order Integrity;
    Approval Integrity; Goods-Receipt Integrity; Transactional Correctness; Authentication
    and Authorization; API Validation; Auditability; Query Correctness and Scalability;
    Architecture; Testing; Scope Control; Spec-Driven Development)
  - Project Context
  - Development Workflow
  - Governance
- Removed sections: none
- Deferred placeholders / TODOs: none — all template placeholders have been replaced with
  concrete, project-specific text.
- Templates requiring follow-up: none checked/updated by this command (constitution-only
  scope). Dependent templates (plan/spec/tasks templates and command prompts) read this
  constitution at runtime and are out of scope for this change.
-->

# Vendor & Purchase Order Management Constitution

## Project Context

This is a 2-week solo proof-of-concept (POC) whose purpose is to gain practical Node.js
experience by building a realistic procurement (vendor and purchase order management)
workflow using Spec-Driven Development. It is not a production system. Every principle
below exists to make the POC demonstrate correct, defensible engineering behavior — not to
maximize feature surface or infrastructure sophistication.

## Core Principles

### I. Domain Invariants Over Convenience

Business rules MUST be explicit and enforced consistently, regardless of which client or
code path triggers them. The backend is the sole authoritative enforcement boundary for
every invariant in this document. The frontend MUST NEVER be treated as a security or
business-rule boundary — it may improve UX (inline hints, disabled buttons), but removing
or bypassing the frontend entirely (e.g. calling the API directly) MUST NOT allow any rule
to be violated.

**Rationale**: A procurement system's value is its trustworthiness. If rules can be
bypassed by skipping the UI, the system cannot be relied upon for real financial decisions,
even in a POC meant to demonstrate the pattern correctly.

### II. Purchase-Order Integrity

A purchase order (PO) MUST reference a real, active vendor. A PO MUST contain one or more
lines, and each line MUST have a description, quantity, and unit price. The order total is
a derived value computed from its line items and MUST NEVER be independently editable —
there MUST be no API path, including direct API calls that bypass the UI, that allows the
stored total to diverge from what the line items sum to.

**Rationale**: The total is the single most consequential number in a PO. Allowing it to
be set independently of its lines opens the door to silent financial discrepancies that no
amount of UI validation can catch.

### III. Approval Integrity

Orders above the configured approval threshold MUST require approval before they take
effect. Orders below the threshold MAY be auto-approved or follow a lighter workflow, but
that behavior MUST be explicit and documented, never an accidental side effect of missing
logic. Once approved, a purchase order is locked: its lines, vendor, and total MUST NOT be
modified. Cancellation is a distinct operation from editing and MUST require a reason.
Every approval decision (approve, reject, cancel) MUST be auditable.

**Rationale**: Approval is the control point where financial authority is exercised. If an
approved order can still be edited, the approval itself becomes meaningless.

### IV. Goods-Receipt Integrity

Goods MAY be received partially, and multiple receipt events against the same PO line are
allowed. Outstanding quantity is a derived value (ordered quantity minus received
quantity) and MUST NEVER be independently editable. Over-receipt (receiving more than the
outstanding quantity) MUST be rejected. Concurrent receipt operations MUST be safe and
MUST NOT allow the total received quantity to exceed the ordered quantity, even when two
receipt requests race against each other.

**Rationale**: Receiving is where physical reality meets the order record. Partial and
concurrent receipts are the normal case, not the edge case, so correctness under
concurrency is a core requirement, not an afterthought.

### V. Transactional Correctness

Operations that require multiple related database changes MUST be atomic. Concurrency-
sensitive operations (in particular, goods receipt and approval-triggered locking) MUST
use an appropriate database transaction or locking strategy. Application-memory checks
alone (e.g. "check then write" in JavaScript without a database-enforced guard) MUST NOT be
relied upon to protect an invariant that can be violated by concurrent requests.

**Rationale**: Node.js's single-threaded event loop does not prevent race conditions
across concurrent requests interleaved at I/O boundaries; only the database can guarantee
atomicity and isolation for these invariants.

### VI. Authentication and Authorization

Every business action MUST require authentication. Authorization MUST be enforced on the
backend for every protected operation. The Buyer, Approver, and Procurement Admin roles
MUST have distinct, non-overlapping responsibilities enforced in code, not only by
convention or UI hiding. Direct API requests MUST be subject to the exact same
authorization and business rules as requests originating from the frontend.

**Rationale**: Role separation (buyer creates, approver approves, admin administers) is a
core procurement control. If any role can perform another role's action via a direct API
call, the control is theater rather than substance.

### VII. API Validation

Invalid input MUST be rejected before any business logic executes. Request validation
MUST be explicit and applied consistently across endpoints, not ad hoc per handler. Error
responses MUST clearly distinguish and communicate validation failures from business-rule
failures so that callers (including automated tests) can act on them deterministically.

**Rationale**: Validating at the boundary keeps domain/service code focused on business
rules and prevents malformed data from ever reaching invariant checks.

### VIII. Auditability

Important procurement actions MUST produce structured audit records. At minimum, PO
creation, approval decisions (approve/reject), cancellation, and goods receipts MUST be
captured. Each audit record MUST identify the actor, the action taken, the target entity,
and the relevant timestamp and details.

**Rationale**: Procurement is an accountability domain. A decision that cannot be traced
back to who made it and when is not meaningfully auditable, regardless of correctness.

### IX. Query Correctness and Scalability

Aggregate views such as outstanding orders by vendor and by age MUST be calculated using
database-side filtering and aggregation. The application MUST NOT load every order and
line into Node.js memory to filter or aggregate them there. Database indexes SHOULD
support the important access patterns (e.g. lookups by vendor, by status, by age).
The design MUST remain understandable while being capable of handling the POC's optional
10,000-order dataset without a redesign.

**Rationale**: Pushing aggregation into application memory is the most common way a POC's
data access pattern silently fails to scale even to modest data volumes; doing the
aggregation in the database from the start costs little and avoids that trap.

### X. Architecture

The system SHOULD be a simple modular monolith. Domain and business operations MUST be
kept explicit (e.g. `approvePurchaseOrder`, `receiveGoods`) rather than hidden behind a
generic CRUD abstraction that obscures business rules. Frontend, API, domain/service, and
persistence responsibilities MUST remain clearly separated so that each layer's purpose is
unambiguous.

**Rationale**: A modular monolith with explicit operations is the simplest architecture
that still makes business rules visible and testable — appropriate for a 2-week solo POC,
and consistent with Principle I (backend as the enforcement boundary).

### XI. Testing

Business invariants MUST have automated tests. Direct API tests MUST verify that protected
operations cannot bypass business rules (i.e., tests must attempt the bypass and confirm
it is rejected, not merely test the happy path). At minimum, automated tests MUST cover:
rejection of edits to an approved PO; correctness of derived totals; partial and multiple
goods receipts; prevention of over-receipt; concurrency-sensitive receipt behavior where
practical; and authorization rules across roles.

**Rationale**: In a solo POC there is no second reviewer to catch regressions by hand;
automated tests are the only durable evidence that the invariants in this constitution
actually hold.

### XII. Scope Control

This is a 2-week solo POC. Implementations MUST favor the simplest approach that
correctly demonstrates the required behavior. Unnecessary infrastructure, microservices,
generic abstractions, or dependencies MUST NOT be introduced unless they are required to
satisfy an explicit requirement in this constitution or an approved specification.

**Rationale**: Scope creep is the primary risk to a fixed 2-week solo timeline; every
addition must earn its place against the stated goal of demonstrating correct procurement
behavior, not against a hypothetical future need.

### XIII. Spec-Driven Development

Specifications are the source of truth for implementation. All implementation work MUST
trace back to explicit requirements and tasks recorded in the project's specifications.
When requirements change, the relevant specification MUST be updated before implementation
changes are made to reflect it.

**Rationale**: Spec-Driven Development is an explicit goal of this POC, not just a
process preference — implementation that drifts from its specification defeats the
purpose of the exercise.

## Development Workflow

Feature work MUST follow the Spec Kit flow: specify → clarify (as needed) → plan → tasks →
implement, with `speckit-analyze` used to check cross-artifact consistency before or during
implementation. Every plan and task set MUST be checked against this constitution's
principles; any deviation MUST be explicitly justified in the plan's complexity/tradeoff
notes rather than silently introduced during implementation.

## Governance

This constitution supersedes all other project practices and conventions for the vendor
and purchase order management POC. Where a specification, plan, or task conflicts with a
principle in this document, the constitution prevails unless the constitution itself is
first amended.

**Amendment procedure**: Amendments are made by editing this file directly, recording the
change in a Sync Impact Report comment at the top of the file, and bumping the version per
the policy below. Because this is a solo POC, no separate approval workflow is required,
but the rationale for the change MUST be recorded in the Sync Impact Report.

**Versioning policy**: This constitution follows semantic versioning:
- MAJOR: Backward-incompatible governance changes, or removal/redefinition of a principle.
- MINOR: A new principle or section is added, or existing guidance is materially expanded.
- PATCH: Clarifications, wording fixes, or other non-semantic refinements.

**Compliance review**: Any plan or task list produced for this project MUST include a
check against these principles (a "Constitution Check") before implementation begins.
Any implementation PR/change that violates a principle MUST either be revised to comply or
must accompany an amendment to this constitution explaining why the principle no longer
applies.

**Version**: 1.0.0 | **Ratified**: 2026-09-14 | **Last Amended**: 2026-09-14
