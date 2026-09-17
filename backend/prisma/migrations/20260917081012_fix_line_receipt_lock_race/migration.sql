-- Fixes a genuine concurrency bug in the T017 trigger from
-- 20260916114749_core_constraints_and_triggers/migration.sql, confirmed via
-- direct reproduction against Postgres (two concurrent goods-receipt
-- transactions on the same line, one holding its transaction open across a
-- deliberate delay): the previous single-statement UPDATE's SUM(quantity)
-- subquery took its READ COMMITTED snapshot when the UPDATE statement
-- started, before it blocked on the target row's lock. When Postgres
-- unblocks a lock waiter (EvalPlanQual), it re-fetches only the current
-- version of the row targeted by the UPDATE itself — it does NOT re-snapshot
-- subqueries against other tables. So the waiting transaction's SUM never
-- saw the other transaction's already-committed receipt, and both
-- transactions could commit with a combined received_qty exceeding quantity.
--
-- The original research.md §2 / T017 comment's claim that "ordinary row
-- locking is sufficient" was wrong: locking is necessary but the recompute
-- must happen in a genuinely NEW statement after the lock is held, not in
-- the SET clause of the same UPDATE that acquires the lock.
--
-- Fix: explicitly acquire the row lock first (PERFORM ... FOR UPDATE), then
-- recompute in a separate, subsequent UPDATE statement. That second
-- statement takes its own fresh snapshot under READ COMMITTED and correctly
-- sees any receipt committed by whichever transaction it was waiting on.
CREATE OR REPLACE FUNCTION recompute_line_received_qty() RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1 FROM "purchase_order_lines"
  WHERE "id" = NEW."purchase_order_line_id"
  FOR UPDATE;

  UPDATE "purchase_order_lines"
  SET "received_qty" = COALESCE(
    (SELECT SUM("quantity")
     FROM "goods_receipt_events"
     WHERE "purchase_order_line_id" = NEW."purchase_order_line_id"),
    0
  )
  WHERE "id" = NEW."purchase_order_line_id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
