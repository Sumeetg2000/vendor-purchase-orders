import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("GET /api/vendors/:id (T031)", () => {
  it("returns the Vendor shape for an existing vendor", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({
      data: { name: "Acme", paymentTerms: "Net 30" },
    });

    const res = await api.get(`/api/vendors/${vendor.id}`).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: vendor.id, name: "Acme", paymentTerms: "Net 30" });
  });

  it("returns 404 not_found for a nonexistent vendor", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);

    const res = await api
      .get("/api/vendors/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("rejects an unauthenticated request with 401", async () => {
    const vendor = await prisma.vendor.create({
      data: { name: "Acme", paymentTerms: "Net 30" },
    });
    const res = await api.get(`/api/vendors/${vendor.id}`);
    expect(res.status).toBe(401);
  });
});
