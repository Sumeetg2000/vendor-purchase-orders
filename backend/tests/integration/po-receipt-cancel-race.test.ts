import { createUserWithRoles } from "../helpers/auth.ts";
import { prisma } from "../../src/db/prismaClient.ts";
import { receiveGoods } from "../../src/domain/goodsReceipt.service.ts";
import { cancelPurchaseOrder } from "../../src/domain/approval.service.ts";

/**
 * FR-011/FR-015: `receiveGoods` used to check the parent order's status via
 * a plain unlocked read before inserting a goods receipt event, while
 * `cancelPurchaseOrder` guards its own write correctly — but that guard
 * alone doesn't stop a receipt insert that already read a stale
 * "still APPROVED" status from completing after cancellation has actually
 * committed.
 *
 * Per spec.md (FR-016, US5 AS5), cancelling an order with partial receipts
 * already recorded is explicitly valid — so the correct invariant is NOT
 * "only one of the two may ever succeed". It is: no receipt may ever be
 * recorded after cancellation has already committed. Two orderings are both
 * legitimate depending on which one truly commits first:
 *   (a) cancel commits first — the receipt attempt (now reading the
 *       already-cancelled row under lock) is rejected.
 *   (b) the receipt commits first, genuinely before cancellation — the
 *       receipt succeeds, and the subsequent cancel must still succeed too
 *       (cancelling a partially-received order is allowed).
 *
 * Racing the two real HTTP endpoints via `Promise.all` and comparing
 * `receivedAt` against the order's `cancelledAt` (as this test was
 * originally going to do) turns out to be an unreliable way to verify
 * this: `cancelledAt` is a JS `new Date()` captured *before*
 * `cancelPurchaseOrder`'s conditional write is even issued, and
 * `receivedAt`'s DB-side `now()` reflects its transaction's start, not its
 * commit — so whenever a lock forces one side to wait, its recorded
 * timestamp no longer reflects true commit order, and the comparison
 * produces false failures even against the fixed code (confirmed
 * empirically: a batch of racing HTTP pairs fails this comparison ~100% of
 * the time both before *and* after the fix, for different reasons each
 * time). What actually distinguishes the bug from the fix is whether
 * `receiveGoods` blocks on and then re-checks the order's true status once
 * a concurrent cancellation is mid-flight — which is directly and
 * deterministically testable by holding the order row locked from a second
 * transaction and observing whether `receiveGoods` waits for it.
 */
describe("Receipt vs. cancel race never lets a receipt land after cancellation commits (FR-011, FR-015)", () => {
  async function createApprovedOrderWithLine(actorId: string, vendorId: string) {
    const order = await prisma.purchaseOrder.create({
      data: {
        orderNumber: `PO-RACE-${Math.random().toString(36).slice(2, 10)}`,
        vendorId,
        createdBy: actorId,
        status: "APPROVED",
        submittedAt: new Date(),
        approvedAt: new Date(),
        lines: { create: [{ description: "Widget", quantity: 10, unitPrice: 10 }] },
      },
      include: { lines: true },
    });
    return { orderId: order.id, lineId: order.lines[0]!.id };
  }

  /** Holds the order row locked (`SELECT ... FOR UPDATE`) until `release()` is called, then applies `mutate` and commits — simulating a concurrent transaction genuinely in flight against the same order. */
  function holdOrderRowLocked(orderId: string, mutate: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT status FROM purchase_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      await gate;
      await mutate(tx);
    });
    return { release, done };
  }

  it("case (a): a cancellation that commits while a receipt is waiting on the lock causes the receipt to be correctly rejected, with no event recorded", async () => {
    const { user } = await createUserWithRoles("buyer-approver-a@test.com", ["BUYER", "APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const { orderId, lineId } = await createApprovedOrderWithLine(user.id, vendor.id);

    const { release, done } = holdOrderRowLocked(orderId, async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: user.id,
          cancellationReason: "No longer needed",
        },
      });
    });
    // Let the holder's SELECT ... FOR UPDATE actually acquire the lock first.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const receivePromise = receiveGoods(user.id, orderId, lineId, 4);
    receivePromise.catch(() => {}); // avoid an unhandled-rejection warning while we probe below

    // While the holder still holds the lock, receiveGoods must be blocked,
    // not proceeding on a stale "still APPROVED" read.
    const stillBlocked = await Promise.race([
      receivePromise.then(
        () => false,
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 150)),
    ]);
    expect(stillBlocked).toBe(true);

    release();
    await done;

    await expect(receivePromise).rejects.toThrow(
      "Goods can only be received against an approved purchase order",
    );

    const events = await prisma.goodsReceiptEvent.findMany({ where: { purchaseOrderLineId: lineId } });
    expect(events).toHaveLength(0);
    const line = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.receivedQty).toBe(0);
  });

  it("case (b): a receipt that commits while a cancellation is waiting on the lock still lets the cancellation succeed afterward (FR-016)", async () => {
    const { user } = await createUserWithRoles("buyer-approver-b@test.com", ["BUYER", "APPROVER"]);
    const vendor = await prisma.vendor.create({ data: { name: "Acme", paymentTerms: "Net 30" } });
    const { orderId, lineId } = await createApprovedOrderWithLine(user.id, vendor.id);

    const { release, done } = holdOrderRowLocked(orderId, async (tx) => {
      await tx.goodsReceiptEvent.create({
        data: { purchaseOrderLineId: lineId, quantity: 4, receivedBy: user.id },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const cancelPromise = cancelPurchaseOrder(user.id, orderId, "No longer needed");
    cancelPromise.catch(() => {});

    const stillBlocked = await Promise.race([
      cancelPromise.then(
        () => false,
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 150)),
    ]);
    expect(stillBlocked).toBe(true);

    release();
    await done;

    const cancelled = await cancelPromise;
    expect(cancelled.status).toBe("CANCELLED");

    const line = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.receivedQty).toBe(4);
  });
});
