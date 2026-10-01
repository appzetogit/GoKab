import { normalizePoint, toPoint } from '../../../../utils/geo.js';
import { Driver } from '../../driver/models/Driver.js';
import { Zone } from '../../driver/models/Zone.js';
import { findZoneByPickup } from '../../services/matchingService.js';
import { SOCKET_EVENTS } from '../events.js';

// The app sends every ~20 s; anything faster than this is a misbehaving or
// duplicated client and is dropped without touching the database.
export const DRIVER_LOCATION_MIN_INTERVAL_MS = 10_000;

const lastAcceptedAtByDriver = new Map();

export const clearDriverLocationThrottle = (driverId) => {
  lastAcceptedAtByDriver.delete(String(driverId));
};

const isStillInsideZone = async (zoneId, coordinates) =>
  Boolean(
    await Zone.exists({
      _id: zoneId,
      active: { $ne: false },
      geometry: { $geoIntersects: { $geometry: { type: 'Point', coordinates } } },
    }),
  );

/**
 * Keeps an online-but-idle driver's position fresh. Dispatch matches nearby
 * rides against `Driver.location`, which otherwise only ever held the single
 * point sent by `PATCH /drivers/online`.
 *
 * Silent by design (no ack): the app fires and forgets, and a rejected beat
 * (offline driver, too frequent, bad point) is not something it can act on.
 */
export const registerDriverLocationSocketHandlers = ({ socket, onAsync }) => {
  socket.on(
    SOCKET_EVENTS.DRIVER_LOCATION_UPDATE,
    onAsync(socket, async ({ coordinates } = {}) => {
      if (socket.auth.role !== 'driver') {
        return;
      }

      const driverId = String(socket.auth.sub);
      const now = Date.now();
      const lastAcceptedAt = lastAcceptedAtByDriver.get(driverId) || 0;
      if (now - lastAcceptedAt < DRIVER_LOCATION_MIN_INTERVAL_MS) {
        return;
      }

      const point = normalizePoint(coordinates, 'coordinates');

      const driver = await Driver.findOne({ _id: driverId, isOnline: true })
        .select('zoneId owner_id')
        .lean();
      if (!driver) {
        return;
      }

      // Claimed before the awaits below so two beats arriving together can't
      // both pass the throttle.
      lastAcceptedAtByDriver.set(driverId, now);

      // Fleet drivers stay pinned to their organisation's zone (same rule as
      // goOnline); everyone else is only re-resolved when they actually leave
      // the zone they were last placed in.
      const pinnedToZone = Boolean(driver.owner_id && driver.zoneId);
      const stillInZone =
        pinnedToZone || (driver.zoneId ? await isStillInsideZone(driver.zoneId, point) : false);

      const update = {
        location: toPoint(point, 'coordinates'),
        locationUpdatedAt: new Date(now),
      };
      if (!stillInZone) {
        const zone = await findZoneByPickup(point);
        update.zoneId = zone?._id || null;
      }

      // `isOnline: true` in the filter again: the driver may have gone offline
      // between the read above and this write.
      await Driver.updateOne({ _id: driverId, isOnline: true }, { $set: update });
    }),
  );
};
