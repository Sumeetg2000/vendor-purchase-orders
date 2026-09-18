import type { AuditLogEntry, Prisma, AuditAction, AuditEntityType } from "@prisma/client";
import { prisma } from "../db/prismaClient.ts";
import { NotFoundError } from "./errors.ts";

type TransactionClient = Prisma.TransactionClient;

/**
 * Discriminated actor union — mirrors the DB CHECK constraint exactly
 * (data-model.md: "required when actor_type = USER; MUST be NULL when
 * actor_type = SYSTEM"), so it's impossible to call recordAuditEntry in a way
 * that would violate it.
 */
export type AuditActor = { type: "USER"; userId: string } | { type: "SYSTEM" };

export interface RecordAuditEntryInput {
  actor: AuditActor;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  details: Prisma.InputJsonValue;
}

/**
 * T025: writes an AuditLogEntry row inside the caller-supplied transaction,
 * so the audit write is atomic with the business change it documents
 * (research.md §8, Constitution Principle V/VIII).
 */
export async function recordAuditEntry(
  tx: TransactionClient,
  input: RecordAuditEntryInput,
): Promise<void> {
  await tx.auditLogEntry.create({
    data: {
      actorType: input.actor.type,
      actorUserId: input.actor.type === "USER" ? input.actor.userId : null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      details: input.details,
    },
  });
}

/**
 * T095: chronological audit trail "for dispute resolution" (api-contract.md)
 * for a single purchase order — includes both entries recorded directly
 * against the order (PO_CREATED/SUBMITTED/APPROVED/REJECTED/CANCELLED) and
 * entries recorded against its lines (GOODS_RECEIPT_RECORDED, entityType
 * PurchaseOrderLine), since a receipt is part of that order's history even
 * though audit.service.ts records it against the line it was received on.
 */
export async function listAuditLogForOrder(purchaseOrderId: string): Promise<AuditLogEntry[]> {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  if (!order) {
    throw new NotFoundError();
  }

  const lineIds = order.lines.map((line) => line.id);

  return prisma.auditLogEntry.findMany({
    where: {
      OR: [
        { entityType: "PurchaseOrder", entityId: purchaseOrderId },
        ...(lineIds.length > 0
          ? [{ entityType: "PurchaseOrderLine" as const, entityId: { in: lineIds } }]
          : []),
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}
