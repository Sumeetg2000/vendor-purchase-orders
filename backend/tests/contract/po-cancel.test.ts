import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createApprovedOrder(userId: string, approverId: string, vendorId: string) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      status: "APPROVED",
      submittedAt: new Date(),
      approvedAt: new Date(),
      approvedBy: approverId,
      lines: { create: [{ description: "Widget", quantity: 1, unitPrice: 100 }] },
    },
  });
}

describe("POST /api/purchase-orders/:id/cancel (T058)", () => {
  it("cancels an approved order with a reason", async () => {
    const { user: buyer } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const { user: approver, token: approverToken } = await createUserWithRoles(
      "approver@test.com",
      ["APPROVER"],
    );
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrder(buyer.id, approver.id, vendor.id);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "Vendor discontinued the item" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.cancellationReason).toBe("Vendor discontinued the item");
  });

  it("rejects a missing reason with 400", async () => {
    const { user: buyer } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const { user: approver, token: approverToken } = await createUserWithRoles(
      "approver2@test.com",
      ["APPROVER"],
    );
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrder(buyer.id, approver.id, vendor.id);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("rejects cancelling a non-approved order with 409", async () => {
    const { user: buyer } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const { user: approver, token: approverToken } = await createUserWithRoles(
      "approver3@test.com",
      ["APPROVER"],
    );
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrder(buyer.id, approver.id, vendor.id);
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "DRAFT" } });

    const res = await api
      .post(`/api/purchase-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "x" });

    expect(res.status).toBe(409);
  });
});
