import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("Line item validation (T046, spec.md US2 AS5, FR-004)", () => {
  it("rejects a negative quantity before any order or line is created", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id, lines: [{ description: "A", quantity: -1, unitPrice: 10 }] });

    expect(res.status).toBe(400);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it("rejects a zero quantity", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id, lines: [{ description: "A", quantity: 0, unitPrice: 10 }] });

    expect(res.status).toBe(400);
  });

  it("rejects a negative unit price", async () => {
    const { token } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id, lines: [{ description: "A", quantity: 1, unitPrice: -5 }] });

    expect(res.status).toBe(400);
  });
});
