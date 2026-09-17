import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

describe(
  "The buyer who raised an order cannot approve it, even holding the Approver role " +
    "(T063, spec.md US3 AS8, FR-010a, SC-007)",
  () => {
    it("rejects approval when the caller's id equals the order's createdBy — an identity check, not a role check", async () => {
      // A single user holding BOTH Buyer and Approver roles, matching
      // quickstart.md's seeded Buyer+Approver fixture — this is what makes
      // the segregation-of-duties rule meaningfully testable at all.
      const { user, token } = await createUserWithRoles("buyer-approver@test.com", [
        "BUYER",
        "APPROVER",
      ]);
      const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

      const created = await api
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          vendorId: vendor.id,
          lines: [{ description: "Widget", quantity: 1, unitPrice: 5001 }],
        });
      await api
        .post(`/api/purchase-orders/${created.body.id}/submit`)
        .set("Authorization", `Bearer ${token}`);

      const res = await api
        .post(`/api/purchase-orders/${created.body.id}/approve`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("business_rule_violation");

      const stillPending = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(stillPending.status).toBe("PENDING_APPROVAL");
      expect(stillPending.createdBy).toBe(user.id);
    });

    it("a different Approver can still approve the same order", async () => {
      const { token: buyerApproverToken } = await createUserWithRoles("buyer-approver2@test.com", [
        "BUYER",
        "APPROVER",
      ]);
      const { token: otherApproverToken } = await createUserWithRoles("other-approver@test.com", [
        "APPROVER",
      ]);
      const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

      const created = await api
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${buyerApproverToken}`)
        .send({
          vendorId: vendor.id,
          lines: [{ description: "Widget", quantity: 1, unitPrice: 5001 }],
        });
      await api
        .post(`/api/purchase-orders/${created.body.id}/submit`)
        .set("Authorization", `Bearer ${buyerApproverToken}`);

      const res = await api
        .post(`/api/purchase-orders/${created.body.id}/approve`)
        .set("Authorization", `Bearer ${otherApproverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("APPROVED");
    });
  },
);
