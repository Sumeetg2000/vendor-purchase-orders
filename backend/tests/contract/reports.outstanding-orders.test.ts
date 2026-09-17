import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createApprovedOutstandingOrder(userId: string, vendorId: string) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      status: "APPROVED",
      submittedAt: new Date(),
      approvedAt: new Date(),
      lines: { create: [{ description: "Widget", quantity: 10, unitPrice: 5 }] },
    },
  });
}

describe("GET /api/reports/outstanding-orders (T082)", () => {
  it("returns the paginated outstanding-orders shape", async () => {
    const { token: adminToken } = await createUserWithRoles("admin@test.com", [
      "PROCUREMENT_ADMIN",
    ]);
    const { user: buyer } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    await createApprovedOutstandingOrder(buyer.id, vendor.id);

    const res = await api
      .get("/api/reports/outstanding-orders")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 50, total: 1 });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      vendorId: vendor.id,
      vendorName: "Acme",
      status: "APPROVED",
      total: "50.00",
    });
    expect(res.body.items[0].ageDays).toEqual(expect.any(Number));
    expect(res.body.items[0].outstandingLines).toHaveLength(1);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await api.get("/api/reports/outstanding-orders");
    expect(res.status).toBe(401);
  });

  it("rejects a non-Procurement-Admin role with 403", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const res = await api
      .get("/api/reports/outstanding-orders")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
