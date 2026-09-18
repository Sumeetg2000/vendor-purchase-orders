import { useEffect, useState } from "react";
import { api } from "../services/api";
import { formatMoney } from "../utils/format";
import type { PurchaseOrder } from "../types";
import StatusTag from "../components/StatusTag";
import ReasonModal from "../components/ReasonModal";
import AuditLogModal from "../components/AuditLogModal";

export default function ApprovalsPage() {
  const [pendingOrders, setPendingOrders] = useState<PurchaseOrder[]>([]);
  const [approvedOrders, setApprovedOrders] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actingOrderId, setActingOrderId] = useState<string | null>(null);
  const [rejectingOrder, setRejectingOrder] = useState<PurchaseOrder | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<PurchaseOrder | null>(null);
  const [auditOrder, setAuditOrder] = useState<PurchaseOrder | null>(null);

  async function refresh() {
    const [pending, approved] = await Promise.all([
      api.listPurchaseOrders({ status: "PENDING_APPROVAL" }),
      api.listPurchaseOrders({ status: "APPROVED" }),
    ]);
    setPendingOrders(pending);
    setApprovedOrders(approved);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleApprove(id: string) {
    setError(null);
    setActingOrderId(id);
    try {
      await api.approvePurchaseOrder(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setActingOrderId(null);
    }
  }

  return (
    <div>
      <h2>Approvals Queue</h2>
      {error && <p className="error-text">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Order #</th>
            <th className="num">Total</th>
            <th>Submitted</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pendingOrders.length === 0 && (
            <tr className="empty-row">
              <td colSpan={4}>Nothing pending approval.</td>
            </tr>
          )}
          {pendingOrders.map((order) => (
            <tr key={order.id}>
              <td className="mono">{order.orderNumber}</td>
              <td className="num">{formatMoney(order.total)}</td>
              <td className="num">
                {order.submittedAt ? new Date(order.submittedAt).toLocaleDateString() : ""}
              </td>
              <td className="table-actions">
                <button
                  className="btn-primary"
                  disabled={actingOrderId === order.id}
                  onClick={() => handleApprove(order.id)}
                >
                  Approve
                </button>
                <button className="btn" onClick={() => setRejectingOrder(order)}>
                  Reject
                </button>
                <button className="btn-link" onClick={() => setAuditOrder(order)}>
                  Audit log
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Approved Orders</h3>
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
          {approvedOrders.length === 0 && (
            <tr className="empty-row">
              <td colSpan={4}>No approved orders.</td>
            </tr>
          )}
          {approvedOrders.map((order) => (
            <tr key={order.id}>
              <td className="mono">{order.orderNumber}</td>
              <td>
                <StatusTag status={order.status} />
              </td>
              <td className="num">{formatMoney(order.total)}</td>
              <td className="table-actions">
                <button className="btn" onClick={() => setCancellingOrder(order)}>
                  Cancel
                </button>
                <button className="btn-link" onClick={() => setAuditOrder(order)}>
                  Audit log
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rejectingOrder && (
        <ReasonModal
          title={`Reject order — ${rejectingOrder.orderNumber}`}
          label="Reason (required)"
          confirmLabel="Confirm rejection"
          onClose={() => setRejectingOrder(null)}
          onSubmit={async (reason) => {
            await api.rejectPurchaseOrder(rejectingOrder.id, reason);
            setRejectingOrder(null);
            await refresh();
          }}
        />
      )}
      {cancellingOrder && (
        <ReasonModal
          title={`Cancel order — ${cancellingOrder.orderNumber}`}
          label="Reason (required)"
          confirmLabel="Confirm cancellation"
          onClose={() => setCancellingOrder(null)}
          onSubmit={async (reason) => {
            await api.cancelPurchaseOrder(cancellingOrder.id, reason);
            setCancellingOrder(null);
            await refresh();
          }}
        />
      )}
      {auditOrder && <AuditLogModal order={auditOrder} onClose={() => setAuditOrder(null)} />}
    </div>
  );
}
