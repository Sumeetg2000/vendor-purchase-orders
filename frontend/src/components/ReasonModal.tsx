import { useState } from "react";
import Modal from "./Modal";

interface ReasonModalProps {
  title: string;
  label: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}

export default function ReasonModal({
  title,
  label,
  confirmLabel,
  onClose,
  onSubmit,
}: ReasonModalProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="reason-modal-input">{label}</label>
          <textarea
            id="reason-modal-input"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Back
          </button>
          <button type="submit" className="btn-primary" disabled={submitting || !reason.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
