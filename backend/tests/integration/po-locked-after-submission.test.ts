import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe(
  "A submitted order is locked against edits (T061, spec.md US3 AS5, FR-008/FR-009) — " +
    "the direct mid-approval-threshold-crossing answer (quickstart.md Scenario 3 step 3)",
  () => {
    it("rejects PATCHing a PENDING_APPROVAL order's lines — including an attempt that would push its total below the threshold", async () => {
      const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
      const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

      const created = await api
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          vendorId: vendor.id,
          lines: [{ description: "Widget", quantity: 1, unitPrice: 5001 }],
        });
      const submitted = await api
        .post(`/api/purchase-orders/${created.body.id}/submit`)
        .set("Authorization", `Bearer ${token}`);
      expect(submitted.body.status).toBe("PENDING_APPROVAL");

      // Attempt to push the total back under the threshold — there is no
      // edit path on a Pending Approval order at all, so this can never
      // actually happen; it must be rejected outright, not silently ignored.
      const res = await api
        .patch(`/api/purchase-orders/${created.body.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ lines: [{ description: "Widget", quantity: 1, unitPrice: 1 }] });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("business_rule_violation");

      const stillPending = await api
        .get(`/api/purchase-orders/${created.body.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(stillPending.body.status).toBe("PENDING_APPROVAL");
      expect(stillPending.body.total).toBe("5001.00");
    });

    it("rejects PATCHing an APPROVED order's lines/vendor", async () => {
      const { token } = await createUserWithRoles("buyer2@test.com", ["BUYER"]);
      const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

      const created = await api
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          vendorId: vendor.id,
          lines: [{ description: "Widget", quantity: 1, unitPrice: 100 }],
        });
      await api
        .post(`/api/purchase-orders/${created.body.id}/submit`)
        .set("Authorization", `Bearer ${token}`);

      const res = await api
        .patch(`/api/purchase-orders/${created.body.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ lines: [{ description: "Widget", quantity: 5, unitPrice: 100 }] });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("business_rule_violation");
    });
  },
);
