import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createOutstandingOrder(userId: string, vendorId: string) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      status: "APPROVED",
      submittedAt: new Date(),
      approvedAt: new Date(),
      lines: { create: [{ description: "Widget", quantity: 10, unitPrice: 5 }] },
    },
  });
}

describe("Outstanding orders filtered by vendor (T084, spec.md US5 AS2)", () => {
  it("?vendorId= returns only that vendor's outstanding orders", async () => {
    const { token: adminToken } = await createUserWithRoles("admin@test.com", [
      "PROCUREMENT_ADMIN",
    ]);
    const { user: buyer } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendorA = await prisma.vendor.create({ data: { name: "A", paymentTerms: "Net 30" } });
    const vendorB = await prisma.vendor.create({ data: { name: "B", paymentTerms: "Net 30" } });

    const orderA = await createOutstandingOrder(buyer.id, vendorA.id);
    await createOutstandingOrder(buyer.id, vendorB.id);

    const res = await api
      .get(`/api/reports/outstanding-orders?vendorId=${vendorA.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].orderId).toBe(orderA.id);
    expect(res.body.items[0].vendorId).toBe(vendorA.id);
  });
});
