import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requireRole } from "../middleware/authorize.ts";
import { asyncHandler } from "../middleware/asyncHandler.ts";
import {
  raisePurchaseOrder,
  editDraftOrder,
  listPurchaseOrders,
  getPurchaseOrderById,
  serializePurchaseOrder,
} from "../domain/purchaseOrder.service.ts";
import {
  submitPurchaseOrder,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  cancelPurchaseOrder,
} from "../domain/approval.service.ts";
import { receiveGoods, listGoodsReceiptEvents } from "../domain/goodsReceipt.service.ts";

/**
 * `.strict()` on the line and top-level shapes: api-contract.md's Conventions
 * say derived fields (`total`, `receivedQty`, `outstandingQty`) are "never
 * accepted as request input" — strict mode makes that an explicit 400
 * validation_error for any unrecognized key, not a silent drop (T043/T043a).
 */
const lineSchema = z
  .object({
    description: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPrice: z.number().min(0),
  })
  .strict();

const createPurchaseOrderSchema = z
  .object({
    vendorId: z.string().uuid(),
    lines: z.array(lineSchema).min(1),
  })
  .strict();

const patchPurchaseOrderSchema = z
  .object({
    vendorId: z.string().uuid().optional(),
    lines: z.array(lineSchema).min(1).optional(),
  })
  .strict();

const listPurchaseOrdersQuerySchema = z.object({
  vendorId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
});

/** T070: reject/cancel both require a non-empty reason (FR-010/FR-011). */
const reasonSchema = z.object({ reason: z.string().min(1) }).strict();

/** T080: only `quantity` — never receivedQty/outstandingQty (T078a). */
const receiptSchema = z.object({ quantity: z.number().int().positive() }).strict();

export const purchaseOrdersRouter = Router();

/** T049/api-contract.md: POST /api/purchase-orders (Buyer). */
purchaseOrdersRouter.post(
  "/",
  authenticate,
  requireRole("BUYER"),
  validate(createPurchaseOrderSchema),
  asyncHandler(async (req, res) => {
    const order = await raisePurchaseOrder(req.user!.id, req.body);
    res.status(201).json(serializePurchaseOrder(order));
  }),
);

/** GET /api/purchase-orders (any authenticated) — ?vendorId=&status=. */
purchaseOrdersRouter.get(
  "/",
  authenticate,
  validate(listPurchaseOrdersQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { vendorId, status } = req.query as z.infer<typeof listPurchaseOrdersQuerySchema>;
    const orders = await listPurchaseOrders({ vendorId, status });
    res.status(200).json(orders.map(serializePurchaseOrder));
  }),
);

/** GET /api/purchase-orders/:id (any authenticated). */
purchaseOrdersRouter.get(
  "/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const order = await getPurchaseOrderById(req.params.id!);
    res.status(200).json(serializePurchaseOrder(order));
  }),
);

/** T050/api-contract.md: PATCH /api/purchase-orders/:id (Buyer, DRAFT only). */
purchaseOrdersRouter.patch(
  "/:id",
  authenticate,
  requireRole("BUYER"),
  validate(patchPurchaseOrderSchema),
  asyncHandler(async (req, res) => {
    const order = await editDraftOrder(req.params.id!, req.body);
    res.status(200).json(serializePurchaseOrder(order));
  }),
);

/** T067/api-contract.md: POST /api/purchase-orders/:id/submit (Buyer). */
purchaseOrdersRouter.post(
  "/:id/submit",
  authenticate,
  requireRole("BUYER"),
  asyncHandler(async (req, res) => {
    const order = await submitPurchaseOrder(req.user!.id, req.params.id!);
    res.status(200).json(serializePurchaseOrder(order));
  }),
);

/** T068/api-contract.md: POST /api/purchase-orders/:id/approve (Approver). */
purchaseOrdersRouter.post(
  "/:id/approve",
  authenticate,
  requireRole("APPROVER"),
  asyncHandler(async (req, res) => {
    const order = await approvePurchaseOrder(req.user!.id, req.params.id!);
    res.status(200).json(serializePurchaseOrder(order));
  }),
);

/** T069/api-contract.md: POST /api/purchase-orders/:id/reject (Approver). */
purchaseOrdersRouter.post(
  "/:id/reject",
  authenticate,
  requireRole("APPROVER"),
  validate(reasonSchema),
  asyncHandler(async (req, res) => {
    const order = await rejectPurchaseOrder(req.user!.id, req.params.id!, req.body.reason);
    res.status(200).json(serializePurchaseOrder(order));
  }),
);

/** T069/api-contract.md: POST /api/purchase-orders/:id/cancel (Approver). */
purchaseOrdersRouter.post(
  "/:id/cancel",
  authenticate,
  requireRole("APPROVER"),
  validate(reasonSchema),
  asyncHandler(async (req, res) => {
    const order = await cancelPurchaseOrder(req.user!.id, req.params.id!, req.body.reason);
    res.status(200).json(serializePurchaseOrder(order));
  }),
);

/** T079/api-contract.md: POST /api/purchase-orders/:id/lines/:lineId/receipts (Buyer). */
purchaseOrdersRouter.post(
  "/:id/lines/:lineId/receipts",
  authenticate,
  requireRole("BUYER"),
  validate(receiptSchema),
  asyncHandler(async (req, res) => {
    const result = await receiveGoods(
      req.user!.id,
      req.params.id!,
      req.params.lineId!,
      req.body.quantity,
    );
    res.status(201).json(result);
  }),
);

/** GET /api/purchase-orders/:id/lines/:lineId/receipts (any authenticated). */
purchaseOrdersRouter.get(
  "/:id/lines/:lineId/receipts",
  authenticate,
  asyncHandler(async (req, res) => {
    const events = await listGoodsReceiptEvents(req.params.id!, req.params.lineId!);
    res.status(200).json(events);
  }),
);
