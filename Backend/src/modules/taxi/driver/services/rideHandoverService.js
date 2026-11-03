import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../../constants/index.js';
import { Ride } from '../../user/models/Ride.js';
import { Driver } from '../models/Driver.js';
import { getDriverPermissions } from '../../services/driverCategoryService.js';
import { emitToDriver, notifyRideAccepted } from '../../services/dispatchService.js';
import { resolveVehicleSelection, rideVehicleSetFields } from './rideVehicleService.js';
import { validateAssignTarget } from './networkRideService.js';

/**
 * A Pro/Elite driver who accepted a customer ride hands it to one of their own
 * team drivers. The ride keeps its OTP and fare; the rider is told who is
 * coming now, and commission and cash settle on the lead's wallet.
 *
 * Only before the driver heads to the pickup (`accepted`), only to a team
 * member, and never to someone already on a ride.
 */
export const handOverCustomerRide = async ({ driverId, rideId, targetDriverId, body = {} }) => {
  if (!mongoose.isValidObjectId(rideId)) {
    throw new ApiError(400, 'rideId is invalid', null, 'INVALID_ID');
  }

  const permissions = await getDriverPermissions(driverId);
  const ride = await Ride.findById(rideId);
  if (!ride) throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');

  if (ride.origin !== 'customer_app' || String(ride.driverId || '') !== String(driverId)) {
    throw new ApiError(403, 'This ride is not yours to hand over', null, 'NOT_RIDE_DRIVER');
  }
  if (ride.status !== RIDE_STATUS.ACCEPTED || ride.liveStatus !== RIDE_LIVE_STATUS.ACCEPTED) {
    throw new ApiError(409, 'This ride can no longer be handed over', null, 'RIDE_NOT_OPEN');
  }
  if (String(targetDriverId) === String(driverId)) {
    throw new ApiError(400, 'Choose a driver from your team, or drive the ride yourself', null, 'INVALID_TARGET');
  }

  const { target, scheduledForLater, targetType } = await validateAssignTarget({
    permissions,
    driverId,
    targetDriverId,
    ride,
    excludeRideId: ride._id,
  });
  if (targetType !== 'fleet') {
    throw new ApiError(403, 'Only a driver in your team can take this ride', null, 'DRIVER_NOT_IN_FLEET');
  }

  const { vehicle } = await resolveVehicleSelection({
    body,
    creatorPermissions: permissions,
    assignee: target,
    ride,
    excludeRideId: ride._id,
  });

  if (!scheduledForLater) {
    const claimed = await Driver.findOneAndUpdate({ _id: target._id, isOnRide: false }, { $set: { isOnRide: true } });
    if (!claimed) throw new ApiError(409, 'That driver just became unavailable. Try again.', null, 'DRIVER_BUSY');
  }

  const now = new Date();
  const updated = await Ride.findOneAndUpdate(
    { _id: ride._id, driverId, status: RIDE_STATUS.ACCEPTED, liveStatus: RIDE_LIVE_STATUS.ACCEPTED },
    {
      $set: {
        driverId: target._id,
        'assignment.mode': 'direct_assign',
        'assignment.target_type': 'fleet',
        'assignment.assigned_by_driver_id': driverId,
        'assignment.assigned_at': now,
        'assignment.acknowledged_at': null,
        ...rideVehicleSetFields(vehicle),
      },
      $push: {
        'assignment.history': { driver_id: target._id, action: 'assigned', by_driver_id: driverId, at: now },
      },
    },
    { new: true },
  );

  if (!updated) {
    if (!scheduledForLater) await Driver.updateOne({ _id: target._id }, { $set: { isOnRide: false } });
    throw new ApiError(409, 'This ride changed while you were assigning it', null, 'RIDE_NOT_OPEN');
  }

  if (!scheduledForLater) {
    await Driver.updateOne({ _id: driverId }, { $set: { isOnRide: false } });
  }

  // Tells the rider who is coming now and puts the ride on the team driver's app.
  await notifyRideAccepted(updated);
  emitToDriver(driverId, 'ride:handed-over', { rideId: String(updated._id), targetDriverId: String(target._id) });

  return { rideId: String(updated._id), status: updated.status, driver: { id: String(target._id), name: target.name } };
};
