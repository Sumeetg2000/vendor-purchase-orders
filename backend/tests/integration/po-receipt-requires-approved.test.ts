import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createOrderWithStatus(
  userId: string,
  vendorId: string,
  status: "DRAFT" | "PENDING_APPROVAL" | "CANCELLED",
) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      status,
      ...(status === "CANCELLED" ? { cancellationReason: "fixture setup" } : {}),
      lines: { create: [{ description: "Widget", quantity: 10, unitPrice: 5 }] },
    },
    include: { lines: true },
  });
}

describe("Goods receipt requires an APPROVED order (T077, spec.md US4 AS5, Edge Cases, FR-015)", () => {
  it.each([["DRAFT"], ["PENDING_APPROVAL"], ["CANCELLED"]] as const)(
    "rejects a receipt against a %s order with 409",
    async (status) => {
      const { token, user } = await createUserWithRoles(`buyer-${status}@test.com`, ["BUYER"]);
      const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
      const order = await createOrderWithStatus(user.id, vendor.id, status);
      const line = order.lines[0]!;

      const res = await api
        .post(`/api/purchase-orders/${order.id}/lines/${line.id}/receipts`)
        .set("Authorization", `Bearer ${token}`)
        .send({ quantity: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("business_rule_violation");
    },
  );
});
