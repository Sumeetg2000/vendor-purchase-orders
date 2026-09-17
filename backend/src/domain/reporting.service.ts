import { Prisma } from "@prisma/client";
import { prisma } from "../db/prismaClient.ts";

export interface OutstandingOrdersFilter {
  vendorId?: string;
  minAgeDays?: number;
  maxAgeDays?: number;
  page?: number;
  pageSize?: number;
}

export interface OutstandingOrderLineView {
  id: string;
  description: string;
  quantity: number;
  receivedQty: number;
  outstandingQty: number;
}

export interface OutstandingOrderItem {
  orderId: string;
  orderNumber: string;
  vendorId: string;
  vendorName: string;
  status: string;
  total: string;
  ageDays: number;
  outstandingLines: OutstandingOrderLineView[];
}

export interface OutstandingOrdersResult {
  items: OutstandingOrderItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface OutstandingOrderRow {
  order_id: string;
  order_number: string;
  vendor_id: string;
  vendor_name: string;
  status: string;
  total: Prisma.Decimal | string;
  age_days: number;
  full_count: bigint;
}

const MAX_PAGE_SIZE = 50;

/**
 * T088: FR-016's precise filter — status = 'APPROVED' AND at least one line
 * has received_qty < quantity — expressed as a single indexed SQL query
 * (Constitution Principle IX), never a full in-memory scan. Age is days
 * since `submitted_at` (research.md §13, NOT `approved_at`).
 *
 * The WHERE clause is built once here and reused verbatim by the
 * performance test (T086) for its `EXPLAIN ANALYZE` check, so that check
 * reflects the actual production query, not an approximation of it.
 */
export function buildOutstandingOrdersWhere(filter: OutstandingOrdersFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`po.status = 'APPROVED'`,
    Prisma.sql`EXISTS (
      SELECT 1 FROM purchase_order_lines pol
      WHERE pol.purchase_order_id = po.id AND pol.received_qty < pol.quantity
    )`,
  ];

  if (filter.vendorId) {
    conditions.push(Prisma.sql`po.vendor_id = ${filter.vendorId}::uuid`);
  }
  // "At least N days old" -> submitted at or before (now - N days).
  if (filter.minAgeDays !== undefined) {
    const cutoff = new Date(Date.now() - filter.minAgeDays * 24 * 60 * 60 * 1000);
    conditions.push(Prisma.sql`po.submitted_at <= ${cutoff}`);
  }
  // "At most N days old" -> submitted at or after (now - N days).
  if (filter.maxAgeDays !== undefined) {
    const cutoff = new Date(Date.now() - filter.maxAgeDays * 24 * 60 * 60 * 1000);
    conditions.push(Prisma.sql`po.submitted_at >= ${cutoff}`);
  }

  return Prisma.join(conditions, " AND ");
}

/** Exposed for the EXPLAIN ANALYZE check in the performance test (T086). */
export function buildOutstandingOrdersQuery(filter: OutstandingOrdersFilter): Prisma.Sql {
  const pageSize = Math.min(filter.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = Math.max(filter.page ?? 1, 1);
  const offset = (page - 1) * pageSize;
  const where = buildOutstandingOrdersWhere(filter);

  return Prisma.sql`
    SELECT
      po.id AS order_id,
      po.order_number,
      po.vendor_id,
      v.name AS vendor_name,
      po.status,
      po.total,
      EXTRACT(DAY FROM (now() - po.submitted_at))::int AS age_days,
      COUNT(*) OVER() AS full_count
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
    WHERE ${where}
    ORDER BY po.submitted_at ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
}

export async function outstandingOrdersByVendorAndAge(
  filter: OutstandingOrdersFilter,
): Promise<OutstandingOrdersResult> {
  const pageSize = Math.min(filter.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const page = Math.max(filter.page ?? 1, 1);

  const rows = await prisma.$queryRaw<OutstandingOrderRow[]>(buildOutstandingOrdersQuery(filter));

  const total = rows.length > 0 ? Number(rows[0]!.full_count) : 0;
  const orderIds = rows.map((row) => row.order_id);

  // A second, cheap query for just this page's outstanding lines — grouping
  // per-line detail into the main window-function query would complicate it
  // for no benefit, since only ~50 orders' lines are needed at a time.
  const outstandingLinesByOrder = new Map<string, OutstandingOrderLineView[]>();
  if (orderIds.length > 0) {
    const lines = await prisma.purchaseOrderLine.findMany({
      where: { purchaseOrderId: { in: orderIds } },
    });
    for (const line of lines) {
      if (line.receivedQty >= line.quantity) continue;
      const list = outstandingLinesByOrder.get(line.purchaseOrderId) ?? [];
      list.push({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        receivedQty: line.receivedQty,
        outstandingQty: line.quantity - line.receivedQty,
      });
      outstandingLinesByOrder.set(line.purchaseOrderId, list);
    }
  }

  const items: OutstandingOrderItem[] = rows.map((row) => ({
    orderId: row.order_id,
    orderNumber: row.order_number,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    status: row.status,
    total: typeof row.total === "string" ? row.total : row.total.toFixed(2),
    ageDays: row.age_days,
    outstandingLines: outstandingLinesByOrder.get(row.order_id) ?? [],
  }));

  return { items, total, page, pageSize };
}
