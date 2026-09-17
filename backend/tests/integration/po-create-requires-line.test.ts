import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("PO creation requires at least one line (T044, spec.md US2 AS6, FR-003)", () => {
  it("rejects an empty lines array before any order is created", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id, lines: [] });

    expect(res.status).toBe(400);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it("rejects a missing lines field before any order is created", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id });

    expect(res.status).toBe(400);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });
});
