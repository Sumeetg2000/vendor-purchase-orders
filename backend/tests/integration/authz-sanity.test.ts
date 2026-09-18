import { api } from "../setup.ts";
import { createUserWithRoles } from "../helpers/auth.ts";

/**
 * T094: every route rejects an unauthenticated request 401, and rejects a
 * caller whose role set doesn't permit the action 403 (spec.md SC-006,
 * quickstart.md Authentication & authorization sanity checks). Auth/role
 * middleware runs before any DB lookup, so a placeholder UUID in `:id`
 * segments is enough — the request never reaches the handler.
 */
const DUMMY_ID = "00000000-0000-0000-0000-000000000000";

const PROTECTED_ROUTES: { method: "get" | "post" | "patch"; path: string; role: string }[] = [
  { method: "post", path: "/api/vendors", role: "BUYER" },
  { method: "post", path: `/api/vendors/${DUMMY_ID}/deactivate`, role: "BUYER" },
  { method: "post", path: "/api/purchase-orders", role: "BUYER" },
  { method: "patch", path: `/api/purchase-orders/${DUMMY_ID}`, role: "BUYER" },
  { method: "post", path: `/api/purchase-orders/${DUMMY_ID}/submit`, role: "BUYER" },
  { method: "post", path: `/api/purchase-orders/${DUMMY_ID}/approve`, role: "APPROVER" },
  { method: "post", path: `/api/purchase-orders/${DUMMY_ID}/reject`, role: "APPROVER" },
  { method: "post", path: `/api/purchase-orders/${DUMMY_ID}/cancel`, role: "APPROVER" },
  {
    method: "post",
    path: `/api/purchase-orders/${DUMMY_ID}/lines/${DUMMY_ID}/receipts`,
    role: "BUYER",
  },
  { method: "get", path: "/api/reports/outstanding-orders", role: "PROCUREMENT_ADMIN" },
];

const UNPROTECTED_BUT_AUTHENTICATED_ROUTES: { method: "get"; path: string }[] = [
  { method: "get", path: "/api/vendors" },
  { method: "get", path: `/api/vendors/${DUMMY_ID}` },
  { method: "get", path: "/api/purchase-orders" },
  { method: "get", path: `/api/purchase-orders/${DUMMY_ID}` },
  { method: "get", path: `/api/purchase-orders/${DUMMY_ID}/lines/${DUMMY_ID}/receipts` },
  { method: "get", path: `/api/purchase-orders/${DUMMY_ID}/audit-log` },
];

describe("Authorization sanity: every route (T094, spec.md SC-006)", () => {
  it.each(PROTECTED_ROUTES)(
    "rejects unauthenticated $method $path with 401",
    async ({ method, path }) => {
      const res = await api[method](path);
      expect(res.status).toBe(401);
    },
  );

  it.each(UNPROTECTED_BUT_AUTHENTICATED_ROUTES)(
    "rejects unauthenticated $method $path with 401",
    async ({ method, path }) => {
      const res = await api[method](path);
      expect(res.status).toBe(401);
    },
  );

  it.each(PROTECTED_ROUTES)(
    "rejects $method $path with 403 for a caller without the $role role",
    async ({ method, path, role }) => {
      const wrongRole = role === "BUYER" ? "APPROVER" : "BUYER";
      const { token } = await createUserWithRoles(`wrong-role-${method}-${path}@test.com`, [
        wrongRole as "APPROVER" | "BUYER",
      ]);
      const res = await api[method](path).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
    },
  );
});
