import { useEffect, useState } from "react";
import Modal from "./Modal";
import { api } from "../services/api";
import type { AuditLogEntry, PurchaseOrder } from "../types";

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
          {entries.map((entry) => (
            <li key={entry.id} className="audit-log-entry">
              <div className="action">{entry.action}</div>
              <div className="meta">
                <span className="mono" title={entry.actorUserId ?? undefined}>
                  {describeActor(entry)}
                </span>{" "}
                &middot; <span className="num">{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
            </li>
          ))}
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
