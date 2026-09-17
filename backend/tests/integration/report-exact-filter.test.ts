import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createOrder(
  userId: string,
  vendorId: string,
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED",
  receivedQty: number,
  quantity = 10,
) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  const order = await prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      status,
      submittedAt: status === "DRAFT" ? null : new Date(),
      approvedAt: status === "APPROVED" || status === "CANCELLED" ? new Date() : null,
      ...(status === "REJECTED" ? { rejectionReason: "fixture" } : {}),
      ...(status === "CANCELLED" ? { cancellationReason: "fixture" } : {}),
      lines: { create: [{ description: "Widget", quantity, unitPrice: 5 }] },
    },
    include: { lines: true },
  });

  if (receivedQty > 0) {
    await prisma.goodsReceiptEvent.create({
      data: {
        purchaseOrderLineId: order.lines[0]!.id,
        quantity: receivedQty,
        receivedBy: userId,
      },
    });
  }

  return order;
}

describe("Exact outstanding-orders filter (T083, spec.md US5 AS1/AS5, FR-016)", () => {
  it("returns only APPROVED orders with >=1 line not fully received, excluding every other status", async () => {
    const { token: adminToken } = await createUserWithRoles("admin@test.com", [
      "PROCUREMENT_ADMIN",
    ]);
    const { user: buyer } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const outstandingApproved = await createOrder(buyer.id, vendor.id, "APPROVED", 4, 10);
    const fullyReceivedApproved = await createOrder(buyer.id, vendor.id, "APPROVED", 10, 10);
    await createOrder(buyer.id, vendor.id, "DRAFT", 0);
    await createOrder(buyer.id, vendor.id, "PENDING_APPROVAL", 0);
    await createOrder(buyer.id, vendor.id, "REJECTED", 0);
    // Cancelled after partial receipt — must still be excluded.
    await createOrder(buyer.id, vendor.id, "CANCELLED", 3, 10);

    const res = await api
      .get("/api/reports/outstanding-orders")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((item: { orderId: string }) => item.orderId);
    expect(ids).toEqual([outstandingApproved.id]);
    expect(ids).not.toContain(fullyReceivedApproved.id);
  });
});
