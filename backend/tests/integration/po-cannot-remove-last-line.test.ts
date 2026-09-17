import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe("A draft cannot be edited down to zero lines (T045, spec.md US2 AS4, FR-004)", () => {
  it("rejects PATCHing lines: [] on a single-line draft, leaving the original line intact", async () => {
    const { token, user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
    const order = await prisma.purchaseOrder.create({
      data: {
        orderNumber,
        vendorId: vendor.id,
        createdBy: user.id,
        lines: { create: [{ description: "Only Line", quantity: 1, unitPrice: 1 }] },
      },
    });

    const res = await api
      .patch(`/api/purchase-orders/${order.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [] });

    expect(res.status).toBe(400);

    const lines = await prisma.purchaseOrderLine.findMany({
      where: { purchaseOrderId: order.id },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toBe("Only Line");
  });
});
