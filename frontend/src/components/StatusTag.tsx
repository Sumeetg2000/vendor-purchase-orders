import type { PurchaseOrderStatus } from "../types";

interface StatusTagProps {
  status: PurchaseOrderStatus;
}

export default function StatusTag({ status }: StatusTagProps) {
  return <span className={`status-tag status-${status.toLowerCase()}`}>{status}</span>;
}
