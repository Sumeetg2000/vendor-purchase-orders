import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("POST /api/vendors/:id/deactivate (T032)", () => {
  it("deactivates an active vendor", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({
      data: { name: "Acme", paymentTerms: "Net 30" },
    });

    const res = await api
      .post(`/api/vendors/${vendor.id}/deactivate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it("is idempotent when the vendor is already inactive", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({
      data: { name: "Acme", paymentTerms: "Net 30", isActive: false },
    });

    const res = await api
      .post(`/api/vendors/${vendor.id}/deactivate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
  });

  it("returns 404 not_found for a nonexistent vendor", async () => {
    const { token } = await createUserWithRoles("buyer3@test.com", ["BUYER"]);

    const res = await api
      .post("/api/vendors/00000000-0000-0000-0000-000000000000/deactivate")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("rejects a non-Buyer role with 403", async () => {
    const { token } = await createUserWithRoles("approver@test.com", ["APPROVER"]);
    const vendor = await prisma.vendor.create({
      data: { name: "Acme", paymentTerms: "Net 30" },
    });

    const res = await api
      .post(`/api/vendors/${vendor.id}/deactivate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
