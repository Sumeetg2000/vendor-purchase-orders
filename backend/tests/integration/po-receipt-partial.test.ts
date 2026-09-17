import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe("Partial and multiple goods receipts (T074, spec.md US4 AS1/AS2)", () => {
  it("a partial receipt updates receivedQty/outstandingQty; a second accumulates correctly", async () => {
    const { token, user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
    const order = await prisma.purchaseOrder.create({
      data: {
        orderNumber,
        vendorId: vendor.id,
        createdBy: user.id,
        status: "APPROVED",
        submittedAt: new Date(),
        approvedAt: new Date(),
        lines: { create: [{ description: "Widget", quantity: 10, unitPrice: 5 }] },
      },
      include: { lines: true },
    });
    const line = order.lines[0]!;

    const first = await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 4 });
    expect(first.body.line).toEqual({ receivedQty: 4, outstandingQty: 6 });

    const second = await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 6 });
    expect(second.body.line).toEqual({ receivedQty: 10, outstandingQty: 0 });

    const refetched = await api
      .get(`/api/purchase-orders/${order.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(refetched.body.lines[0]).toMatchObject({ receivedQty: 10, outstandingQty: 0 });
  });
});
