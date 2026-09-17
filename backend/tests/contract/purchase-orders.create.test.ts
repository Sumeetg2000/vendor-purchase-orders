import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

async function activeVendor() {
  return prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
}

describe("POST /api/purchase-orders (T038)", () => {
  it("creates a draft PO with lines and a derived total", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await activeVendor();

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [
          { description: "Widget", quantity: 3, unitPrice: 10 },
          { description: "Gadget", quantity: 2, unitPrice: 25 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.total).toBe("80.00");
    expect(res.body.orderNumber).toMatch(/^PO-\d{4}-\d{6}$/);
    expect(res.body.lines).toHaveLength(2);
    expect(res.body.lines[0]).toMatchObject({
      description: "Widget",
      quantity: 3,
      unitPrice: "10.00",
      receivedQty: 0,
      outstandingQty: 3,
    });
  });

  it("rejects an empty lines array with 400 validation_error", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await activeVendor();

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id, lines: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("rejects a missing lines field with 400 validation_error", async () => {
    const { token } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);
    const vendor = await activeVendor();

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await api.post("/api/purchase-orders").send({});
    expect(res.status).toBe(401);
  });

  it("rejects a non-Buyer role with 403", async () => {
    const { token } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
    const vendor = await activeVendor();

    const res = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId: vendor.id, lines: [{ description: "x", quantity: 1, unitPrice: 1 }] });

    expect(res.status).toBe(403);
  });
});
