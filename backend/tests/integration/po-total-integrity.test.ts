import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe("Purchase order total integrity (T042, spec.md US2 AS1/AS2)", () => {
  it("total always equals sum(quantity * unitPrice) across create and line edits", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const created = await api
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId: vendor.id,
        lines: [
          { description: "A", quantity: 3, unitPrice: 10 },
          { description: "B", quantity: 2, unitPrice: 25 },
        ],
      });
    expect(created.body.total).toBe("80.00");

    const added = await api
      .patch(`/api/purchase-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          { description: "A", quantity: 3, unitPrice: 10 },
          { description: "B", quantity: 2, unitPrice: 25 },
          { description: "C", quantity: 1, unitPrice: 5 },
        ],
      });
    expect(added.body.total).toBe("85.00");

    const edited = await api
      .patch(`/api/purchase-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          { description: "A", quantity: 5, unitPrice: 10 },
          { description: "B", quantity: 2, unitPrice: 25 },
          { description: "C", quantity: 1, unitPrice: 5 },
        ],
      });
    expect(edited.body.total).toBe("105.00");

    const removed = await api
      .patch(`/api/purchase-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ description: "A", quantity: 5, unitPrice: 10 }] });
    expect(removed.body.total).toBe("50.00");

    const refetched = await api
      .get(`/api/purchase-orders/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(refetched.body.total).toBe("50.00");
  });
});
