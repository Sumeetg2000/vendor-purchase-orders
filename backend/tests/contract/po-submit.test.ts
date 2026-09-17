import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createDraftOrder(userId: string, vendorId: string, unitPrice: number) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      lines: { create: [{ description: "Widget", quantity: 1, unitPrice }] },
    },
  });
}

describe("POST /api/purchase-orders/:id/submit (T055)", () => {
  it("auto-approves an order at/below the threshold", async () => {
    const { token, user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createDraftOrder(user.id, vendor.id, 5000);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/submit`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.submittedAt).not.toBeNull();
    expect(res.body.approvedAt).not.toBeNull();
  });

  it("enters PENDING_APPROVAL above the threshold", async () => {
    const { token, user } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createDraftOrder(user.id, vendor.id, 5001);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/submit`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING_APPROVAL");
    expect(res.body.submittedAt).not.toBeNull();
    expect(res.body.approvedAt).toBeNull();
  });

  it("rejects submitting an already-submitted order with 409", async () => {
    const { token, user } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createDraftOrder(user.id, vendor.id, 100);
    await api
      .post(`/api/purchase-orders/${order.id}/submit`)
      .set("Authorization", `Bearer ${token}`);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/submit`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("business_rule_violation");
  });

  it("returns 404 for a nonexistent order", async () => {
    const { token } = await createUserWithRoles("buyer4@test.com", ["BUYER"]);
    const res = await api
      .post("/api/purchase-orders/00000000-0000-0000-0000-000000000000/submit")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("rejects a non-Buyer role with 403", async () => {
    const { user } = await createUserWithRoles("buyer5@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createDraftOrder(user.id, vendor.id, 100);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/submit`)
      .set("Authorization", `Bearer ${approverToken}`);
    expect(res.status).toBe(403);
  });
});
