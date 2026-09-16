import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";

describe("POST /api/vendors (T029)", () => {
  it("creates a vendor and returns the Vendor shape (api-contract.md)", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);

    const res = await api.post("/api/vendors").set("Authorization", `Bearer ${token}`).send({
      name: "Acme Supplies",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
      contactPhone: "555-0100",
      paymentTerms: "Net 30",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Acme Supplies",
      contactName: "Jane Doe",
      contactEmail: "jane@acme.test",
      contactPhone: "555-0100",
      paymentTerms: "Net 30",
      isActive: true,
    });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.createdAt).toEqual(expect.any(String));
  });

  it("rejects a missing required field with 400 validation_error", async () => {
    const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);

    const res = await api
      .post("/api/vendors")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No Payment Terms" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await api.post("/api/vendors").send({ name: "X", paymentTerms: "Net 30" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-Buyer role with 403", async () => {
    const { token } = await createUserWithRoles("approver@test.com", ["APPROVER"]);

    const res = await api
      .post("/api/vendors")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "X", paymentTerms: "Net 30" });

    expect(res.status).toBe(403);
  });
});
