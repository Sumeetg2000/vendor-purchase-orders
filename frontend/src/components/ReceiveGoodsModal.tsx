import { useEffect, useState } from "react";
import Modal from "./Modal";
import { api } from "../services/api";
import type { GoodsReceiptEventView } from "../services/api";
import type { PurchaseOrder } from "../types";

interface ReceiveGoodsModalProps {
  order: PurchaseOrder;
  onClose: () => void;
  onReceived: () => void;
}

export default function ReceiveGoodsModal({ order, onClose, onReceived }: ReceiveGoodsModalProps) {
  const [lineId, setLineId] = useState(
    order.lines.find((line) => line.outstandingQty > 0)?.id ?? "",
  );
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<GoodsReceiptEventView[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const selectedLine = order.lines.find((line) => line.id === lineId);

  useEffect(() => {
    setHistoryOpen(false);
    setHistory(null);
    setHistoryError(null);
  }, [lineId]);

  function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (!history && lineId) {
      api
        .getGoodsReceiptEvents(order.id, lineId)
        .then(setHistory)
        .catch((err: unknown) => {
          setHistoryError(err instanceof Error ? err.message : "Request failed.");
        });
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.receiveGoods(order.id, lineId, Number(quantity));
      onReceived();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Receive goods — ${order.orderNumber}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="receipt-line">Line</label>
          <select
            id="receipt-line"
            value={lineId}
            onChange={(event) => setLineId(event.target.value)}
            required
          >
            <option value="" disabled>
              Select a line
            </option>
            {order.lines.map((line) => (
              <option key={line.id} value={line.id} disabled={line.outstandingQty <= 0}>
                {line.description} ({line.outstandingQty} outstanding of {line.quantity})
              </option>
            ))}
          </select>
          {lineId && (
            <button type="button" className="btn-link" onClick={toggleHistory}>
              {historyOpen ? "Hide history" : "History"}
            </button>
          )}
          {historyOpen && (
            <>
              {historyError && <p className="error-text">{historyError}</p>}
              {!historyError && !history && <p className="hint-text">Loading…</p>}
              {history && history.length === 0 && (
                <p className="hint-text">No receipts recorded yet.</p>
              )}
              {history && history.length > 0 && (
                <ul className="audit-log-list">
                  {history.map((event) => (
                    <li key={event.id} className="audit-log-entry">
                      <div className="action">Qty {event.quantity}</div>
                      <div className="meta">
                        <span className="mono" title={event.receivedBy}>
                          User {event.receivedBy.slice(0, 8)}…
                        </span>{" "}
                        &middot;{" "}
                        <span className="num">
                          {new Date(event.receivedAt).toLocaleString()}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <div className="field">
          <label htmlFor="receipt-quantity">Quantity received</label>
          <input
            id="receipt-quantity"
            type="number"
            min="1"
            max={selectedLine?.outstandingQty ?? undefined}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            required
          />
          {selectedLine && (
            <span className="hint-text">{selectedLine.outstandingQty} outstanding</span>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting || !lineId}>
            Record receipt
          </button>
        </div>
      </form>
    </Modal>
  );
}
