import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";

describe("Vendor duplicate names (T033, spec.md US1 AS4, FR-001)", () => {
  it("allows creating a second vendor with a name that already exists, as a distinct record", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);

    const first = await api
      .post("/api/vendors")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Supplies", paymentTerms: "Net 30" });
    expect(first.status).toBe(201);

    const second = await api
      .post("/api/vendors")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Acme Supplies", paymentTerms: "Net 60" });

    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.name).toBe("Acme Supplies");
    expect(second.body.paymentTerms).toBe("Net 60");
  });
});
