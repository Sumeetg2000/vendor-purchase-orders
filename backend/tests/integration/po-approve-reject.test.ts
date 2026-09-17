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

describe("Approve/reject a pending order (T062, spec.md US3 AS3/AS4, FR-010)", () => {
  it("an Approver approving moves the order to APPROVED", async () => {
    const { user: buyer } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createPendingOrder(buyer.id, vendor.id);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${approverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
  });

  it("an Approver rejecting with a reason moves the order to REJECTED and stores the reason", async () => {
    const { user: buyer } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver2@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createPendingOrder(buyer.id, vendor.id);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/reject`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "Budget exceeded" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REJECTED");
    expect(res.body.rejectionReason).toBe("Budget exceeded");
  });

  it("rejecting without a reason is refused with 400 and the order stays pending", async () => {
    const { user: buyer } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver3@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createPendingOrder(buyer.id, vendor.id);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/reject`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({});

    expect(res.status).toBe(400);

    const stillPending = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillPending.status).toBe("PENDING_APPROVAL");
  });
});
