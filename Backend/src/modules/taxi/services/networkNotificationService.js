import { Driver } from '../driver/models/Driver.js';
import { Owner } from '../admin/models/Owner.js';
import { User } from '../user/models/User.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';
import {
  emitToRoom,
  getAdminRoom,
  getDriverRoom,
  getOrgRoom,
  getPublisherRoom,
  getUserRoom,
} from './dispatchService.js';

const safe = (value, fallback = '') => String(value ?? '').trim() || fallback;

const describeVehicle = (driver) =>
  [safe(driver?.vehicleMake), safe(driver?.vehicleModel)].filter(Boolean).join(' ') ||
  safe(driver?.vehicleType, 'Vehicle');

/**
 * Resolves the human-facing names a network notification needs: the
 * organisation the ride is sold under, the person who owns it, and the driver
 * who will actually turn up.
 */
export const buildNetworkRideContext = async (ride) => {
  const [assignedDriver, creatorDriver, organization] = await Promise.all([
    ride.driverId
      ? Driver.findById(ride.driverId)
          .select('name phone profileImage rating vehicleNumber vehicleColor vehicleMake vehicleModel vehicleType')
          .lean()
      : null,
    ride.created_by_driver_id
      ? Driver.findById(ride.created_by_driver_id).select('name phone owner_id').lean()
      : null,
    ride.organization_owner_id
      ? Owner.findById(ride.organization_owner_id).select('company_name owner_name name mobile').lean()
      : null,
  ]);

  const ownerName =
    safe(organization?.owner_name) || safe(organization?.name) || safe(creatorDriver?.name, 'Owner');

  return {
    assignedDriver,
    creatorDriver,
    organization,
    orgName: safe(organization?.company_name, 'GoKab'),
    ownerName,
    driverName: safe(assignedDriver?.name, 'Driver'),
    vehicleNumber: safe(assignedDriver?.vehicleNumber),
    vehicleLabel: describeVehicle(assignedDriver),
  };
};

const notifyOfflineCustomerBySms = async (ride, context) => {
  const phone = safe(ride.offline_customer?.phone);
  if (!phone) return { sent: false, reason: 'no-phone' };

  try {
    // NOTE: `sendOtpSms` builds its own DLT-approved OTP template and ignores
    // any custom text, so the offline customer currently receives the ride OTP
    // only — not the organisation, driver and pickup details. Sending those
    // needs a second approved DLT template registered with the provider; until
    // that exists, delivering the OTP is better than delivering nothing.
    const { sendOtpSms } = await import('./smsService.js');
    await sendOtpSms({ phone, otp: safe(ride.otp), purpose: 'network_ride_assignment' });
    return { sent: true, detailsIncluded: false };
  } catch (error) {
    console.error('[networkNotification] SMS to offline customer failed:', error.message);
    return { sent: false, reason: error.message };
  }
};

/**
 * Tells everyone who needs to know that a driver-created ride now has a driver:
 * the customer (org + owner + driver + OTP), the driver (pickup + who assigned
 * it), and the organisation's live board.
 */
export const notifyNetworkAssignment = async (ride) => {
  const context = await buildNetworkRideContext(ride);

  const customerPayload = {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
    otp: safe(ride.otp),
    organization: { name: context.orgName, owner_name: context.ownerName },
    driver: context.assignedDriver
      ? {
          id: String(context.assignedDriver._id),
          name: context.driverName,
          phone: safe(context.assignedDriver.phone),
          rating: context.assignedDriver.rating || 0,
          vehicle: {
            number: context.vehicleNumber,
            label: context.vehicleLabel,
            color: safe(context.assignedDriver.vehicleColor),
          },
        }
      : null,
    pickupAddress: safe(ride.pickupAddress),
    dropAddress: safe(ride.dropAddress),
    scheduledAt: ride.scheduledAt,
    fare: ride.fare,
  };

  const customerTitle = `Your ride is confirmed – ${context.orgName}`;
  const customerBody =
    `Owner: ${context.ownerName} · Driver: ${context.driverName}` +
    `${context.vehicleNumber ? ` (${context.vehicleNumber})` : ''} · OTP ${safe(ride.otp)}`;

  if (ride.userId) {
    emitToRoom(getUserRoom(ride.userId), 'network:ride:assigned', customerPayload);
    await sendPushNotificationToEntities({
      userIds: [String(ride.userId)],
      title: customerTitle,
      body: customerBody,
      data: { type: 'network_ride_assigned', rideId: String(ride._id) },
    }).catch((error) => console.error('[networkNotification] customer push failed:', error.message));
  } else {
    await notifyOfflineCustomerBySms(ride, context);
  }

  if (ride.driverId) {
    const driverPayload = {
      rideId: String(ride._id),
      status: ride.status,
      liveStatus: ride.liveStatus,
      otp: safe(ride.otp),
      assignedBy: { name: context.ownerName, org_name: context.orgName },
      pickup: {
        address: safe(ride.pickupAddress),
        coordinates: ride.pickupLocation?.coordinates || [],
      },
      drop: {
        address: safe(ride.dropAddress),
        coordinates: ride.dropLocation?.coordinates || [],
      },
      customer: {
        name: safe(ride.offline_customer?.name),
        phone: safe(ride.offline_customer?.phone),
      },
      scheduledAt: ride.scheduledAt,
      amount: ride.publish?.driver_payout || ride.fare,
    };

    if (ride.userId) {
      const rider = await User.findById(ride.userId).select('name phone').lean();
      driverPayload.customer = { name: safe(rider?.name), phone: safe(rider?.phone) };
    }

    emitToRoom(getDriverRoom(ride.driverId), 'network:ride:assigned', driverPayload);
    await sendPushNotificationToEntities({
      driverIds: [String(ride.driverId)],
      title: `New ride assigned by ${context.ownerName}`,
      body: `${context.orgName} · Pickup: ${safe(ride.pickupAddress, 'see app')}`,
      data: { type: 'network_ride_assigned', rideId: String(ride._id) },
    }).catch((error) => console.error('[networkNotification] driver push failed:', error.message));
  }

  if (ride.organization_owner_id) {
    emitToRoom(getOrgRoom(ride.organization_owner_id), 'org:ride:assigned', {
      rideId: String(ride._id),
      driverId: ride.driverId ? String(ride.driverId) : null,
      driverName: context.driverName,
      liveStatus: ride.liveStatus,
    });
  }

  return context;
};

export const notifyAssignmentRemoved = async ({ ride, removedDriverId, reason = '' }) => {
  if (removedDriverId) {
    emitToRoom(getDriverRoom(removedDriverId), 'network:ride:unassigned', {
      rideId: String(ride._id),
      reason,
    });
    await sendPushNotificationToEntities({
      driverIds: [String(removedDriverId)],
      title: 'Ride assignment removed',
      body: reason || 'The owner has reassigned this ride.',
      data: { type: 'network_ride_unassigned', rideId: String(ride._id) },
    }).catch(() => {});
  }

  if (ride.userId) {
    emitToRoom(getUserRoom(ride.userId), 'network:ride:driver-changed', {
      rideId: String(ride._id),
      status: ride.status,
      liveStatus: ride.liveStatus,
    });
  }
};

export const notifyAssignmentRejected = async ({ ride, driverId, reason = '' }) => {
  const driver = await Driver.findById(driverId).select('name').lean();

  if (ride.created_by_driver_id) {
    emitToRoom(getPublisherRoom(ride.created_by_driver_id), 'network:ride:rejected', {
      rideId: String(ride._id),
      driverId: String(driverId),
      driverName: safe(driver?.name, 'Driver'),
      reason,
    });
    await sendPushNotificationToEntities({
      driverIds: [String(ride.created_by_driver_id)],
      title: `${safe(driver?.name, 'Your driver')} declined a ride`,
      body: reason || 'Assign it to someone else or publish it to the network.',
      data: { type: 'network_ride_rejected', rideId: String(ride._id) },
    }).catch(() => {});
  }
};

export const notifyNetworkRideCancelled = async ({ ride, reason = '' }) => {
  const payload = { rideId: String(ride._id), reason, status: ride.status };

  if (ride.driverId) emitToRoom(getDriverRoom(ride.driverId), 'network:ride:cancelled', payload);
  if (ride.userId) emitToRoom(getUserRoom(ride.userId), 'network:ride:cancelled', payload);
  if (ride.organization_owner_id) {
    emitToRoom(getOrgRoom(ride.organization_owner_id), 'org:ride:cancelled', payload);
  }

  const driverIds = [ride.driverId, ride.created_by_driver_id]
    .filter(Boolean)
    .map(String)
    .filter((id, index, list) => list.indexOf(id) === index);

  if (driverIds.length) {
    await sendPushNotificationToEntities({
      driverIds,
      title: 'Ride cancelled',
      body: reason || 'This ride has been cancelled.',
      data: { type: 'network_ride_cancelled', rideId: String(ride._id) },
    }).catch(() => {});
  }
};

/**
 * Tells both sides how a published ride settled, and gives the publisher the
 * window in which they can dispute it. Without this the dispute feature is
 * effectively undiscoverable — the publisher never learns what the driver
 * claimed about who took the cash.
 */
export const notifyEscrowSettled = async ({ ride, collectedBy, disputeUntil }) => {
  const publisherId = ride?.escrow?.publisher_driver_id;
  const acceptorId = ride?.escrow?.acceptor_driver_id;
  if (!publisherId || !acceptorId) return;

  const publisherHold = Number(ride.escrow.publisher_hold || 0);
  const acceptorHold = Number(ride.escrow.acceptor_hold || 0);

  const describe = {
    publisher: 'You collected the fare',
    driver: 'The driver collected the fare',
    platform: 'The fare was paid in the app',
  }[collectedBy] || 'Settled';

  const payload = {
    rideId: String(ride._id),
    collected_by: collectedBy,
    publisher_hold: publisherHold,
    acceptor_hold: acceptorHold,
    dispute_until: disputeUntil || null,
  };

  emitToRoom(getPublisherRoom(publisherId), 'escrow:settled', { ...payload, can_dispute: true });
  emitToRoom(getDriverRoom(acceptorId), 'escrow:settled', { ...payload, can_dispute: false });
  emitToRoom(getDriverRoom(publisherId), 'wallet:updated', { rideId: String(ride._id) });
  emitToRoom(getDriverRoom(acceptorId), 'wallet:updated', { rideId: String(ride._id) });

  await sendPushNotificationToEntities({
    driverIds: [String(publisherId)],
    title: 'Ride settled',
    body: `${describe}. You can dispute this within the review window.`,
    data: { type: 'escrow_settled', rideId: String(ride._id), collected_by: String(collectedBy) },
  }).catch(() => {});

  await sendPushNotificationToEntities({
    driverIds: [String(acceptorId)],
    title: 'Ride settled',
    body: `${describe}. Your wallet has been updated.`,
    data: { type: 'escrow_settled', rideId: String(ride._id), collected_by: String(collectedBy) },
  }).catch(() => {});
};

export const notifyEscrowDisputed = async ({ ride, reason = '' }) => {
  const acceptorId = ride?.escrow?.acceptor_driver_id;
  const payload = { rideId: String(ride._id), reason };

  if (acceptorId) {
    emitToRoom(getDriverRoom(acceptorId), 'escrow:disputed', payload);
    await sendPushNotificationToEntities({
      driverIds: [String(acceptorId)],
      title: 'A settlement was disputed',
      body: reason || 'The ride owner has raised a dispute. Support will review it.',
      data: { type: 'escrow_disputed', rideId: String(ride._id) },
    }).catch(() => {});
  }

  emitToRoom(getAdminRoom(), 'escrow:disputed', payload);
};

export const notifyEscrowDisputeResolved = async ({ ride, collectedBy }) => {
  const payload = { rideId: String(ride._id), collected_by: collectedBy };

  for (const driverId of [ride?.escrow?.publisher_driver_id, ride?.escrow?.acceptor_driver_id]) {
    if (!driverId) continue;
    emitToRoom(getDriverRoom(driverId), 'escrow:resolved', payload);
    emitToRoom(getDriverRoom(driverId), 'wallet:updated', { rideId: String(ride._id) });
  }

  const driverIds = [ride?.escrow?.publisher_driver_id, ride?.escrow?.acceptor_driver_id]
    .filter(Boolean)
    .map(String);

  if (driverIds.length) {
    await sendPushNotificationToEntities({
      driverIds,
      title: 'Dispute resolved',
      body: 'Support has corrected the settlement. Check your wallet for the updated balance.',
      data: { type: 'escrow_resolved', rideId: String(ride._id) },
    }).catch(() => {});
  }
};

/**
 * Category lifecycle: upgrades, downgrades, and the warning that a broken
 * vehicle rule is about to cost the driver their plan.
 */
export const notifyCategoryChanged = async ({ driverId, category, previousCategory, reason = '' }) => {
  if (!driverId || category === previousCategory) return;

  const rank = { lower: 1, middle: 2, prime: 3 };
  const upgraded = (rank[category] || 0) > (rank[previousCategory] || 0);

  const body = upgraded
    ? `Your plan is now ${category.toUpperCase()}. New features are unlocked in the app.`
    : reason === 'vehicle_rule_broken'
      ? 'Your plan ended because the commercial + private vehicle requirement was not met.'
      : reason === 'prime_slot_revoked_by_admin'
        ? 'Your Prime slot was released by support. You are now on the Lower plan.'
        : 'Your plan has expired. You are now on the Lower plan.';

  emitToRoom(getDriverRoom(driverId), 'driver:category:updated', {
    category,
    previous_category: previousCategory,
    reason,
  });

  await sendPushNotificationToEntities({
    driverIds: [String(driverId)],
    title: upgraded ? 'Plan upgraded' : 'Plan changed',
    body,
    data: { type: 'driver_category_changed', category, reason },
  }).catch(() => {});
};

export const notifyVehicleRuleGraceStarted = async ({ driverId, graceEndsAt, days }) => {
  if (!driverId) return;

  emitToRoom(getDriverRoom(driverId), 'driver:category:grace', {
    grace_ends_at: graceEndsAt,
  });

  await sendPushNotificationToEntities({
    driverIds: [String(driverId)],
    title: 'Action needed to keep your plan',
    body: `Add a commercial vehicle within ${days} days to keep your current category.`,
    data: { type: 'category_grace_started', grace_ends_at: String(graceEndsAt) },
  }).catch(() => {});
};
