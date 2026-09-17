import { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.ts";
import { authenticate } from "../middleware/authenticate.ts";
import { requireRole } from "../middleware/authorize.ts";
import { asyncHandler } from "../middleware/asyncHandler.ts";
import { outstandingOrdersByVendorAndAge } from "../domain/reporting.service.ts";

const coercedInt = (schema: z.ZodNumber) =>
  z.preprocess((val) => (typeof val === "string" ? Number(val) : val), schema);

const outstandingOrdersQuerySchema = z.object({
  vendorId: z.string().uuid().optional(),
  minAgeDays: coercedInt(z.number().int().nonnegative()).optional(),
  maxAgeDays: coercedInt(z.number().int().nonnegative()).optional(),
  page: coercedInt(z.number().int().positive()).optional(),
  pageSize: coercedInt(z.number().int().positive().max(50)).optional(),
});

export const reportsRouter = Router();

/** T088/api-contract.md: GET /api/reports/outstanding-orders (Procurement Admin). */
reportsRouter.get(
  "/outstanding-orders",
  authenticate,
  requireRole("PROCUREMENT_ADMIN"),
  validate(outstandingOrdersQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const filter = req.query as z.infer<typeof outstandingOrdersQuerySchema>;
    const result = await outstandingOrdersByVendorAndAge(filter);
    res.status(200).json(result);
  }),
);
