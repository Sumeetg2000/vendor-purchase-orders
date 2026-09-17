import type { Prisma, PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "../db/prismaClient.ts";
import { recordAuditEntry } from "./audit.service.ts";
import { NotFoundError, BusinessRuleViolationError } from "./errors.ts";
import { generateOrderNumber } from "./orderNumber.ts";

export interface LineInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  lines: LineInput[];
}

export interface EditPurchaseOrderInput {
  vendorId?: string;
  lines?: LineInput[];
}

export interface ListPurchaseOrdersFilter {
  vendorId?: string;
  status?: PurchaseOrderStatus;
}

export type PurchaseOrderWithLines = PurchaseOrder & { lines: PurchaseOrderLine[] };

async function assertVendorActive(tx: Prisma.TransactionClient, vendorId: string): Promise<void> {
  const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || !vendor.isActive) {
    throw new BusinessRuleViolationError(
      "Purchase orders can only reference a vendor that exists and is active",
    );
  }
}

/**
 * T049: FR-002 (active vendor, checked here). FR-003 (>=1 line) and FR-004
 * (line quantity/price) are gated by the create-PO zod schema (T052) before
 * this function ever runs — per api-contract.md, an empty/missing `lines`
 * body is a 400 validation_error, not a 409 business-rule failure, so that
 * check belongs at the API boundary, not here.
 *
 * `total` is never computed by this function — it inserts the lines and lets
 * the DB trigger (T016) recompute `purchase_orders.total`, then re-reads the
 * row so the response reflects the trigger-computed value (Prisma's own
 * `create()` result only reflects what it itself wrote, not what a trigger
 * changed afterward).
 */
export async function raisePurchaseOrder(
  actorUserId: string,
  input: CreatePurchaseOrderInput,
): Promise<PurchaseOrderWithLines> {
  return prisma.$transaction(async (tx) => {
    await assertVendorActive(tx, input.vendorId);

    const orderNumber = await generateOrderNumber(tx);

    const created = await tx.purchaseOrder.create({
      data: {
        orderNumber,
        vendorId: input.vendorId,
        createdBy: actorUserId,
        lines: { create: input.lines },
      },
    });

    const withLines = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: created.id },
      include: { lines: true },
    });

    await recordAuditEntry(tx, {
      actor: { type: "USER", userId: actorUserId },
      action: "PO_CREATED",
      entityType: "PurchaseOrder",
      entityId: withLines.id,
      details: { orderNumber: withLines.orderNumber, vendorId: withLines.vendorId },
    });

    return withLines;
  });
}

/**
 * T050: only DRAFT orders are editable (FR-006/FR-008/FR-009). A `lines`
 * array, when supplied, is a full replacement — already guaranteed non-empty
 * by the PATCH zod schema (T052), so "zero lines" can't reach here either.
 */
export async function editDraftOrder(
  id: string,
  input: EditPurchaseOrderInput,
): Promise<PurchaseOrderWithLines> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError();
    }
    if (existing.status !== "DRAFT") {
      throw new BusinessRuleViolationError(
        "This purchase order is locked and can no longer be edited",
      );
    }

    if (input.vendorId !== undefined) {
      await assertVendorActive(tx, input.vendorId);
      await tx.purchaseOrder.update({ where: { id }, data: { vendorId: input.vendorId } });
    }

    if (input.lines !== undefined) {
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrderLine.createMany({
        data: input.lines.map((line) => ({ ...line, purchaseOrderId: id })),
      });
    }

    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  });
}

export async function listPurchaseOrders(
  filter: ListPurchaseOrdersFilter,
): Promise<PurchaseOrderWithLines[]> {
  return prisma.purchaseOrder.findMany({
    where: {
      ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    include: { lines: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getPurchaseOrderById(id: string): Promise<PurchaseOrderWithLines> {
  const order = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!order) {
    throw new NotFoundError();
  }
  return order;
}

/**
 * Maps the Prisma record into the exact api-contract.md `PurchaseOrder`
 * shape — money values as decimal strings (never JS floats/Prisma Decimal
 * objects), `outstandingQty` computed per line (never stored, data-model.md).
 */
export function serializePurchaseOrder(order: PurchaseOrderWithLines) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    vendorId: order.vendorId,
    status: order.status,
    total: order.total.toFixed(2),
    lines: order.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(2),
      receivedQty: line.receivedQty,
      outstandingQty: line.quantity - line.receivedQty,
    })),
    createdBy: order.createdBy,
    submittedAt: order.submittedAt,
    approvedAt: order.approvedAt,
    approvedBy: order.approvedBy,
    rejectedAt: order.rejectedAt,
    rejectedBy: order.rejectedBy,
    rejectionReason: order.rejectionReason,
    cancelledAt: order.cancelledAt,
    cancelledBy: order.cancelledBy,
    cancellationReason: order.cancellationReason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
