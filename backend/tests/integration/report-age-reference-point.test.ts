import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe("ageDays is computed from submittedAt, not approvedAt (T085, spec.md US5 AS3, research.md §13)", () => {
  it("an order submitted 10 days ago but approved just now shows ~10 days of age, not ~0", async () => {
    const { token: adminToken } = await createUserWithRoles("admin@test.com", [
      "PROCUREMENT_ADMIN",
    ]);
    const { user: buyer } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
    const order = await prisma.purchaseOrder.create({
      data: {
        orderNumber,
        vendorId: vendor.id,
        createdBy: buyer.id,
        status: "APPROVED",
        submittedAt: tenDaysAgo,
        approvedAt: new Date(), // approved just now — a week+ after submission
        lines: { create: [{ description: "Widget", quantity: 10, unitPrice: 5 }] },
      },
    });

    const res = await api
      .get("/api/reports/outstanding-orders")
      .set("Authorization", `Bearer ${adminToken}`);

    const item = res.body.items.find((i: { orderId: string }) => i.orderId === order.id);
    expect(item).toBeDefined();
    // Allow a small tolerance for test execution time / day-boundary rounding.
    expect(item.ageDays).toBeGreaterThanOrEqual(9);
    expect(item.ageDays).toBeLessThanOrEqual(10);
  });
});
