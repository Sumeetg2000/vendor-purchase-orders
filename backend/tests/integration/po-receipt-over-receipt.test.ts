import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe("Over-receipt is rejected (T075, spec.md US4 AS3, FR-014, SC-002)", () => {
  it("rejects a receipt that would push received quantity above ordered quantity", async () => {
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

    await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 6 });

    const res = await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 7 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("business_rule_violation");

    const stillLine = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(stillLine.receivedQty).toBe(6);
  });
});
