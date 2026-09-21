import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";

/**
 * FR-008: once a purchase order leaves DRAFT, it is locked against further
 * edits. `editDraftOrder` used to check status via a plain unlocked read and
 * then write lines unconditionally, with no re-check at write time — so a
 * concurrent `submit` could commit in the gap and the edit would still land
 * on an order that had already left DRAFT, silently mutating the total of an
 * order that was supposed to be locked.
 *
 * With the fix (the order row locked via `SELECT ... FOR UPDATE` for the
 * duration of the edit transaction), the two requests serialize on that
 * lock. Two orderings are legitimate, depending on which one truly commits
 * first:
 *   (a) the edit's lock wins first and commits (order stays DRAFT, lines
 *       updated) — the blocked submit then re-evaluates and correctly
 *       submits the newly-edited draft.
 *   (b) submit's write wins first and commits (order leaves DRAFT) — the
 *       edit's later lock acquisition then sees the non-DRAFT status and is
 *       rejected with the existing "locked" error.
 * What must never happen is the corrupted case the bug allowed: submit locks
 * in one total/lines snapshot in its response, and a trailing edit still
 * manages to change the lines afterward — i.e. whatever submit's response
 * reports as the final total must still match the truly-final persisted
 * state.
 *
 * A single (edit, submit) pair raced via `Promise.all` essentially never
 * reproduces the pre-fix bug in practice — going through Express's full
 * middleware chain adds enough of a timing gap before either transaction's
 * first query that submit (a single lightweight statement) reliably
 * completes and commits well before edit's unlocked read even runs,
 * regardless of the edit's payload size (verified empirically: 0 hits in
 * 270+ single-pair trials, including with 250-line orders). Firing many
 * independent (edit, submit) pairs in one batch, however, reliably
 * reproduces it (empirically ~20% of pairs, i.e. a near-certainty across a
 * batch of 20) — real concurrent load, not one isolated race, is what this
 * guards against, so a batch is also the more representative reproduction.
 */
describe("PATCH vs. submit race never lets an edit land on a non-draft order (FR-008)", () => {
  it("never lets a locked order's total silently drift via a raced edit, across a batch of concurrent pairs", async () => {
    const { token } = await createUserWithRoles("buyer@test.com", ["BUYER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });

    const PAIR_COUNT = 20;
    const originalLines = Array.from({ length: 15 }, (_, i) => ({
      description: `Original widget ${i}`,
      quantity: 1,
      unitPrice: 10,
    }));
    const editedLines = Array.from({ length: 15 }, (_, i) => ({
      description: `Edited widget ${i}`,
      quantity: 5,
      unitPrice: 50,
    }));

    const orderIds: string[] = [];
    for (let i = 0; i < PAIR_COUNT; i++) {
      const created = await api
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({ vendorId: vendor.id, lines: originalLines });
      expect(created.status).toBe(201);
      orderIds.push(created.body.id);
    }

    const results = await Promise.all(
      orderIds.map(async (orderId) => {
        const [patchRes, submitRes] = await Promise.all([
          api
            .patch(`/api/purchase-orders/${orderId}`)
            .set("Authorization", `Bearer ${token}`)
            .send({ lines: editedLines }),
          api.post(`/api/purchase-orders/${orderId}/submit`).set("Authorization", `Bearer ${token}`),
        ]);
        return { orderId, patchRes, submitRes };
      }),
    );

    for (const { orderId, patchRes, submitRes } of results) {
      // A single-line-item-or-more draft is always submittable, regardless
      // of whether a concurrent edit also landed.
      expect(submitRes.status).toBe(200);

      const final = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { lines: true },
      });
      expect(final.status).not.toBe("DRAFT");

      // The invariant the bug broke: whatever submit reported as the final
      // total must match what is actually persisted — an order that has
      // left DRAFT (and is therefore locked) must never have its total
      // change out from under its own submit response.
      expect(submitRes.body.total).toBe(final.total.toFixed(2));

      if (patchRes.status === 200) {
        // Case (a): the edit legitimately landed before submit locked the
        // order in — the persisted lines must be the edited ones.
        expect(final.lines.every((line) => line.description.startsWith("Edited widget"))).toBe(
          true,
        );
      } else {
        // Case (b): submit locked the order first — the edit must be
        // rejected with the standard "locked" error, and the original lines
        // must be exactly what got persisted.
        expect(patchRes.status).toBe(409);
        expect(patchRes.body.reason).toBe(
          "This purchase order is locked and can no longer be edited",
        );
        expect(final.lines.every((line) => line.description.startsWith("Original widget"))).toBe(
          true,
        );
      }
    }
  });
});
