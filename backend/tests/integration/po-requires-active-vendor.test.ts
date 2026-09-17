import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("PO creation requires an active vendor (T047, spec.md US1 AS3, FR-002)", () => {
  it("rejects creation against a nonexistent vendor before any order is created", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: "00000000-0000-0000-0000-000000000000",
        lines: [{ description: "A", quantity: 1, unitPrice: 1 }],
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("business_rule_violation");
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it("rejects creation against a deactivated vendor before any order is created", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({
      data: { name: "Inactive Co", paymentTerms: "Net 30", isActive: false },
    });

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "A", quantity: 1, unitPrice: 1 }],
      });

    expect(res.status).toBe(409);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });
});
