import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("Purchase order numbers are unique, human-readable, and race-safe (T048, FR-003a, research.md §7)", () => {
  it("assigns a PO-YYYY-NNNNNN order number", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id, lines: [{ description: "A", quantity: 1, unitPrice: 1 }] });

    expect(res.body.orderNumber).toMatch(/^PO-\d{4}-\d{6}$/);
  });

  it("never assigns the same order number under concurrent creates", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const body = { vendorId: vendor.id, lines: [{ description: "A", quantity: 1, unitPrice: 1 }] };
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        api.post("/api/purchase-orders").set("Authorization", `Bearer ${token}`).send(body),
      ),
    );

    for (const res of results) {
      expect(res.status).toBe(201);
    }
    const orderNumbers = results.map((r) => r.body.orderNumber);
    expect(new Set(orderNumbers).size).toBe(10);
  });
});
