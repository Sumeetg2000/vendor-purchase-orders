import { useEffect, useState } from "react";
import Modal from "./Modal";
import { api } from "../services/api";
import type { AuditAction, AuditLogEntry, PurchaseOrder } from "../types";

interface AuditLogModalProps {
  order: PurchaseOrder;
  onClose: () => void;
}

// TODO(backend): actorUserId is a raw id, not a name/email — resolving it to a
// human-readable identity needs a backend change (join against users), tracked separately.
function describeActor(entry: AuditLogEntry): string {
  if (entry.actorType === "SYSTEM") return "System";
  if (!entry.actorUserId) return "Unknown user";
  return `User ${entry.actorUserId.slice(0, 8)}…`;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  PO_CREATED: "PO Created",
  PO_SUBMITTED: "Submitted",
  PO_APPROVED: "Approved",
  PO_REJECTED: "Rejected",
  PO_CANCELLED: "Cancelled",
  GOODS_RECEIPT_RECORDED: "Goods Received",
  VENDOR_CREATED: "Vendor Created",
  VENDOR_DEACTIVATED: "Vendor Deactivated",
};

function describeDetails(entry: AuditLogEntry, order: PurchaseOrder): string | null {
  const details = entry.details;
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;

  switch (entry.action) {
    case "PO_CREATED": {
      const orderNumber = d.orderNumber;
      return typeof orderNumber === "string" ? `Order ${orderNumber}` : null;
    }
    case "GOODS_RECEIPT_RECORDED": {
      const line = order.lines.find((l) => l.id === entry.entityId);
      const quantity = d.quantity;
      if (line && typeof quantity === "number") {
        return `${quantity} received against "${line.description}"`;
      }
      if (typeof quantity === "number") return `${quantity} received`;
      return null;
    }
    case "PO_REJECTED":
    case "PO_CANCELLED": {
      const reason = d.reason;
      return typeof reason === "string" ? `Reason: ${reason}` : null;
    }
    case "PO_APPROVED": {
      const autoApproved = d.autoApproved;
      return autoApproved === true ? "Auto-approved (at or below threshold)" : null;
    }
    case "PO_SUBMITTED": {
      const total = d.total;
      const threshold = d.threshold;
      if (typeof total === "string" && typeof threshold === "number") {
        return `Total ${total} vs. threshold ${threshold}`;
      }
      return null;
    }
    default:
      return null;
  }
}

export default function AuditLogModal({ order, onClose }: AuditLogModalProps) {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAuditLog(order.id)
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Request failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  return (
    <Modal title={`Audit log — ${order.orderNumber}`} onClose={onClose}>
      {error && <p className="error-text">{error}</p>}
      {!error && !entries && <p className="hint-text">Loading…</p>}
      {entries && entries.length === 0 && <p className="hint-text">No audit entries.</p>}
      {entries && entries.length > 0 && (
        <ul className="audit-log-list">
          {entries.map((entry) => {
            const detail = describeDetails(entry, order);
            return (
              <li key={entry.id} className="audit-log-entry">
                <div className="action">{ACTION_LABELS[entry.action] ?? entry.action}</div>
                {detail && <div className="hint-text">{detail}</div>}
                <div className="meta">
                  <span className="mono" title={entry.actorUserId ?? undefined}>
                    {describeActor(entry)}
                  </span>{" "}
                  &middot;{" "}
                  <span className="num">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
