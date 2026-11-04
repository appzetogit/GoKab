import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { Ride } from '../user/models/Ride.js';
import { Driver } from '../driver/models/Driver.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';
import { emitToRoom, getUserRoom, redispatchRide } from './dispatchService.js';
import { getRideRoom, serializeRideRealtime } from './rideService.js';

const MINUTE_MS = 60 * 1000;
// The driver is reminded an hour, half an hour and ten minutes before pickup.
const DRIVER_REMINDER_MINUTES = [60, 30, 10];
const RIDER_REMINDER_MINUTES = 30;
// Past the pickup time with the driver still not at the pickup.
const LATE_AFTER_MINUTES = 10;
const REASSIGN_AFTER_MINUTES = 20;

const timeLabel = (date) =>
  new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

const push = (target, title, body, data) =>
  sendPushNotificationToEntities({ ...target, title, body, data }).catch(() => {});

// One claim per reminder, so a restart or an overlapping pass never repeats it.
const claim = (ride, field, now) =>
  Ride.findOneAndUpdate({ _id: ride._id, [`reminders.${field}`]: null }, { $set: { [`reminders.${field}`]: now } });

/**
 * A driver who took a scheduled customer ride is reminded 60, 30 and 10 minutes
 * before the pickup, the rider 30 minutes before, and both are told when the
 * driver is late. Return legs of a round trip have their own reminders.
 */
export const sendScheduledCustomerRideReminders = async (now = new Date()) => {
  const legs = await Ride.find({
    origin: 'customer_app',
    'roundTrip.legType': { $ne: 'return' },
    status: RIDE_STATUS.ACCEPTED,
    liveStatus: RIDE_LIVE_STATUS.ACCEPTED,
    driverId: { $ne: null },
    scheduledAt: {
      $lte: new Date(now.getTime() + Math.max(...DRIVER_REMINDER_MINUTES) * MINUTE_MS),
      $gte: new Date(now.getTime() - 3 * 60 * MINUTE_MS),
    },
  })
    .select('userId driverId scheduledAt pickupAddress')
    .limit(200)
    .lean();

  let sent = 0;
  for (const ride of legs) {
    try {
      const minutesLeft = (new Date(ride.scheduledAt).getTime() - now.getTime()) / MINUTE_MS;
      const rideId = String(ride._id);
      const label = timeLabel(ride.scheduledAt);
      const driver = { driverIds: [String(ride.driverId)] };
      const rider = { userIds: [String(ride.userId)] };
      const where = ride.pickupAddress || 'see app';

      // Only the nearest step that has come due is sent, so a ride accepted at
      // 25 minutes out gets one reminder, not three at once.
      const due = DRIVER_REMINDER_MINUTES.filter((m) => minutesLeft <= m && minutesLeft > -LATE_AFTER_MINUTES);
      const step = due.length ? Math.min(...due) : null;
      if (step !== null && (await claim(ride, `customer_${step}_at`, now))) {
        for (const larger of DRIVER_REMINDER_MINUTES.filter((m) => m > step)) {
          await Ride.updateOne({ _id: ride._id, [`reminders.customer_${larger}_at`]: null }, { $set: { [`reminders.customer_${larger}_at`]: now } });
        }
        push(
          driver,
          step <= 10 ? 'Start for your pickup' : `Pickup in ${step} min`,
          `${label} · ${where}. Open the app and slide to go to the pickup.`,
          { type: 'scheduled_ride_reminder', rideId },
        );
        sent += 1;
      }

      if (minutesLeft <= RIDER_REMINDER_MINUTES && minutesLeft > -LATE_AFTER_MINUTES && (await claim(ride, 'customer_rider_at', now))) {
        push(rider, 'Your driver will arrive soon', `Pickup at ${label}. Keep your OTP ready.`, { type: 'scheduled_ride_reminder', rideId });
        sent += 1;
      }

      if (minutesLeft <= -LATE_AFTER_MINUTES && (await claim(ride, 'customer_late_at', now))) {
        push(driver, 'You are late for the pickup', 'Your rider is waiting. Slide to go to the pickup now.', { type: 'scheduled_ride_late', rideId });
        push(rider, 'Driver is running late', 'We have reminded your driver. If there is no driver soon, we will find you another one.', { type: 'scheduled_ride_late', rideId });
        sent += 1;
      }
    } catch (error) {
      console.error(`[scheduledRide] Reminder failed for ride ${ride._id}:`, error.message);
    }
  }
  return { scheduledRideReminders: sent };
};

/**
 * A scheduled ride whose driver still has not reached the pickup 20 minutes
 * after the pickup time goes back to dispatch, without that driver, and both
 * sides are told. The ride keeps its OTP and fare.
 */
export const reassignLateScheduledRides = async (now = new Date()) => {
  const late = await Ride.find({
    origin: 'customer_app',
    status: RIDE_STATUS.ACCEPTED,
    liveStatus: RIDE_LIVE_STATUS.ACCEPTED,
    driverId: { $ne: null },
    scheduledAt: { $lte: new Date(now.getTime() - REASSIGN_AFTER_MINUTES * MINUTE_MS), $gte: new Date(now.getTime() - 6 * 60 * MINUTE_MS) },
  })
    .select('_id userId driverId')
    .limit(50)
    .lean();

  let reassigned = 0;
  for (const ride of late) {
    try {
      const released = await Ride.findOneAndUpdate(
        { _id: ride._id, status: RIDE_STATUS.ACCEPTED, liveStatus: RIDE_LIVE_STATUS.ACCEPTED, driverId: ride.driverId },
        {
          $set: { driverId: null, status: RIDE_STATUS.SEARCHING, liveStatus: RIDE_LIVE_STATUS.SEARCHING, acceptedAt: null },
          $push: { 'assignment.history': { driver_id: ride.driverId, action: 'unassigned', reason: 'late_for_scheduled_pickup', at: now } },
        },
        { new: true },
      );
      if (!released) continue;

      await Driver.updateOne({ _id: ride.driverId }, { $set: { isOnRide: false } });
      push({ driverIds: [String(ride.driverId)] }, 'Ride reassigned', 'You did not reach the pickup in time, so the ride went to another driver.', {
        type: 'scheduled_ride_reassigned',
        rideId: String(ride._id),
      });
      push({ userIds: [String(ride.userId)] }, 'Finding you another driver', 'Your driver could not make it. We are finding you a new one.', {
        type: 'scheduled_ride_reassigned',
        rideId: String(ride._id),
      });
      emitToRoom(getRideRoom(ride._id), 'ride:state', serializeRideRealtime(released));
      emitToRoom(getUserRoom(ride.userId), 'ride:state', serializeRideRealtime(released));

      await redispatchRide(ride._id, ride.driverId);
      reassigned += 1;
    } catch (error) {
      console.error(`[scheduledRide] Reassign failed for ride ${ride._id}:`, error.message);
    }
  }
  return { scheduledRidesReassigned: reassigned };
};
