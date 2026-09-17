import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createApprovedOrderWithLine(userId: string, vendorId: string, quantity: number) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      status: "APPROVED",
      submittedAt: new Date(),
      approvedAt: new Date(),
      lines: { create: [{ description: "Widget", quantity, unitPrice: 10 }] },
    },
    include: { lines: true },
  });
}

describe("GET /api/purchase-orders/:id/lines/:lineId/receipts (T073)", () => {
  it("lists goods receipt events for a line in chronological order", async () => {
    const { token, user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrderWithLine(user.id, vendor.id, 10);
    const line = order.lines[0]!;

    await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 3 });
    await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 2 });

    const res = await api
      .get(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((e: { quantity: number }) => e.quantity)).toEqual([3, 2]);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { user } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrderWithLine(user.id, vendor.id, 10);
    const line = order.lines[0]!;

    const res = await api.get(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`);
    expect(res.status).toBe(401);
  });
});
