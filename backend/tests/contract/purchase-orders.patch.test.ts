import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createDraftOrder(userId: string, vendorId: string) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      lines: { create: [{ description: "Widget", quantity: 2, unitPrice: 5 }] },
    },
  });
}

describe("PATCH /api/purchase-orders/:id (T041)", () => {
  it("replaces the line set on a draft order and recomputes the total", async () => {
    const { token, user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createDraftOrder(user.id, vendor.id);

    const res = await api
      .patch(`/api/purchase-orders/${order.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ description: "New Widget", quantity: 4, unitPrice: 10 }] });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe("40.00");
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].description).toBe("New Widget");
  });

  it("rejects editing a non-DRAFT order with 409", async () => {
    const { token, user } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createDraftOrder(user.id, vendor.id);
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "APPROVED" } });

    const res = await api
      .patch(`/api/purchase-orders/${order.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ description: "x", quantity: 1, unitPrice: 1 }] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("business_rule_violation");
  });

  it("rejects a non-Buyer role with 403", async () => {
    const { user } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createDraftOrder(user.id, vendor.id);

    const res = await api
      .patch(`/api/purchase-orders/${order.id}`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ lines: [{ description: "x", quantity: 1, unitPrice: 1 }] });

    expect(res.status).toBe(403);
  });
});
