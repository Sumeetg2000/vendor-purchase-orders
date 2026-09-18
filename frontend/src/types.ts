export type Role = "BUYER" | "APPROVER" | "PROCUREMENT_ADMIN";

export interface AuthUser {
  email: string;
  roles: Role[];
}

export interface Vendor {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  paymentTerms: string;
  isActive: boolean;
  createdAt: string;
}

export type PurchaseOrderStatus =
  "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface PurchaseOrderLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  receivedQty: number;
  outstandingQty: number;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  vendorId: string;
  status: PurchaseOrderStatus;
  total: string;
  lines: PurchaseOrderLine[];
  createdBy: string;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AuditActorType = "USER" | "SYSTEM";

export type AuditAction =
  | "PO_CREATED"
  | "PO_SUBMITTED"
  | "PO_APPROVED"
  | "PO_REJECTED"
  | "PO_CANCELLED"
  | "GOODS_RECEIPT_RECORDED"
  | "VENDOR_CREATED"
  | "VENDOR_DEACTIVATED";

export type AuditEntityType = "PurchaseOrder" | "PurchaseOrderLine" | "Vendor";

export interface AuditLogEntry {
  id: string;
  actorType: AuditActorType;
  actorUserId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  details: unknown;
  createdAt: string;
}

export interface OutstandingOrderItem {
  orderId: string;
  orderNumber: string;
  vendorId: string;
  vendorName: string;
  status: PurchaseOrderStatus;
  total: string;
  ageDays: number;
  outstandingLines: PurchaseOrderLine[];
}

export interface OutstandingOrdersResult {
  items: OutstandingOrderItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorDetail {
  path?: string;
  message: string;
}

export interface ApiErrorBody {
  error?: string;
  reason?: string;
  details?: ApiErrorDetail[];
}
