import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createOrder(userId: string, vendorId: string) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      lines: { create: [{ description: "x", quantity: 1, unitPrice: 1 }] },
    },
  });
}

describe("GET /api/purchase-orders (T039)", () => {
  it("lists purchase orders, filterable by vendorId and status", async () => {
    const { token, user } = await createUserWithRoles("admin@test.com", ["PROCUREMENT_ADMIN"]);
    const vendorA = await prisma.vendor.create({ data: { name: "A", paymentTerms: "Net 30" } });
    const vendorB = await prisma.vendor.create({ data: { name: "B", paymentTerms: "Net 30" } });

    await createOrder(user.id, vendorA.id);
    await createOrder(user.id, vendorB.id);

    const all = await api.get("/api/purchase-orders").set("Authorization", `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(2);

    const filtered = await api
      .get(`/api/purchase-orders?vendorId=${vendorA.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].vendorId).toBe(vendorA.id);

    const byStatus = await api
      .get("/api/purchase-orders?status=DRAFT")
      .set("Authorization", `Bearer ${token}`);
    expect(byStatus.body).toHaveLength(2);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await api.get("/api/purchase-orders");
    expect(res.status).toBe(401);
  });
});
