-- T015: CHECK constraints Prisma schema syntax cannot express.
--
-- Purpose (research.md §11): these are a defense-in-depth / bonus backstop,
-- NOT the load-bearing enforcement for the required guarantee (that the total
-- and outstanding quantity can never drift through any API call or
-- application code path) — the Express service layer is what satisfies that
-- required guarantee. These constraints additionally extend the same
-- guarantee to survive a raw SQL write that bypasses the API entirely, which
-- is beyond what this POC is graded on but costs nothing to keep.

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_unit_price_check" CHECK ("unit_price" >= 0);

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_received_qty_check" CHECK ("received_qty" <= "quantity");

-- Also covers the goods-receipt quantity>0 rule (FR-015; research.md §11's
-- enforcement matrix groups this with the two checks above).
ALTER TABLE "goods_receipt_events"
  ADD CONSTRAINT "goods_receipt_events_quantity_check" CHECK ("quantity" > 0);

-- Reason-required constraint, quoted verbatim from research.md §11.
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_reason_required_check" CHECK (
    ("status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL) AND
    ("status" <> 'CANCELLED' OR "cancellation_reason" IS NOT NULL)
  );

-- Actor CHECK from data-model.md's AuditLogEntry: "required when
-- actor_type = USER; MUST be NULL when actor_type = SYSTEM".
ALTER TABLE "audit_log_entries"
  ADD CONSTRAINT "audit_log_entries_actor_check" CHECK (
    ("actor_type" = 'SYSTEM' AND "actor_user_id" IS NULL) OR
    ("actor_type" = 'USER' AND "actor_user_id" IS NOT NULL)
  );

-- T016: derived-total trigger (research.md §2).
--
-- Recomputes the parent purchase_orders.total from purchase_order_lines on
-- every INSERT/UPDATE/DELETE of a line. This is a bonus mechanism: the
-- REQUIRED guarantee (total always matches the sum of its lines) is already
-- met by the Express service layer computing and writing total itself inside
-- its own transaction; this trigger additionally recomputes independently so
-- the guarantee also survives a raw SQL write bypassing the API entirely.
CREATE OR REPLACE FUNCTION recompute_purchase_order_total() RETURNS TRIGGER AS $$
DECLARE
  affected_order_id UUID;
BEGIN
  affected_order_id := COALESCE(NEW."purchase_order_id", OLD."purchase_order_id");
  UPDATE "purchase_orders"
  SET "total" = COALESCE(
    (SELECT SUM("quantity" * "unit_price")
     FROM "purchase_order_lines"
     WHERE "purchase_order_id" = affected_order_id),
    0
  )
  WHERE "id" = affected_order_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_recompute_purchase_order_total"
AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_lines"
FOR EACH ROW EXECUTE FUNCTION recompute_purchase_order_total();

-- T017: derived-received-quantity trigger (research.md §2).
--
-- Recomputes the parent line's received_qty from goods_receipt_events on
-- every INSERT. Concurrency-correctness detail (research.md §2, not obvious
-- from the CHECK constraint alone): the UPDATE statement below takes an
-- ordinary Postgres row-level lock on the affected purchase_order_lines row.
-- A second concurrent goods-receipt transaction touching the SAME line blocks
-- on that lock until the first transaction commits or rolls back, then
-- re-reads the now-current received_qty before its own
-- CHECK (received_qty <= quantity) is evaluated. It is this ordinary row
-- locking — not the CHECK constraint by itself — that makes concurrent
-- receipts serialize safely and correctly reject whichever one would
-- over-receive.
CREATE OR REPLACE FUNCTION recompute_line_received_qty() RETURNS TRIGGER AS $$
BEGIN
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

CREATE TRIGGER "trg_recompute_line_received_qty"
AFTER INSERT ON "goods_receipt_events"
FOR EACH ROW EXECUTE FUNCTION recompute_line_received_qty();

-- T018a: human-readable order number sequence (research.md §7). A native
-- Postgres SEQUENCE is race-safe by design under concurrent creates.
CREATE SEQUENCE IF NOT EXISTS "purchase_order_number_seq" START 1;
