import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("Pending approval above the threshold (T060, spec.md US3 AS2, FR-007)", () => {
  it("submitting an order above the threshold enters PENDING_APPROVAL, awaiting an Approver", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "Widget", quantity: 1, unitPrice: 5001 }],
      });

    const submitted = await api
      .post(`/api/purchase-orders/${created.body.id}/submit`)
      .set("Authorization", `Bearer ${token}`);

    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("PENDING_APPROVAL");
    expect(submitted.body.approvedAt).toBeNull();
  });
});
