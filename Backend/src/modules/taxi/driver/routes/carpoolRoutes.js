import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { ApiError } from '../../../../utils/ApiError.js';
import {
  cancelCarpoolByDriver,
  getActiveGroupForDriver,
  getGroupForDriver,
  respondToAddRider,
  skipRider,
} from '../../services/carpoolService.js';

/**
 * Driver side of airport / railway carpool. Mounted under /drivers/carpool.
 * Moving each rider through arrived / start (OTP) / complete uses the normal ride
 * status endpoints, one call per rider's own ride.
 */
export const carpoolDriverRouter = Router();
const driverOnly = authenticate(['driver']);

// The carpool the driver is running now (or null).
carpoolDriverRouter.get(
  '/active',
  driverOnly,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await getActiveGroupForDriver(req.auth.sub) });
  }),
);

carpoolDriverRouter.get(
  '/groups/:groupId',
  driverOnly,
  asyncHandler(async (req, res) => {
    const group = await getGroupForDriver({ groupId: req.params.groupId, driverId: req.auth.sub });
    if (!group) throw new ApiError(404, 'Carpool not found');
    res.json({ success: true, data: group });
  }),
);

// Yes or no to a rider who wants to join a carpool the driver already has.
carpoolDriverRouter.post(
  '/riders/:rideId/respond',
  driverOnly,
  asyncHandler(async (req, res) => {
    await respondToAddRider({
      rideId: req.params.rideId,
      driverId: req.auth.sub,
      accept: req.body?.accept === true || req.body?.accept === 'true',
    });
    res.json({ success: true });
  }),
);

// Give the whole carpool back (nobody has been reached yet).
carpoolDriverRouter.post(
  '/groups/:groupId/cancel',
  driverOnly,
  asyncHandler(async (req, res) => {
    await cancelCarpoolByDriver({ groupId: req.params.groupId, driverId: req.auth.sub });
    res.json({ success: true });
  }),
);

// A rider did not turn up: drop them and carry on with the rest.
carpoolDriverRouter.post(
  '/rides/:rideId/skip',
  driverOnly,
  asyncHandler(async (req, res) => {
    await skipRider({ rideId: req.params.rideId, driverId: req.auth.sub });
    res.json({ success: true });
  }),
);
