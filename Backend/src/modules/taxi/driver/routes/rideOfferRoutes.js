import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { acceptRideAssignment, getRideRoom } from '../../services/rideService.js';
import {
  emitToDriver,
  markDriverRejectedFromDispatch,
  notifyRideAccepted,
} from '../../services/dispatchService.js';

/**
 * Answers to a ride offer given on the driver app's native full-screen card.
 * That card is shown while the app is killed, so there is no socket to emit
 * `acceptRide` / `rejectRide` on; these mirror the socket handlers over REST.
 */
export const rideOfferRouter = Router();
const driverOnly = authenticate(['driver']);

rideOfferRouter.post(
  '/:rideId/accept',
  driverOnly,
  asyncHandler(async (req, res) => {
    // A ride another driver published is requested, not taken: the publisher approves.
    const { requestInsteadOfAccept } = await import('../../services/publishedAlertService.js');
    if (await requestInsteadOfAccept({ rideId: req.params.rideId, driverId: req.auth.sub })) {
      res.json({ success: true, data: { rideId: String(req.params.rideId), status: 'requested' } });
      return;
    }
    const ride = await acceptRideAssignment({ rideId: req.params.rideId, driverId: req.auth.sub });
    await notifyRideAccepted(ride);
    // The app reads this when it opens (or is already open): same shape the
    // socket path sends.
    emitToDriver(req.auth.sub, 'rideAccepted', {
      rideId: String(ride._id),
      room: getRideRoom(ride._id),
      status: ride.status,
      liveStatus: ride.liveStatus,
      acceptedAt: ride.acceptedAt,
    });
    res.json({ success: true, data: { rideId: String(ride._id), status: ride.status } });
  }),
);

rideOfferRouter.post(
  '/:rideId/reject',
  driverOnly,
  asyncHandler(async (req, res) => {
    await markDriverRejectedFromDispatch(req.params.rideId, req.auth.sub);
    res.json({ success: true });
  }),
);
