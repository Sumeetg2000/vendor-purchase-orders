import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("GET /api/purchase-orders/:id/audit-log (T091, api-contract.md)", () => {
  it("returns a chronological AuditLogEntry[] for the order", async () => {
    const { token, user } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "Widget", quantity: 5, unitPrice: 10 }],
      });

    const res = await api
      .get(`/api/purchase-orders/${created.body.id}/audit-log`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({
      actorType: "USER",
      actorUserId: user.id,
      action: "PO_CREATED",
      entityType: "PurchaseOrder",
      entityId: created.body.id,
    });
    // Chronological order: timestamps non-decreasing.
    const timestamps = res.body.map((entry: { createdAt: string }) =>
      new Date(entry.createdAt).getTime(),
    );
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("returns 404 for a purchase order that doesn't exist", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const res = await api
      .get("/api/purchase-orders/00000000-0000-0000-0000-000000000000/audit-log")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const { token } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [{ description: "Widget", quantity: 5, unitPrice: 10 }],
      });

    const res = await api.get(`/api/purchase-orders/${created.body.id}/audit-log`);
    expect(res.status).toBe(401);
  });
});
