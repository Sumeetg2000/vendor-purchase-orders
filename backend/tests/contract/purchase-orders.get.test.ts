import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe("GET /api/purchase-orders/:id (T040)", () => {
  it("returns the PurchaseOrder shape with lines", async () => {
    const { token, user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
    const order = await prisma.purchaseOrder.create({
      data: {
        orderNumber,
        vendorId: vendor.id,
        createdBy: user.id,
        lines: { create: [{ description: "Widget", quantity: 2, unitPrice: 5 }] },
      },
    });

    const res = await api
      .get(`/api/purchase-orders/${order.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(order.id);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.total).toBe("10.00");
  });

  it("returns 404 not_found for a nonexistent order", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);

    const res = await api
      .get("/api/purchase-orders/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
