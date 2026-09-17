import { prisma } from "../db/prismaClient.ts";
import { recordAuditEntry } from "./audit.service.ts";
import { NotFoundError, BusinessRuleViolationError } from "./errors.ts";

export interface ReceiveGoodsResult {
  id: string;
  quantity: number;
  receivedBy: string;
  receivedAt: Date;
  line: { receivedQty: number; outstandingQty: number };
}

/**
 * Postgres CHECK constraint violation (SQLSTATE 23514) — over-receipt
 * (research.md §2, §11). This originates from the trigger's own `UPDATE` on
 * `purchase_order_lines`, not the `INSERT` we issued, so Prisma surfaces it
 * as a raw connector error rather than a typed `PrismaClientKnownRequestError`
 * with a Prisma-specific code — the SQLSTATE only shows up embedded in the
 * error message text, so that's what we match on.
 */
function isCheckConstraintViolation(err: unknown): boolean {
  return err instanceof Error && err.message.includes("23514");
}

/**
 * T079: checks the parent order is APPROVED (FR-015) before inserting;
 * `quantity > 0` is gated by zod (T080) before this runs. Over-receipt
 * rejection is NOT re-implemented here in application code — it's enforced
 * by the Phase 2 DB trigger (recomputes `received_qty`) + `CHECK
 * (received_qty <= quantity)`, which is safe under concurrency because the
 * trigger's own `UPDATE` on the line takes an ordinary Postgres row lock
 * (research.md §2): a second concurrent receipt on the same line blocks
 * until the first commits, then re-evaluates against the true committed
 * total. This function only translates that DB-level rejection into the
 * same business_rule_violation shape as an application-level check.
 */
export async function receiveGoods(
  actorUserId: string,
  purchaseOrderId: string,
  lineId: string,
  quantity: number,
): Promise<ReceiveGoodsResult> {
  return prisma.$transaction(async (tx) => {
    const line = await tx.purchaseOrderLine.findUnique({
      where: { id: lineId },
      include: { purchaseOrder: true },
    });
    if (!line || line.purchaseOrderId !== purchaseOrderId) {
      throw new NotFoundError();
    }
    if (line.purchaseOrder.status !== "APPROVED") {
      throw new BusinessRuleViolationError(
        "Goods can only be received against an approved purchase order",
      );
    }

    let event;
    try {
      event = await tx.goodsReceiptEvent.create({
        data: { purchaseOrderLineId: lineId, quantity, receivedBy: actorUserId },
      });
    } catch (err) {
      if (isCheckConstraintViolation(err)) {
        throw new BusinessRuleViolationError(
          "This receipt would exceed the line's outstanding quantity",
        );
      }
      throw err;
    }

    const updatedLine = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineId } });

    await recordAuditEntry(tx, {
      actor: { type: "USER", userId: actorUserId },
      action: "GOODS_RECEIPT_RECORDED",
      entityType: "PurchaseOrderLine",
      entityId: lineId,
      details: { quantity, purchaseOrderId },
    });

    return {
      id: event.id,
      quantity: event.quantity,
      receivedBy: event.receivedBy,
      receivedAt: event.receivedAt,
      line: {
        receivedQty: updatedLine.receivedQty,
        outstandingQty: updatedLine.quantity - updatedLine.receivedQty,
      },
    };
  });
}

export interface GoodsReceiptEventView {
  id: string;
  purchaseOrderLineId: string;
  quantity: number;
  receivedBy: string;
  receivedAt: Date;
}

export async function listGoodsReceiptEvents(
  purchaseOrderId: string,
  lineId: string,
): Promise<GoodsReceiptEventView[]> {
  const line = await prisma.purchaseOrderLine.findUnique({ where: { id: lineId } });
  if (!line || line.purchaseOrderId !== purchaseOrderId) {
    throw new NotFoundError();
  }

  const events = await prisma.goodsReceiptEvent.findMany({
    where: { purchaseOrderLineId: lineId },
    orderBy: { receivedAt: "asc" },
  });

  return events.map((event) => ({
    id: event.id,
    purchaseOrderLineId: event.purchaseOrderLineId,
    quantity: event.quantity,
    receivedBy: event.receivedBy,
    receivedAt: event.receivedAt,
  }));
}
