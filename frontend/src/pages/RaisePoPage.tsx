import { useEffect, useState } from "react";
import { api } from "../services/api";
import { formatMoney } from "../utils/format";
import type { PurchaseOrder, Vendor } from "../types";
import StatusTag from "../components/StatusTag";
import ReceiveGoodsModal from "../components/ReceiveGoodsModal";
import AuditLogModal from "../components/AuditLogModal";

interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_LINE: LineDraft = { description: "", quantity: "1", unitPrice: "0" };

export default function RaisePoPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [actingOrderId, setActingOrderId] = useState<string | null>(null);
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
  const [auditOrder, setAuditOrder] = useState<PurchaseOrder | null>(null);

  async function refresh() {
    setOrders(await api.listPurchaseOrders());
  }

  useEffect(() => {
    api.listVendors(true).then(setVendors);
    refresh();
  }, []);

  function updateLine(index: number, field: keyof LineDraft, value: string) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, [field]: value } : line)),
    );
  }

  function addLine() {
    setLines((current) => [...current, { ...EMPTY_LINE }]);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.createPurchaseOrder({
        vendorId,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
        })),
      });
      setLines([{ ...EMPTY_LINE }]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSubmitOrder(id: string) {
    setError(null);
    setActingOrderId(id);
    try {
      await api.submitPurchaseOrder(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setActingOrderId(null);
    }
  }

  return (
    <div>
      <h2>Raise a Purchase Order</h2>
      <form className="form-panel" onSubmit={handleCreate}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="po-vendor">Vendor</label>
            <select
              id="po-vendor"
              value={vendorId}
              onChange={(event) => setVendorId(event.target.value)}
              required
            >
              <option value="" disabled>
                Select a vendor
              </option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {lines.map((line, index) => (
          <div className="form-row" key={index}>
            <div className="field">
              <label>Description</label>
              <input
                placeholder="Description"
                value={line.description}
                onChange={(event) => updateLine(index, "description", event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Quantity</label>
              <input
                type="number"
                min="1"
                value={line.quantity}
                onChange={(event) => updateLine(index, "quantity", event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Unit price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={line.unitPrice}
                onChange={(event) => updateLine(index, "unitPrice", event.target.value)}
                required
              />
            </div>
            {lines.length > 1 && (
              <button type="button" className="btn" onClick={() => removeLine(index)}>
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="btn-row">
          <button type="button" className="btn" onClick={addLine}>
            Add line
          </button>
          <button type="submit" className="btn-primary" disabled={creating}>
            Create draft
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>

      <h3>My Purchase Orders</h3>
      <table>
        <thead>
          <tr>
            <th>Order #</th>
            <th>Status</th>
            <th className="num">Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 && (
            <tr className="empty-row">
              <td colSpan={4}>No purchase orders yet.</td>
            </tr>
          )}
          {orders.map((order) => (
            <tr key={order.id}>
              <td className="mono">{order.orderNumber}</td>
              <td>
                <StatusTag status={order.status} />
              </td>
              <td className="num">{formatMoney(order.total)}</td>
              <td className="table-actions">
                {order.status === "DRAFT" && (
                  <button
                    className="btn"
                    disabled={actingOrderId === order.id}
                    onClick={() => handleSubmitOrder(order.id)}
                  >
                    Submit
                  </button>
                )}
                {order.status === "APPROVED" && (
                  <button className="btn" onClick={() => setReceivingOrder(order)}>
                    Receive goods
                  </button>
                )}
                <button className="btn-link" onClick={() => setAuditOrder(order)}>
                  Audit log
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {receivingOrder && (
        <ReceiveGoodsModal
          order={receivingOrder}
          onClose={() => setReceivingOrder(null)}
          onReceived={async () => {
            setReceivingOrder(null);
            await refresh();
          }}
        />
      )}
      {auditOrder && <AuditLogModal order={auditOrder} onClose={() => setAuditOrder(null)} />}
    </div>
  );
}
