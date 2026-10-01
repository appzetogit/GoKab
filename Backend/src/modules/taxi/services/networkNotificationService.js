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
  const assignerId = ride.assignment?.assigned_by_driver_id || ride.created_by_driver_id || null;
  const assignerIsCreator = String(assignerId || '') === String(ride.created_by_driver_id || '');

  const [assignedDriver, creatorDriver, organization, separateAssignerDriver] = await Promise.all([
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
    assignerId && !assignerIsCreator ? Driver.findById(assignerId).select('name phone').lean() : null,
  ]);

  const ownerName =
    safe(organization?.owner_name) || safe(organization?.name) || safe(creatorDriver?.name, 'Owner');

  return {
    assignedDriver,
    creatorDriver,
    organization,
    assignerId,
    assignerDriver: assignerIsCreator ? creatorDriver : separateAssignerDriver,
    orgName: safe(organization?.company_name, 'GoKab'),
    ownerName,
    driverName: safe(assignedDriver?.name, 'Driver'),
    vehicleNumber: safe(assignedDriver?.vehicleNumber),
    vehicleLabel: describeVehicle(assignedDriver),
  };
};

/**
 * Shared shape for "who handed this ride to the driver" — used by the
 * `assigned_by` field on network-ride list/detail responses so the card can
 * show "From: Ram Travels · Ram" without a toast-only socket event being the
 * only place that info ever appeared. Deliberately reuses `ownerName`'s
 * precedence (org owner_name -> org name -> creator's own name) so the name
 * shown here always matches what `notifyNetworkAssignment`'s toast already
 * says, rather than drifting from it over time.
 */
export const buildAssignedByPayload = ({ assignerId, assignerDriver, organization, creatorDriver }) => {
  if (!assignerId) return null;

  return {
    driver_id: String(assignerId),
    name: safe(organization?.owner_name) || safe(organization?.name) || safe(creatorDriver?.name, 'Owner'),
    phone: safe(assignerDriver?.phone),
    org_name: safe(organization?.company_name),
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

/**
 * The assigned fleet driver confirmed the job: refresh the owner's board and
 * tell whoever created/assigned the ride, so "Waiting for driver" can flip to
 * "Confirmed" without the owner reopening the list.
 */
export const notifyAssignmentAcknowledged = async ({ ride, driver }) => {
  const driverId = String(driver?._id || ride.driverId || '');
  const driverName = safe(driver?.name, 'Driver');

  if (ride.organization_owner_id) {
    emitToRoom(getOrgRoom(ride.organization_owner_id), 'org:ride:acknowledged', {
      rideId: String(ride._id),
      driverId,
      driverName,
    });
  }

  const ownerDriverIds = [ride.created_by_driver_id, ride.assignment?.assigned_by_driver_id]
    .filter(Boolean)
    .map(String)
    .filter((id, index, list) => list.indexOf(id) === index && id !== driverId);

  if (ownerDriverIds.length) {
    await sendPushNotificationToEntities({
      driverIds: ownerDriverIds,
      title: `${driverName} confirmed the ride`,
      body: `Pickup: ${safe(ride.pickupAddress, 'see app')}`,
      data: { type: 'network_ride_acknowledged', rideId: String(ride._id) },
    }).catch((error) => console.error('[networkNotification] acknowledge push failed:', error.message));
  }
};

const formatPickupTime = (date) =>
  new Date(date).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

// Who counts as "the owner" of a driver-created ride: whoever created it and
// whoever last assigned it — minus the assigned driver themselves, who must
// not be told "your driver hasn't confirmed" about their own job.
export const resolveRideOwnerDriverIds = (ride) =>
  [ride.created_by_driver_id, ride.assignment?.assigned_by_driver_id]
    .filter(Boolean)
    .map(String)
    .filter((id, index, list) => list.indexOf(id) === index && id !== String(ride.driverId || ''));

export const notifyScheduledRideReminder = async (ride) => {
  if (!ride.driverId) return;

  await sendPushNotificationToEntities({
    driverIds: [String(ride.driverId)],
    title: 'Upcoming scheduled ride',
    body: `Pickup at ${formatPickupTime(ride.scheduledAt)} · ${safe(ride.pickupAddress, 'see app')}`,
    data: { type: 'scheduled_ride_reminder', rideId: String(ride._id) },
  });
};

export const notifyScheduledRideReminderOwner = async (ride, driverName = 'Your driver') => {
  const driverIds = resolveRideOwnerDriverIds(ride);
  if (!driverIds.length) return;

  await sendPushNotificationToEntities({
    driverIds,
    title: 'Scheduled ride not confirmed yet',
    body: `${driverName} hasn't confirmed the ${formatPickupTime(ride.scheduledAt)} pickup at ${safe(ride.pickupAddress, 'see app')}`,
    data: { type: 'scheduled_ride_reminder_owner', rideId: String(ride._id) },
  });
};

export const notifyAssignmentUnacknowledged = async (ride, driverName = 'Your driver') => {
  const driverIds = resolveRideOwnerDriverIds(ride);
  if (!driverIds.length) return;

  await sendPushNotificationToEntities({
    driverIds,
    title: 'Driver has not confirmed',
    body: `${driverName} hasn't confirmed the ride from ${safe(ride.pickupAddress, 'the pickup')}. Check Network Rides.`,
    data: { type: 'network_ride_unacknowledged', rideId: String(ride._id) },
  });
};

export const notifyVehicleDocumentExpiring = async ({ driverIds, vehicle, key, expiresAt, daysLeft }) => {
  if (!driverIds?.length) return;

  const when = daysLeft <= 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;

  await sendPushNotificationToEntities({
    driverIds: driverIds.map(String),
    title: 'Vehicle document expiring',
    body: `${safe(vehicle.license_plate_number, 'A vehicle')}: ${key.replace(/_/g, ' ')} expires ${when}. Renew it to keep the vehicle active.`,
    data: {
      type: 'vehicle_document_expiring',
      vehicle_id: String(vehicle._id),
      key,
      expires_at: new Date(expiresAt).toISOString(),
    },
  });
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

/**
 * A fleet vehicle being approved or rejected had no driver-facing signal at
 * all (updateFleetVehicle only ever saved the fields) — a driver who added a
 * vehicle to unlock Prime/Elite had no way to know it was reviewed short of
 * refreshing the vehicle list and noticing the status changed on its own.
 */
export const notifyVehicleStatusChanged = async ({ driverId, vehicleId, status, reason = '' }) => {
  if (!driverId || !vehicleId) return;

  const normalizedStatus = safe(status, 'pending').toLowerCase();
  const approved = normalizedStatus === 'approved';
  const rejected = normalizedStatus === 'rejected';
  if (!approved && !rejected) return;

  emitToRoom(getDriverRoom(driverId), 'driver:vehicle:status', {
    vehicle_id: String(vehicleId),
    status: normalizedStatus,
    reason,
  });

  await sendPushNotificationToEntities({
    driverIds: [String(driverId)],
    title: approved ? 'Vehicle approved' : 'Vehicle rejected',
    body: approved
      ? 'Your added vehicle has been approved and now counts toward your plan.'
      : reason
        ? `Your added vehicle was rejected: ${reason}`
        : 'Your added vehicle was rejected. Check the app for details.',
    data: { type: 'vehicle_status_changed', vehicle_id: String(vehicleId), status: normalizedStatus, reason },
  }).catch(() => {});
};
