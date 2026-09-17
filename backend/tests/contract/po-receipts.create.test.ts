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

describe("POST /api/purchase-orders/:id/lines/:lineId/receipts (T072)", () => {
  it("records a receipt and returns the line's updated receivedQty/outstandingQty", async () => {
    const { token, user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrderWithLine(user.id, vendor.id, 10);
    const line = order.lines[0]!;

    const res = await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 4 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      quantity: 4,
      receivedBy: user.id,
      line: { receivedQty: 4, outstandingQty: 6 },
    });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.receivedAt).toEqual(expect.any(String));
  });

  it("rejects a receipt against a non-APPROVED order with 409", async () => {
    const { token, user } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrderWithLine(user.id, vendor.id, 10);
    await prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: "DRAFT" } });
    const line = order.lines[0]!;

    const res = await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("business_rule_violation");
  });

  it("rejects a zero/negative quantity with 400", async () => {
    const { token, user } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrderWithLine(user.id, vendor.id, 10);
    const line = order.lines[0]!;

    const res = await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 0 });

    expect(res.status).toBe(400);
  });

  it("returns 404 for a nonexistent line", async () => {
    const { token, user } = await createUserWithRoles("buyer4@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrderWithLine(user.id, vendor.id, 10);

    const res = await api
      .post(`/api/purchase-orders/${order.id}/lines/00000000-0000-0000-0000-000000000000/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 1 });

    expect(res.status).toBe(404);
  });

  it("rejects a non-Buyer role with 403", async () => {
    const { user } = await createUserWithRoles("buyer5@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const order = await createApprovedOrderWithLine(user.id, vendor.id, 10);
    const line = order.lines[0]!;

    const res = await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ quantity: 1 });

    expect(res.status).toBe(403);
  });
});
