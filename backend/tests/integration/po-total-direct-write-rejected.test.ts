import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe("Direct total write is rejected (T043, spec.md US2 AS3, FR-005, SC-001)", () => {
  it("rejects a client-supplied total on create with 400 validation_error", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "A", quantity: 2, unitPrice: 10 }],
        total: "999999.99",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");

    const stored = await prisma.purchaseOrder.findFirst({ where: { vendorId: vendor.id } });
    expect(stored).toBeNull();
  });

  it("rejects a client-supplied total on patch, leaving the stored total untouched", async () => {
    const { token, user } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
    const order = await prisma.purchaseOrder.create({
      data: {
        orderNumber,
        vendorId: vendor.id,
        createdBy: user.id,
        lines: { create: [{ description: "A", quantity: 2, unitPrice: 10 }] },
      },
    });

    const res = await api
      .patch(`/api/purchase-orders/${order.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ total: "1.00" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");

    const stillStored = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillStored.total.toFixed(2)).toBe("20.00");
  });
});
