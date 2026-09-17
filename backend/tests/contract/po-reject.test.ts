import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createPendingOrder(userId: string, vendorId: string) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      status: "PENDING_APPROVAL",
      submittedAt: new Date(),
      lines: { create: [{ description: "Widget", quantity: 1, unitPrice: 5001 }] },
    },
  });
}

describe("POST /api/purchase-orders/:id/reject (T057)", () => {
  it("rejects a pending order with a reason", async () => {
    const { user: buyer } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createPendingOrder(buyer.id, vendor.id);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/reject`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "Over budget" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REJECTED");
    expect(res.body.rejectionReason).toBe("Over budget");
  });

  it("rejects a missing reason with 400", async () => {
    const { user: buyer } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver2@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createPendingOrder(buyer.id, vendor.id);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/reject`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("rejects rejecting a non-pending order with 409", async () => {
    const { user: buyer } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver3@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createPendingOrder(buyer.id, vendor.id);
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "DRAFT" } });

    const res = await api
      .post(`/api/purchase-orders/${order.id}/reject`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "x" });

    expect(res.status).toBe(409);
  });
});
