import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe("Derived fields rejected on the goods-receipt body (T078a)", () => {
  it("rejects receivedQty/outstandingQty in the receipt body with 400 validation_error", async () => {
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

    const res = await api
      .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 4, receivedQty: 4, outstandingQty: 6 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");

    const stillLine = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(stillLine.receivedQty).toBe(0);
  });
});
