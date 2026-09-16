import type { Vendor } from "@prisma/client";
import { prisma } from "../db/prismaClient.ts";
import { recordAuditEntry } from "./audit.service.ts";
import { NotFoundError } from "./errors.ts";

export interface CreateVendorInput {
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  paymentTerms: string;
}

/**
 * T034: vendor domain operations. Vendor create/deactivate produce
 * VENDOR_CREATED / VENDOR_DEACTIVATED audit entries — additional coverage
 * beyond FR-019's graded minimum (spec.md FR-019 note), written atomically
 * with the business change per Constitution Principle V.
 */
export async function createVendor(actorUserId: string, input: CreateVendorInput): Promise<Vendor> {
  return prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.create({ data: input });
    await recordAuditEntry(tx, {
      actor: { type: "USER", userId: actorUserId },
      action: "VENDOR_CREATED",
      entityType: "Vendor",
      entityId: vendor.id,
      details: { name: vendor.name },
    });
    return vendor;
  });
}

export async function listVendors(activeFilter?: boolean): Promise<Vendor[]> {
  return prisma.vendor.findMany({
    where: activeFilter === undefined ? {} : { isActive: activeFilter },
    orderBy: { createdAt: "asc" },
  });
}

export async function getVendorById(id: string): Promise<Vendor> {
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) {
    throw new NotFoundError();
  }
  return vendor;
}

/** Deactivation is idempotent — an already-inactive vendor is a no-op, no new audit entry. */
export async function deactivateVendor(actorUserId: string, id: string): Promise<Vendor> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.vendor.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError();
    }
    if (!existing.isActive) {
      return existing;
    }
    const vendor = await tx.vendor.update({ where: { id }, data: { isActive: false } });
    await recordAuditEntry(tx, {
      actor: { type: "USER", userId: actorUserId },
      action: "VENDOR_DEACTIVATED",
      entityType: "Vendor",
      entityId: vendor.id,
      details: {},
    });
    return vendor;
  });
}
