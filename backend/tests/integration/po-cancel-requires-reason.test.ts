import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("Cancellation requires a reason, distinct from any rejection reason (T064, spec.md US3 AS6/AS7, FR-011)", () => {
  it("rejects cancelling without a reason with 400, order stays APPROVED", async () => {
    const { token } = await createUserWithRoles("buyer-approver@test.com", ["BUYER", "APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "Widget", quantity: 1, unitPrice: 100 }],
      });
    await api
      .post(`/api/purchase-orders/${created.body.id}/submit`)
      .set("Authorization", `Bearer ${token}`);

    const res = await api
      .post(`/api/purchase-orders/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);

    const stillApproved = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(stillApproved.status).toBe("APPROVED");
  });

  it("stores the cancellation reason in a column distinct from rejection_reason", async () => {
    const { token } = await createUserWithRoles("buyer-approver2@test.com", ["BUYER", "APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "Widget", quantity: 1, unitPrice: 100 }],
      });
    await api
      .post(`/api/purchase-orders/${created.body.id}/submit`)
      .set("Authorization", `Bearer ${token}`);

    const res = await api
      .post(`/api/purchase-orders/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "No longer needed" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.cancellationReason).toBe("No longer needed");
    expect(res.body.rejectionReason).toBeNull();
  });
});
