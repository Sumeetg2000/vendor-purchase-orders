import type {
  ApiErrorBody,
  AuditLogEntry,
  OutstandingOrdersResult,
  PurchaseOrder,
  Role,
  Vendor,
} from "../types";

// Relative by default: the dev server proxies /api to the backend so the
// browser only ever talks to its own origin (the backend sends no CORS
// headers). Set VITE_API_BASE_URL to call a backend directly instead.
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

let token: string | null = null;

export function setToken(nextToken: string | null): void {
  token = nextToken;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function formatApiError(data: unknown): string {
  if (data && typeof data === "object") {
    const body = data as ApiErrorBody;
    if (body.error === "validation_error" && Array.isArray(body.details)) {
      return body.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join("; ");
    }
    if (body.reason) return body.reason;
    switch (body.error) {
      case "not_found":
        return "Not found.";
      case "forbidden":
        return "You do not have permission to do this.";
      case "unauthenticated":
        return "Please log in again.";
      case "invalid_credentials":
        return "Invalid email or password.";
    }
    if (body.error) return body.error;
  }
  return "Request failed.";
}

function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(formatApiError(data), res.status, data);
  }
  return data as T;
}

export interface LoginResult {
  token: string;
  roles: Role[];
}

export interface CreateVendorInput {
  name: string;
  paymentTerms: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface CreatePurchaseOrderLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  lines: CreatePurchaseOrderLineInput[];
}

export interface ListPurchaseOrdersFilter {
  vendorId?: string;
  status?: string;
}

export interface OutstandingOrdersFilter {
  vendorId?: string;
  minAgeDays?: number;
  maxAgeDays?: number;
  page?: number;
  pageSize?: number;
}

export interface ReceiptResult {
  id: string;
  quantity: number;
  receivedBy: string;
  receivedAt: string;
  line: { receivedQty: number; outstandingQty: number };
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResult>("POST", "/api/auth/login", { email, password }),

  listVendors: (active?: boolean) =>
    request<Vendor[]>("GET", `/api/vendors${active === undefined ? "" : `?active=${active}`}`),
  createVendor: (input: CreateVendorInput) => request<Vendor>("POST", "/api/vendors", input),
  deactivateVendor: (id: string) => request<Vendor>("POST", `/api/vendors/${id}/deactivate`),

  listPurchaseOrders: (filter: ListPurchaseOrdersFilter = {}) =>
    request<PurchaseOrder[]>("GET", `/api/purchase-orders${toQueryString(filter)}`),
  createPurchaseOrder: (input: CreatePurchaseOrderInput) =>
    request<PurchaseOrder>("POST", "/api/purchase-orders", input),
  submitPurchaseOrder: (id: string) =>
    request<PurchaseOrder>("POST", `/api/purchase-orders/${id}/submit`),
  approvePurchaseOrder: (id: string) =>
    request<PurchaseOrder>("POST", `/api/purchase-orders/${id}/approve`),
  rejectPurchaseOrder: (id: string, reason: string) =>
    request<PurchaseOrder>("POST", `/api/purchase-orders/${id}/reject`, { reason }),
  cancelPurchaseOrder: (id: string, reason: string) =>
    request<PurchaseOrder>("POST", `/api/purchase-orders/${id}/cancel`, { reason }),
  receiveGoods: (orderId: string, lineId: string, quantity: number) =>
    request<ReceiptResult>("POST", `/api/purchase-orders/${orderId}/lines/${lineId}/receipts`, {
      quantity,
    }),
  getAuditLog: (orderId: string) =>
    request<AuditLogEntry[]>("GET", `/api/purchase-orders/${orderId}/audit-log`),

  getOutstandingOrders: (filter: OutstandingOrdersFilter = {}) =>
    request<OutstandingOrdersResult>(
      "GET",
      `/api/reports/outstanding-orders${toQueryString(filter)}`,
    ),
};
