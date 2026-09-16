import type { Prisma, AuditAction, AuditEntityType } from "@prisma/client";

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
