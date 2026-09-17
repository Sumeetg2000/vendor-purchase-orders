import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

describe(
  "Two concurrent approval requests on the same pending order (T066, spec.md Edge Cases, " +
    "Constitution Principle V)",
  () => {
    it("records exactly one approval decision; the other is rejected", async () => {
      const { user: buyer } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
      const { token: approverToken } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
      const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
      const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
      const order = await prisma.purchaseOrder.create({
        data: {
          orderNumber,
          vendorId: vendor.id,
          createdBy: buyer.id,
          status: "PENDING_APPROVAL",
          submittedAt: new Date(),
          lines: { create: [{ description: "Widget", quantity: 1, unitPrice: 5001 }] },
        },
      });

      const [first, second] = await Promise.all([
        api
          .post(`/api/purchase-orders/${order.id}/approve`)
          .set("Authorization", `Bearer ${approverToken}`),
        api
          .post(`/api/purchase-orders/${order.id}/approve`)
          .set("Authorization", `Bearer ${approverToken}`),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const final = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(final.status).toBe("APPROVED");
    });
  },
);
