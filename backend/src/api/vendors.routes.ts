import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requireRole } from "../middleware/authorize.ts";
import { asyncHandler } from "../middleware/asyncHandler.ts";
import {
  createVendor,
  listVendors,
  getVendorById,
  deactivateVendor,
} from "../domain/vendor.service.ts";

const createVendorSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().min(1).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().min(1).optional(),
  paymentTerms: z.string().min(1),
});

const listVendorsQuerySchema = z.object({
  active: z.enum(["true", "false"]).optional(),
});

export const vendorsRouter = Router();

/** T034/api-contract.md: POST /api/vendors (Buyer). */
vendorsRouter.post(
  "/",
  authenticate,
  requireRole("BUYER"),
  validate(createVendorSchema),
  asyncHandler(async (req, res) => {
    const vendor = await createVendor(req.user!.id, req.body);
    res.status(201).json(vendor);
  }),
);

/** GET /api/vendors (any authenticated) — supports ?active=true|false. */
vendorsRouter.get(
  "/",
  authenticate,
  validate(listVendorsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { active } = req.query as z.infer<typeof listVendorsQuerySchema>;
    const activeFilter = active === undefined ? undefined : active === "true";
    const vendors = await listVendors(activeFilter);
    res.status(200).json(vendors);
  }),
);

/** GET /api/vendors/:id (any authenticated). */
vendorsRouter.get(
  "/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const vendor = await getVendorById(req.params.id!);
    res.status(200).json(vendor);
  }),
);

/** POST /api/vendors/:id/deactivate (Buyer) — idempotent. */
vendorsRouter.post(
  "/:id/deactivate",
  authenticate,
  requireRole("BUYER"),
  asyncHandler(async (req, res) => {
    const vendor = await deactivateVendor(req.user!.id, req.params.id!);
    res.status(200).json(vendor);
  }),
);
