import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

/**
 * T093: an auto-approved (below-threshold) order's audit log contains both a
 * PO_SUBMITTED (actorType: USER) entry and a PO_APPROVED (actorType: SYSTEM,
 * actorUserId: null) entry (data-model.md "When SYSTEM is used").
 */
describe("Audit log records SYSTEM actor for auto-approval (T093)", () => {
  it("records PO_APPROVED with actorType SYSTEM and actorUserId null", async () => {
    const { token, user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id, lines: [{ description: "Pens", quantity: 10, unitPrice: 1 }] });
    const orderId = created.body.id;

    await api
      .post(`/api/purchase-orders/${orderId}/submit`)
      .set("Authorization", `Bearer ${token}`);

    const res = await api
      .get(`/api/purchase-orders/${orderId}/audit-log`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const submitted = res.body.find((entry: { action: string }) => entry.action === "PO_SUBMITTED");
    const approved = res.body.find((entry: { action: string }) => entry.action === "PO_APPROVED");

    expect(submitted).toMatchObject({ actorType: "USER", actorUserId: user.id });
    expect(approved).toMatchObject({ actorType: "SYSTEM", actorUserId: null });
  });
});
