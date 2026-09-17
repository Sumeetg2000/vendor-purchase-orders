import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe("Derived line fields rejected as input (T043a)", () => {
  it("rejects receivedQty on a create-PO line with 400 validation_error", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "A", quantity: 2, unitPrice: 10, receivedQty: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("rejects outstandingQty on a patch-PO line with 400 validation_error", async () => {
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
      .send({ lines: [{ description: "A", quantity: 2, unitPrice: 10, outstandingQty: 99 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
