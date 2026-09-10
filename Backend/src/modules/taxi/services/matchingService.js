import { ApiError } from '../../../utils/ApiError.js';
import { normalizePoint } from '../../../utils/geo.js';
import { DISPATCH_TOP_DRIVERS } from '../constants/index.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { Driver } from '../driver/models/Driver.js';
import { Zone } from '../driver/models/Zone.js';
import { getDriverIdsBlockedByUpcomingScheduledRides } from './rideService.js';
import { subscriptionTierService } from './subscriptionTierService.js';

const EARTH_RADIUS_METERS = 6371000;

const normalizeVehicleKey = (value = '') => String(value || '').trim().toLowerCase();

const normalizeVehicleKeys = (vehicles = []) => {
  const keys = vehicles.flatMap((vehicle) => [
    vehicle?.name,
    vehicle?.vehicle_type,
    vehicle?.icon_types,
    String(vehicle?.name || '').replace(/\s+/g, '_'),
    String(vehicle?.icon_types || '').replace(/\s+/g, '_'),
  ]);

  return [...new Set(keys.map(normalizeVehicleKey).filter(Boolean))];
};

const normalizeVehicleTypeIds = (vehicleTypeIds = [], vehicleTypeId = null) => {
  const values = Array.isArray(vehicleTypeIds) ? vehicleTypeIds : [vehicleTypeIds];

  if (vehicleTypeId) {
    values.push(vehicleTypeId);
  }

  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
};

const buildWalletEligibilityQuery = () => ({
  $or: [
    { owner_id: { $ne: null } },
    { 'wallet.isBlocked': { $ne: true } },
  ],
});

const buildDriverMatchFilters = ({ zoneId, serviceLocationId, vehicleTypeId, vehicleTypeIds, vehicleTypeKeys }) => {
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const normalizedVehicleTypeKeys = Array.isArray(vehicleTypeKeys)
    ? [...new Set(vehicleTypeKeys.map(normalizeVehicleKey).filter(Boolean))]
    : [];
  const vehicleTypeClauses = [
    ...(normalizedVehicleTypeIds.length ? [{ vehicleTypeId: { $in: normalizedVehicleTypeIds } }] : []),
    ...(normalizedVehicleTypeKeys.length
      ? [
          { vehicleType: { $in: normalizedVehicleTypeKeys } },
          { vehicleIconType: { $in: normalizedVehicleTypeKeys } },
        ]
      : []),
  ];
  const vehicleTypeFilter =
    vehicleTypeClauses.length > 1
      ? { $or: vehicleTypeClauses }
      : vehicleTypeClauses[0] || {};

  const filters = [
    {
      isOnline: true,
      isOnRide: false,
      approve: true,
      status: { $nin: ['inactive', 'rejected', 'pending'] },
      ...(zoneId ? { zoneId } : {}),
      ...(serviceLocationId ? { service_location_id: serviceLocationId } : {}),
    },
    buildWalletEligibilityQuery(),
    Object.keys(vehicleTypeFilter).length ? vehicleTypeFilter : null,
  ].filter(Boolean);

  return filters.length === 1 ? filters[0] : { $and: filters };
};

export const findZoneByPickup = async (pickupCoords) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');

  // Zones are authoritative for dispatch, so every pickup must belong to one polygon.
  // An admin-deactivated zone must not keep scoping live dispatch, so exclude it here
  // rather than relying on callers to re-check `active` themselves.
  return Zone.findOne({
    active: { $ne: false },
    geometry: {
      $geoIntersects: {
        $geometry: {
          type: 'Point',
          coordinates,
        },
      },
    },
  });
};

const toLocalMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;
  const originLatRadians = (originLat * Math.PI) / 180;
  const metersPerDegreeLat = (Math.PI * EARTH_RADIUS_METERS) / 180;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(originLatRadians);

  return {
    x: (targetLng - originLng) * metersPerDegreeLng,
    y: (targetLat - originLat) * metersPerDegreeLat,
  };
};

const getDistanceToSegmentMeters = (origin, segmentStart, segmentEnd) => {
  const start = toLocalMeters(origin, segmentStart);
  const end = toLocalMeters(origin, segmentEnd);
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = (segmentX * segmentX) + (segmentY * segmentY);

  if (segmentLengthSquared <= 0) {
    return Math.hypot(start.x, start.y);
  }

  const projection = Math.max(
    0,
    Math.min(1, -((start.x * segmentX) + (start.y * segmentY)) / segmentLengthSquared),
  );
  const closestX = start.x + (projection * segmentX);
  const closestY = start.y + (projection * segmentY);

  return Math.hypot(closestX, closestY);
};

const getZoneBoundaryCapMeters = (zone, pickupCoords) => {
  const ring = Array.isArray(zone?.geometry?.coordinates?.[0]) ? zone.geometry.coordinates[0] : [];

  if (ring.length < 3) {
    return null;
  }

  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const segmentStart = normalizePoint(ring[index], `zone.geometry.coordinates[0][${index}]`);
    const segmentEnd = normalizePoint(ring[index + 1], `zone.geometry.coordinates[0][${index + 1}]`);
    const distanceMeters = getDistanceToSegmentMeters(pickupCoords, segmentStart, segmentEnd);

    if (Number.isFinite(distanceMeters) && distanceMeters < shortestDistance) {
      shortestDistance = distanceMeters;
    }
  }

  return Number.isFinite(shortestDistance) ? Math.max(0, Math.round(shortestDistance)) : null;
};

const getDistanceBetweenMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;

  const dLat = ((targetLat - originLat) * Math.PI) / 180;
  const dLng = ((targetLng - originLng) * Math.PI) / 180;
  const lat1 = (originLat * Math.PI) / 180;
  const lat2 = (targetLat * Math.PI) / 180;

  const a =
    (Math.sin(dLat / 2) ** 2) +
    (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2));

  return Math.round(2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const buildGeoNearFilter = (field, coordinates, maxDistance) => ({
  [field]: {
    $near: {
      $geometry: {
        type: 'Point',
        coordinates,
      },
      $maxDistance: maxDistance,
    },
  },
});

const getDispatchAnchorCoordinates = (driver = {}) => {
  const routeCoordinates = Array.isArray(driver?.routeBooking?.anchorLocation?.coordinates)
    ? driver.routeBooking.anchorLocation.coordinates
    : [];

  if (driver?.routeBooking?.enabled && routeCoordinates.length === 2) {
    return routeCoordinates;
  }

  return Array.isArray(driver?.location?.coordinates) ? driver.location.coordinates : [];
};

const sortDriversByDispatchAnchorDistance = (drivers = [], pickupCoords) =>
  [...drivers]
    .map((driver) => {
      const anchorCoordinates = getDispatchAnchorCoordinates(driver);
      return {
        driver,
        distanceMeters:
          anchorCoordinates.length === 2
            ? getDistanceBetweenMeters(pickupCoords, anchorCoordinates)
            : Number.POSITIVE_INFINITY,
      };
    })
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .map(({ driver }) => driver);

const findDriversForZone = async ({
  zoneId,
  serviceLocationId,
  coordinates,
  effectiveMaxDistance,
  limit,
  normalizedVehicleTypeIds,
  vehicleTypeKeys,
}) => {
  const commonFilters = buildDriverMatchFilters({
    zoneId,
    serviceLocationId,
    vehicleTypeIds: normalizedVehicleTypeIds,
    vehicleTypeKeys,
  });
  const selectedFields =
    'name phone socketId vehicleTypeId vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel rating location zoneId service_location_id isOnline isOnRide routeBooking owner_id assignedFleetVehicleId';

  const [liveLocationDrivers, routeBookingDrivers] = await Promise.all([
    Driver.find({
      ...commonFilters,
      'routeBooking.enabled': { $ne: true },
      ...buildGeoNearFilter('location', coordinates, effectiveMaxDistance),
    })
      .limit(limit)
      .select(selectedFields),
    Driver.find({
      ...commonFilters,
      'routeBooking.enabled': true,
      'routeBooking.anchorLocation': { $ne: null },
      'routeBooking.anchorLocation.coordinates.1': { $exists: true },
      ...buildGeoNearFilter('routeBooking.anchorLocation', coordinates, effectiveMaxDistance),
    })
      .limit(limit)
      .select(selectedFields),
  ]);

  return sortDriversByDispatchAnchorDistance(
    [...liveLocationDrivers, ...routeBookingDrivers].filter(
      (driver, index, items) => items.findIndex((item) => String(item._id) === String(driver._id)) === index,
    ),
    coordinates,
  ).slice(0, limit);
};

export const matchDrivers = async (pickupCoords, options = {}) => {
  const coordinates = normalizePoint(pickupCoords, 'pickupCoords');
  const {
    maxDistance = 3000,
    limit = DISPATCH_TOP_DRIVERS,
    vehicleTypeId,
    vehicleTypeIds,
    serviceLocationId = null,
    rideModuleCode = null, // e.g. 'outstation', 'airport', 'parcel', 'carpool'
    paymentMethod = 'cash',
  } = options;
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const allowedVehicles = normalizedVehicleTypeIds.length
    ? await Vehicle.find({ _id: { $in: normalizedVehicleTypeIds } }).select('name vehicle_type icon_types').lean()
    : [];
  const vehicleTypeKeys = normalizeVehicleKeys(allowedVehicles);

  const zone = await findZoneByPickup(coordinates);
  const zoneBoundaryCapMeters = zone ? getZoneBoundaryCapMeters(zone, coordinates) : null;
  const effectiveMaxDistance = Number.isFinite(zoneBoundaryCapMeters) && zoneBoundaryCapMeters >= 0
    ? Math.min(Math.max(1, Math.round(maxDistance)), Math.max(1, zoneBoundaryCapMeters))
    : Math.max(1, Math.round(maxDistance));

  let rawDrivers = await findDriversForZone({
    zoneId: zone?._id || null,
    serviceLocationId,
    coordinates,
    effectiveMaxDistance,
    limit: limit * 2, // Fetch extra candidate buffer before filtering
    normalizedVehicleTypeIds,
    vehicleTypeKeys,
  });

  const blockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
    rawDrivers.map((driver) => String(driver?._id || '')),
  );
  rawDrivers = rawDrivers.filter((driver) => !blockedDriverIds.has(String(driver?._id || '')));

  if (rawDrivers.length === 0 && zone?._id) {
    rawDrivers = await findDriversForZone({
      zoneId: null,
      serviceLocationId,
      coordinates,
      effectiveMaxDistance,
      limit: limit * 2,
      normalizedVehicleTypeIds,
      vehicleTypeKeys,
    });

    const fallbackBlockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
      rawDrivers.map((driver) => String(driver?._id || '')),
    );
    rawDrivers = rawDrivers.filter((driver) => !fallbackBlockedDriverIds.has(String(driver?._id || '')));
  }

  // Filter candidates by Subscription Tier rules (Module permissions, Cash Debt limits, and Priority score sort)
  const qualifiedDrivers = [];
  for (const driver of rawDrivers) {
    try {
      const tier = await subscriptionTierService.getEffectiveDriverTier(driver._id);
      if (!tier) continue; // Blocked if no subscription and no fallback default tier

      // Module Access Check
      if (rideModuleCode) {
        const allowedModules = (tier.ride_module_ids || []).map((m) => String(m.code || m._id || m).toLowerCase());
        if (allowedModules.length > 0 && !allowedModules.includes(String(rideModuleCode).toLowerCase())) {
          continue; // Tier doesn't allow this module
        }
      }

      // Cash Debt Limit Check
      if (paymentMethod === 'cash') {
        const currentBalance = Number(driver?.wallet?.balance || 0);
        const maxDebtAllowed = Number(tier.max_cash_debt_allowed || 0);
        if (currentBalance < -maxDebtAllowed) {
          continue; // Driver cash debt exceeds tier limit
        }
      }

      const driverObj = driver.toObject ? driver.toObject() : driver;
      driverObj.subscriptionTier = {
        name: tier.name,
        priority_score: tier.priority_score || 0,
        badge_color_hex: tier.badge_color_hex || '#10B981',
        map_icon_asset_url: tier.map_icon_asset_url || '',
      };
      qualifiedDrivers.push(driverObj);
    } catch (e) {
      qualifiedDrivers.push(driver);
    }
  }

  // Sort qualified drivers by Priority Score descending (highest priority wave first)
  qualifiedDrivers.sort((a, b) => {
    const scoreA = Number(a?.subscriptionTier?.priority_score || 0);
    const scoreB = Number(b?.subscriptionTier?.priority_score || 0);
    return scoreB - scoreA;
  });

  return {
    zone,
    drivers: qualifiedDrivers.slice(0, limit),
    searchRadiusMeters: effectiveMaxDistance,
    zoneBoundaryCapMeters,
  };
};
