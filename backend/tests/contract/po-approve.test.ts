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

describe("POST /api/purchase-orders/:id/approve (T056)", () => {
  it("approves a pending order raised by a different user", async () => {
    const { user: buyer } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createPendingOrder(buyer.id, vendor.id);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${approverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.approvedAt).not.toBeNull();
  });

  it("rejects approving a non-pending order with 409", async () => {
    const { user: buyer } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver2@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createPendingOrder(buyer.id, vendor.id);
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "DRAFT" } });

    const res = await api
      .post(`/api/purchase-orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${approverToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("business_rule_violation");
  });

  it("returns 404 for a nonexistent order", async () => {
    const { token } = await createUserWithRoles("approver3@test.com", ["APPROVER"]);
    const res = await api
      .post("/api/purchase-orders/00000000-0000-0000-0000-000000000000/approve")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("rejects a non-Approver role with 403", async () => {
    const { user: buyer, token: buyerToken } = await createUserWithRoles("buyer3@test.com", [
      "BUYER",
    ]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createPendingOrder(buyer.id, vendor.id);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/approve`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });
});
