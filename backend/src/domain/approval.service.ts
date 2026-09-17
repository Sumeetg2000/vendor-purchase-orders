import { prisma } from "../db/prismaClient.ts";
import { recordAuditEntry } from "./audit.service.ts";
import { NotFoundError, BusinessRuleViolationError } from "./errors.ts";
import type { PurchaseOrderWithLines } from "./purchaseOrder.service.ts";

function getApprovalThreshold(): number {
  const raw = process.env.APPROVAL_THRESHOLD;
  if (!raw) {
    throw new Error("APPROVAL_THRESHOLD is not configured");
  }
  return Number(raw);
}

/**
 * T067: FR-007 (threshold decision), FR-008 (lock on submission). The
 * conditional `updateMany` (WHERE id AND status = 'DRAFT') is what makes this
 * safe under concurrency — Postgres re-evaluates that WHERE clause against
 * the row's *current* state at UPDATE time under its own row lock, so a
 * second concurrent submit attempt affects 0 rows and is correctly rejected,
 * even though its own earlier read may have seen stale DRAFT state
 * (Constitution Principle V; the same row-locking insight as research.md §2).
 *
 * `>=1 line` is redundant defense-in-depth here (FR-004) — creation (T049)
 * and line edits (T050) already guarantee this, so it should be unreachable.
 */
export async function submitPurchaseOrder(
  actorUserId: string,
  id: string,
): Promise<PurchaseOrderWithLines> {
  const threshold = getApprovalThreshold();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!existing) {
      throw new NotFoundError();
    }
    if (existing.status !== "DRAFT") {
      throw new BusinessRuleViolationError("Only a draft purchase order can be submitted");
    }
    if (existing.lines.length === 0) {
      throw new BusinessRuleViolationError("A purchase order must have at least one line item");
    }

    const autoApprove = existing.total.lte(threshold);
    const now = new Date();

    const result = await tx.purchaseOrder.updateMany({
      where: { id, status: "DRAFT" },
      data: autoApprove
        ? { status: "APPROVED", submittedAt: now, approvedAt: now }
        : { status: "PENDING_APPROVAL", submittedAt: now },
    });
    if (result.count === 0) {
      throw new BusinessRuleViolationError("Only a draft purchase order can be submitted");
    }

    await recordAuditEntry(tx, {
      actor: { type: "USER", userId: actorUserId },
      action: "PO_SUBMITTED",
      entityType: "PurchaseOrder",
      entityId: id,
      details: { total: existing.total.toFixed(2), threshold },
    });

    if (autoApprove) {
      // data-model.md "When SYSTEM is used": the automatic below-threshold
      // approval is a system decision, not a person's, so it's recorded
      // distinctly from a human PO_APPROVED entry.
      await recordAuditEntry(tx, {
        actor: { type: "SYSTEM" },
        action: "PO_APPROVED",
        entityType: "PurchaseOrder",
        entityId: id,
        details: { autoApproved: true, threshold },
      });
    }

    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  });
}

/**
 * T068: `SELECT ... FOR UPDATE` locks the row for the rest of the
 * transaction, so the subsequent plain `update` is safe from concurrent
 * approval attempts (T066) — a second transaction blocks on this lock until
 * the first commits, then re-reads the now-`APPROVED` status and is
 * correctly rejected. The row lock (not the eventual UPDATE's WHERE clause)
 * is what makes the identity check (FR-010a) and the status check atomic
 * together, since one raw read lets us distinguish the two failure reasons.
 */
export async function approvePurchaseOrder(
  approverId: string,
  id: string,
): Promise<PurchaseOrderWithLines> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; status: string; created_by: string }[]
    >`SELECT id, status, created_by FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) {
      throw new NotFoundError();
    }
    if (row.status !== "PENDING_APPROVAL") {
      throw new BusinessRuleViolationError(
        "Only a purchase order pending approval can be approved",
      );
    }
    if (row.created_by === approverId) {
      throw new BusinessRuleViolationError(
        "An approver cannot approve a purchase order they raised themselves",
      );
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy: approverId },
    });

    await recordAuditEntry(tx, {
      actor: { type: "USER", userId: approverId },
      action: "PO_APPROVED",
      entityType: "PurchaseOrder",
      entityId: id,
      details: {},
    });

    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  });
}

/** T069: reject requires a reason, stored distinctly from a cancellation reason (FR-010). */
export async function rejectPurchaseOrder(
  actorUserId: string,
  id: string,
  reason: string,
): Promise<PurchaseOrderWithLines> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError();
    }

    const result = await tx.purchaseOrder.updateMany({
      where: { id, status: "PENDING_APPROVAL" },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedBy: actorUserId,
        rejectionReason: reason,
      },
    });
    if (result.count === 0) {
      throw new BusinessRuleViolationError(
        "Only a purchase order pending approval can be rejected",
      );
    }

    await recordAuditEntry(tx, {
      actor: { type: "USER", userId: actorUserId },
      action: "PO_REJECTED",
      entityType: "PurchaseOrder",
      entityId: id,
      details: { reason },
    });

    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  });
}

/** T069: cancel requires a reason, stored distinctly from a rejection reason (FR-011). */
export async function cancelPurchaseOrder(
  actorUserId: string,
  id: string,
  reason: string,
): Promise<PurchaseOrderWithLines> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError();
    }

    const result = await tx.purchaseOrder.updateMany({
      where: { id, status: "APPROVED" },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: actorUserId,
        cancellationReason: reason,
      },
    });
    if (result.count === 0) {
      throw new BusinessRuleViolationError("Only an approved purchase order can be cancelled");
    }

    await recordAuditEntry(tx, {
      actor: { type: "USER", userId: actorUserId },
      action: "PO_CANCELLED",
      entityType: "PurchaseOrder",
      entityId: id,
      details: { reason },
    });

    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  });
}
