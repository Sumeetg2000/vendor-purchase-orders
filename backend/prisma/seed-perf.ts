import { randomUUID } from "node:crypto";
import { prisma } from "../src/db/prismaClient.ts";
import type { Prisma } from "@prisma/client";

/**
 * T087: generates a large dataset for performance testing (research.md §12,
 * spec.md SC-004 — at least 10,000 purchase orders / 50,000 lines). Inserts
 * directly via Prisma's `createMany` (a single multi-row INSERT per batch)
 * rather than through the API, purely for seeding speed — the Phase 2
 * triggers still fire per row on a multi-row INSERT, so `total` ends up
 * correctly derived once lines are inserted, exactly as it would through the
 * API.
 *
 * Status mix (enough to prove the outstanding-orders filter still narrows
 * correctly at scale — exhaustive correctness across every status is already
 * covered by the smaller, precisely-controlled T083 test):
 * ~85% APPROVED (outstanding, since no receipts are recorded against them),
 * ~15% split across DRAFT/PENDING_APPROVAL/REJECTED/CANCELLED (excluded).
 */
export interface SeedPerfOptions {
  orderCount?: number;
  linesPerOrder?: number;
  vendorCount?: number;
  batchSize?: number;
}

export interface SeedPerfResult {
  orderCount: number;
  lineCount: number;
  vendorIds: string[];
  buyerId: string;
}

const EXCLUDED_STATUSES = ["DRAFT", "PENDING_APPROVAL", "REJECTED", "CANCELLED"] as const;

export async function seedPerfDataset(options: SeedPerfOptions = {}): Promise<SeedPerfResult> {
  const orderCount = options.orderCount ?? 10_000;
  const linesPerOrder = options.linesPerOrder ?? 5;
  const vendorCount = options.vendorCount ?? 20;
  const batchSize = options.batchSize ?? 1000;

  const runTag = Date.now();

  const vendorIds: string[] = [];
  for (let i = 0; i < vendorCount; i++) {
    const vendor = await prisma.vendor.create({
      data: { name: `Perf Vendor ${runTag}-${i}`, paymentTerms: "Net 30" },
    });
    vendorIds.push(vendor.id);
  }

  const buyer = await prisma.user.create({
    data: { email: `perf-buyer-${runTag}@test.internal`, passwordHash: "unused" },
  });

  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  let createdOrders = 0;
  let createdLines = 0;

  while (createdOrders < orderCount) {
    const batchCount = Math.min(batchSize, orderCount - createdOrders);
    const orderRows: Prisma.PurchaseOrderCreateManyInput[] = [];
    const lineRowsByOrder: { orderId: string; quantity: number; unitPrice: number }[] = [];

    for (let i = 0; i < batchCount; i++) {
      const idx = createdOrders + i;
      const id = randomUUID();
      const vendorId = vendorIds[idx % vendorIds.length]!;
      const ageDays = idx % 400;
      const bucket = idx % 20;

      let status: (typeof EXCLUDED_STATUSES)[number] | "APPROVED";
      if (bucket < 16) {
        status = "APPROVED";
      } else {
        // bucket 16..19 -> EXCLUDED_STATUSES[0..3], covering all four evenly.
        status = EXCLUDED_STATUSES[bucket - 16]!;
      }

      const submittedAt = status === "DRAFT" ? null : new Date(now - ageDays * dayMs);
      const isApproved = status === "APPROVED";

      orderRows.push({
        id,
        orderNumber: `PO-PERF-${runTag}-${String(idx).padStart(8, "0")}`,
        vendorId,
        createdBy: buyer.id,
        status,
        submittedAt,
        approvedAt: isApproved ? submittedAt : null,
        ...(status === "REJECTED" ? { rejectionReason: "perf fixture" } : {}),
        ...(status === "CANCELLED" ? { cancellationReason: "perf fixture" } : {}),
      });

      for (let l = 0; l < linesPerOrder; l++) {
        lineRowsByOrder.push({ orderId: id, quantity: 10 + l, unitPrice: 5 + l });
      }
    }

    await prisma.purchaseOrder.createMany({ data: orderRows });
    createdOrders += batchCount;

    // Insert this batch's lines in sub-chunks so no single INSERT statement
    // is excessively large.
    for (let start = 0; start < lineRowsByOrder.length; start += batchSize * linesPerOrder) {
      const chunk = lineRowsByOrder.slice(start, start + batchSize * linesPerOrder);
      await prisma.purchaseOrderLine.createMany({
        data: chunk.map((row) => ({
          purchaseOrderId: row.orderId,
          description: "Perf test line",
          quantity: row.quantity,
          unitPrice: row.unitPrice,
        })),
      });
      createdLines += chunk.length;
    }
  }

  return { orderCount: createdOrders, lineCount: createdLines, vendorIds, buyerId: buyer.id };
}

// Allow running directly: `node prisma/seed-perf.ts` (per T087's own file,
// for manual dev-DB seeding, matching seed.ts's pattern).
if (import.meta.url === `file://${process.argv[1]}`) {
  const start = Date.now();
  const result = await seedPerfDataset();
  console.log(
    `seeded ${result.orderCount} orders / ${result.lineCount} lines in ${Date.now() - start}ms`,
  );
  await prisma.$disconnect();
}
