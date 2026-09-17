import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe("Concurrent receipts never exceed ordered quantity (T076, spec.md US4 AS4, FR-014, SC-002)", () => {
  it("exactly one of two concurrent receipts succeeds when only one fits", async () => {
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
        // 6 outstanding; two concurrent receipts of 4 and 3 sum to 7 > 6.
        lines: { create: [{ description: "Widget", quantity: 6, unitPrice: 5 }] },
      },
      include: { lines: true },
    });
    const line = order.lines[0]!;

    const [first, second] = await Promise.all([
      api
        .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
        .set("Authorization", `Bearer ${token}`)
        .send({ quantity: 4 }),
      api
        .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
        .set("Authorization", `Bearer ${token}`)
        .send({ quantity: 3 }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const finalLine = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(finalLine.receivedQty).toBeLessThanOrEqual(finalLine.quantity);
    expect(finalLine.receivedQty === 4 || finalLine.receivedQty === 3).toBe(true);
  });
});
