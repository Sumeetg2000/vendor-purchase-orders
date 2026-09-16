import type { Prisma } from "@prisma/client";

/** T018b: pure formatting — PO-{YYYY}-{seq:06d} (research.md §7). */
export function formatOrderNumber(sequenceValue: bigint | number, year: number): string {
  const padded = String(sequenceValue).padStart(6, "0");
  return `PO-${year}-${padded}`;
}

type TransactionClient = Prisma.TransactionClient;

/**
 * T018c: reads nextval('purchase_order_number_seq') via the given Prisma
 * transaction client and formats it. Must be called from within an existing
 * transaction (e.g. raisePurchaseOrder, T049) so the sequence draw and the
 * order row it names are created atomically together.
 */
export async function generateOrderNumber(tx: TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<
    { nextval: bigint }[]
  >`SELECT nextval('purchase_order_number_seq')`;
  const row = rows[0];
  if (!row) {
    throw new Error("purchase_order_number_seq did not return a value");
  }
  return formatOrderNumber(row.nextval, new Date().getFullYear());
}
