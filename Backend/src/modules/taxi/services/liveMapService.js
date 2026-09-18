import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { Driver } from '../driver/models/Driver.js';
import { Ride } from '../user/models/Ride.js';
import { haversineMeters } from '../../../utils/geo.js';
import { getDriverNetworkSettings } from './appSettingsService.js';
import { emitToRoom, getOrgRoom, getPublisherRoom } from './dispatchService.js';

// One entry per ride, so a location packet does not cost a database read.
// Invalidated whenever the ride's status changes or it ends.
const rideMetaCache = new Map();
const lastEmitAt = new Map();

export const invalidateLiveMapRide = (rideId) => {
  rideMetaCache.delete(String(rideId));
  lastEmitAt.delete(String(rideId));
};

const loadRideMeta = async (ride) => {
  const key = String(ride._id);
  const cached = rideMetaCache.get(key);
  if (cached && cached.liveStatus === ride.liveStatus) return cached;

  const driver = ride.driverId
    ? await Driver.findById(ride.driverId).select('name phone vehicleNumber').lean()
    : null;

  const meta = {
    liveStatus: ride.liveStatus,
    organizationOwnerId: ride.organization_owner_id ? String(ride.organization_owner_id) : null,
    createdByDriverId: ride.created_by_driver_id ? String(ride.created_by_driver_id) : null,
    isPublished: Boolean(ride.publish?.is_published),
    driverName: driver?.name || '',
    driverPhone: driver?.phone || '',
    vehicleNumber: driver?.vehicleNumber || '',
    pickup: ride.pickupAddress || '',
    drop: ride.dropAddress || '',
  };

  rideMetaCache.set(key, meta);
  return meta;
};

/**
 * Pushes a driver's position to the people entitled to watch it.
 *
 * Location is only shared **after the pickup OTP is entered** — before that the
 * owner sees status only. That boundary is the requirement, and it also keeps a
 * driver's movements private while they are merely on their way.
 */
export const broadcastNetworkLocation = async ({ ride, coordinates, heading, speed }) => {
  if (!ride) return;
  if (ride.liveStatus !== RIDE_LIVE_STATUS.STARTED) return;

  const meta = await loadRideMeta(ride);
  if (!meta.organizationOwnerId && !meta.isPublished) return;

  const settings = await getDriverNetworkSettings();
  const interval = Math.max(0, Number(settings.live_location_emit_interval_ms ?? 4000));
  const key = String(ride._id);
  const now = Date.now();

  // GPS updates arrive far faster than a map needs; without this the org room
  // would get a packet per driver per second.
  if (interval > 0 && now - (lastEmitAt.get(key) || 0) < interval) return;
  lastEmitAt.set(key, now);

  const payload = {
    rideId: key,
    driverId: String(ride.driverId),
    driverName: meta.driverName,
    vehicleNumber: meta.vehicleNumber,
    coordinates,
    heading: heading ?? null,
    speed: speed ?? null,
    pickup: meta.pickup,
    drop: meta.drop,
    liveStatus: ride.liveStatus,
    at: now,
  };

  if (meta.organizationOwnerId) {
    emitToRoom(getOrgRoom(meta.organizationOwnerId), 'org:live-location', payload);
  }
  if (meta.isPublished && meta.createdByDriverId) {
    emitToRoom(getPublisherRoom(meta.createdByDriverId), 'org:live-location', payload);
  }
};

export const broadcastNetworkRideLifecycle = async (ride) => {
  if (!ride?.organization_owner_id && !ride?.publish?.is_published) return;

  invalidateLiveMapRide(ride._id);

  const event =
    ride.liveStatus === RIDE_LIVE_STATUS.STARTED
      ? 'org:ride-started'
      : [RIDE_LIVE_STATUS.COMPLETED, RIDE_LIVE_STATUS.CANCELLED].includes(ride.liveStatus)
        ? 'org:ride-ended'
        : null;

  if (!event) return;

  const payload = {
    rideId: String(ride._id),
    driverId: ride.driverId ? String(ride.driverId) : null,
    liveStatus: ride.liveStatus,
    status: ride.status,
  };

  if (ride.organization_owner_id) {
    emitToRoom(getOrgRoom(ride.organization_owner_id), event, payload);
  }
  if (ride.publish?.is_published && ride.created_by_driver_id) {
    emitToRoom(getPublisherRoom(ride.created_by_driver_id), event, payload);
  }
};

// Straight-line distance at a nominal road speed. Good enough for "roughly how
// far off is my driver" on a map; a routing call per marker would be far more
// expensive than the answer is worth.
const AVERAGE_SPEED_KMPH = 40;

const estimateEtaMinutes = (ride) => {
  const from = ride.lastDriverLocation?.coordinates;
  const to = ride.dropLocation?.coordinates;
  if (!Array.isArray(from) || from.length !== 2 || !Array.isArray(to) || to.length !== 2) {
    return null;
  }

  const km = haversineMeters(from, to) / 1000;
  return Math.max(1, Math.round((km / AVERAGE_SPEED_KMPH) * 60));
};

/**
 * The map snapshot an owner opens the screen with: every live ride belonging to
 * their organisation, plus any ride they published that an outside driver is
 * running. Coordinates are withheld until the trip has actually started.
 */
export const getLiveMapSnapshot = async (driverId) => {
  const driver = await Driver.findById(driverId).select('owner_id').lean();

  const filter = {
    status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
    $or: [
      ...(driver?.owner_id ? [{ organization_owner_id: driver.owner_id }] : []),
      { created_by_driver_id: driverId, 'publish.is_published': true },
    ],
  };

  const rides = await Ride.find(filter)
    .select(
      '_id driverId liveStatus status pickupAddress dropAddress lastDriverLocation dropLocation ' +
        'organization_owner_id created_by_driver_id publish',
    )
    .lean();

  const drivers = rides.length
    ? await Driver.find({ _id: { $in: rides.map((ride) => ride.driverId).filter(Boolean) } })
        .select('name phone vehicleNumber owner_id')
        .lean()
    : [];
  const driverMap = new Map(drivers.map((item) => [String(item._id), item]));

  return {
    drivers: rides.map((ride) => {
      const rideDriver = driverMap.get(String(ride.driverId));
      const started = ride.liveStatus === RIDE_LIVE_STATUS.STARTED;

      return {
        rideId: String(ride._id),
        driverId: ride.driverId ? String(ride.driverId) : null,
        name: rideDriver?.name || '',
        phone: rideDriver?.phone || '',
        vehicleNumber: rideDriver?.vehicleNumber || '',
        // The label describes *who is driving*, not who sold the ride. A ride
        // created under the owner's organisation but picked up off the network
        // is being run by an outsider, and the map has to say so.
        relation:
          driver?.owner_id && String(rideDriver?.owner_id || '') === String(driver.owner_id)
            ? 'fleet'
            : 'published_acceptor',
        liveStatus: ride.liveStatus,
        // Withheld until the OTP is in, matching the realtime rule above.
        location: started ? ride.lastDriverLocation?.coordinates || null : null,
        heading: started ? ride.lastDriverLocation?.heading ?? null : null,
        updatedAt: started ? ride.lastDriverLocation?.updatedAt || null : null,
        pickup: ride.pickupAddress || '',
        drop: ride.dropAddress || '',
        eta_minutes: started ? estimateEtaMinutes(ride) : null,
      };
    }),
  };
};
