import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { handOverCustomerRide } from '../services/rideHandoverService.js';

/** A Pro/Elite driver hands an accepted customer ride to one of their team drivers. */
export const rideHandoverRouter = Router();

rideHandoverRouter.post(
  '/:rideId',
  authenticate(['driver']),
  asyncHandler(async (req, res) => {
    const data = await handOverCustomerRide({
      driverId: req.auth.sub,
      rideId: req.params.rideId,
      targetDriverId: req.body?.targetDriverId,
      body: req.body || {},
    });
    res.json({ success: true, data });
  }),
);
