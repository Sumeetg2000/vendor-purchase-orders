import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("GET /api/vendors (T030)", () => {
  it("lists vendors, and supports ?active=true|false filtering", async () => {
    const { token } = await createUserWithRoles("admin@test.com", ["PROCUREMENT_ADMIN"]);

    const active = await prisma.vendor.create({
      data: { name: "Active Vendor", paymentTerms: "Net 30" },
    });
    const inactive = await prisma.vendor.create({
      data: { name: "Inactive Vendor", paymentTerms: "Net 60", isActive: false },
    });

    const all = await api.get("/api/vendors").set("Authorization", `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(2);

    const onlyActive = await api
      .get("/api/vendors?active=true")
      .set("Authorization", `Bearer ${token}`);
    expect(onlyActive.body.map((v: { id: string }) => v.id)).toEqual([active.id]);

    const onlyInactive = await api
      .get("/api/vendors?active=false")
      .set("Authorization", `Bearer ${token}`);
    expect(onlyInactive.body.map((v: { id: string }) => v.id)).toEqual([inactive.id]);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await api.get("/api/vendors");
    expect(res.status).toBe(401);
  });
});
