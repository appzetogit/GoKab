import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { createBill, deleteBill, getBill, importBills, listBills } from '../services/billService.js';

/**
 * Driver bills: /drivers/bills. Driver role only; every handler works on the
 * bills of the driver in the token, never on an id from the request body.
 */
export const billRouter = Router();

const driverOnly = authenticate(['driver']);

const pageMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

billRouter.post(
  '/bills',
  driverOnly,
  asyncHandler(async (req, res) => {
    const { bill, created } = await createBill({ driverId: req.auth.sub, body: req.body || {} });
    res.status(created ? 201 : 200).json({ success: true, message: created ? 'Bill saved' : 'Bill already saved', data: bill });
  }),
);

// Registered before /bills/:id so "import" is never read as an id.
billRouter.post(
  '/bills/import',
  driverOnly,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await importBills({ driverId: req.auth.sub, bills: req.body?.bills }) });
  }),
);

billRouter.get(
  '/bills',
  driverOnly,
  asyncHandler(async (req, res) => {
    const result = await listBills({
      driverId: req.auth.sub,
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      paymentStatus: req.query.paymentStatus,
      from: req.query.from,
      to: req.query.to,
      rideId: req.query.rideId,
    });
    const meta = pageMeta(result);
    res.json({
      success: true,
      data: { results: result.results, total: result.total, pagination: meta },
      meta,
    });
  }),
);

billRouter.get(
  '/bills/:id',
  driverOnly,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await getBill({ driverId: req.auth.sub, billId: req.params.id }) });
  }),
);

billRouter.delete(
  '/bills/:id',
  driverOnly,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      message: 'Bill deleted',
      data: await deleteBill({ driverId: req.auth.sub, billId: req.params.id }),
    });
  }),
);
