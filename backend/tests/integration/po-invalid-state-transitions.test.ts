import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { generateOrderNumber } from "../../src/domain/orderNumber.ts";

async function createOrderWithStatus(
  userId: string,
  vendorId: string,
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED",
) {
  const orderNumber = await prisma.$transaction((tx) => generateOrderNumber(tx));
  return prisma.purchaseOrder.create({
    data: {
      orderNumber,
      vendorId,
      createdBy: userId,
      status,
      // The reason-required CHECK constraint (T015) demands these whenever
      // status is REJECTED/CANCELLED, even for a direct test fixture insert.
      ...(status === "REJECTED" ? { rejectionReason: "fixture setup" } : {}),
      ...(status === "CANCELLED" ? { cancellationReason: "fixture setup" } : {}),
      lines: { create: [{ description: "Widget", quantity: 1, unitPrice: 100 }] },
    },
  });
}

describe("Invalid state transitions are rejected (T065, spec.md Edge Cases)", () => {
  it("rejects approving/rejecting/cancelling a Draft order", async () => {
    const { user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const draft = await createOrderWithStatus(user.id, vendor.id, "DRAFT");

    const approve = await api
      .post(`/api/purchase-orders/${draft.id}/approve`)
      .set("Authorization", `Bearer ${approverToken}`);
    expect(approve.status).toBe(409);

    const reject = await api
      .post(`/api/purchase-orders/${draft.id}/reject`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "x" });
    expect(reject.status).toBe(409);

    const cancel = await api
      .post(`/api/purchase-orders/${draft.id}/cancel`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "x" });
    expect(cancel.status).toBe(409);
  });

  it("rejects approving/rejecting an already-Approved order", async () => {
    const { user } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver2@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const approved = await createOrderWithStatus(user.id, vendor.id, "APPROVED");

    const approve = await api
      .post(`/api/purchase-orders/${approved.id}/approve`)
      .set("Authorization", `Bearer ${approverToken}`);
    expect(approve.status).toBe(409);

    const reject = await api
      .post(`/api/purchase-orders/${approved.id}/reject`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "x" });
    expect(reject.status).toBe(409);
  });

  it("rejects cancelling an already-Rejected or already-Cancelled order", async () => {
    const { user } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const { token: approverToken } = await createUserWithRoles("approver3@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const rejected = await createOrderWithStatus(user.id, vendor.id, "REJECTED");
    const cancelled = await createOrderWithStatus(user.id, vendor.id, "CANCELLED");

    const cancelRejected = await api
      .post(`/api/purchase-orders/${rejected.id}/cancel`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "x" });
    expect(cancelRejected.status).toBe(409);

    const cancelCancelled = await api
      .post(`/api/purchase-orders/${cancelled.id}/cancel`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "x" });
    expect(cancelCancelled.status).toBe(409);
  });
});
