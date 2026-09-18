import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

/**
 * T092: FR-019's required minimum (spec.md, SC-005) — every PO creation,
 * approval decision (approve/reject), cancellation, and goods receipt
 * produces a structured audit record identifying actor, action, target, and
 * timestamp. Exercises the full lifecycle through the real HTTP surface (not
 * the service layer directly) and asserts on `GET .../audit-log` (T095).
 */
describe("Audit trail required minimum (T092, FR-019, SC-005)", () => {
  it("records PO_CREATED, PO_SUBMITTED, PO_REJECTED for an above-threshold order", async () => {
    const { token: buyerToken, user: buyer } = await createUserWithRoles("buyer@test.com", [
      "BUYER",
    ]);
    const { token: approverToken, user: approver } = await createUserWithRoles(
      "approver@test.com",
      ["APPROVER"],
    );
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "Server", quantity: 2, unitPrice: 5000 }],
      });
    const orderId = created.body.id;

    await api
      .post(`/api/purchase-orders/${orderId}/submit`)
      .set("Authorization", `Bearer ${buyerToken}`);
    await api
      .post(`/api/purchase-orders/${orderId}/reject`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "Budget not approved" });

    const res = await api
      .get(`/api/purchase-orders/${orderId}/audit-log`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    const actions = res.body.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(["PO_CREATED", "PO_SUBMITTED", "PO_REJECTED"]);

    for (const entry of res.body) {
      expect(entry).toHaveProperty("actorType");
      expect(entry).toHaveProperty("action");
      expect(entry.entityType).toBe("PurchaseOrder");
      expect(entry.entityId).toBe(orderId);
      expect(entry).toHaveProperty("createdAt");
    }
    expect(res.body[0].actorUserId).toBe(buyer.id);
    expect(res.body[2].actorUserId).toBe(approver.id);
  });

  it("records PO_CANCELLED for a below-threshold (auto-approved) order", async () => {
    const { token: buyerToken } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const { token: approverToken, user: approver } = await createUserWithRoles(
      "approver2@test.com",
      ["APPROVER"],
    );
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ vendorId: vendor.id, lines: [{ description: "Pens", quantity: 10, unitPrice: 1 }] });
    const orderId = created.body.id;

    await api
      .post(`/api/purchase-orders/${orderId}/submit`)
      .set("Authorization", `Bearer ${buyerToken}`);
    const cancelRes = await api
      .post(`/api/purchase-orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${approverToken}`)
      .send({ reason: "No longer needed" });
    expect(cancelRes.status).toBe(200);

    const res = await api
      .get(`/api/purchase-orders/${orderId}/audit-log`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    const actions = res.body.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual(["PO_CREATED", "PO_SUBMITTED", "PO_APPROVED", "PO_CANCELLED"]);
    expect(res.body[3].actorUserId).toBe(approver.id);
  });

  it("records GOODS_RECEIPT_RECORDED when goods are received against an approved order", async () => {
    const { token: buyerToken, user: buyer } = await createUserWithRoles("buyer3@test.com", [
      "BUYER",
    ]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "Widgets", quantity: 10, unitPrice: 2 }],
      });
    const orderId = created.body.id;
    const lineId = created.body.lines[0].id;

    await api
      .post(`/api/purchase-orders/${orderId}/submit`)
      .set("Authorization", `Bearer ${buyerToken}`);
    await api
      .post(`/api/purchase-orders/${orderId}/lines/${lineId}/receipts`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ quantity: 4 });

    const res = await api
      .get(`/api/purchase-orders/${orderId}/audit-log`)
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    const actions = res.body.map((entry: { action: string }) => entry.action);
    expect(actions).toEqual([
      "PO_CREATED",
      "PO_SUBMITTED",
      "PO_APPROVED",
      "GOODS_RECEIPT_RECORDED",
    ]);
    const receiptEntry = res.body[3];
    expect(receiptEntry.actorUserId).toBe(buyer.id);
    expect(receiptEntry.entityType).toBe("PurchaseOrderLine");
    expect(receiptEntry.entityId).toBe(lineId);
  });
});
