import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("Auto-approval at/below the threshold (T059, spec.md US3 AS1, FR-007)", () => {
  it("submitting an order at the threshold auto-approves it immediately, with no manual approval step", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "Widget", quantity: 1, unitPrice: 5000 }],
      });

    const submitted = await api
      .post(`/api/purchase-orders/${created.body.id}/submit`)
      .set("Authorization", `Bearer ${token}`);

    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("APPROVED");
    expect(submitted.body.approvedBy).toBeNull();
  });
});
