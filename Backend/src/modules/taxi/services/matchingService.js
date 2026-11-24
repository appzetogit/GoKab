import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import { normalizePoint } from '../../../utils/geo.js';
import { DISPATCH_TOP_DRIVERS } from '../constants/index.js';
import { Vehicle } from '../admin/models/Vehicle.js';
import { FleetVehicle } from '../admin/models/FleetVehicle.js';
import { Driver } from '../driver/models/Driver.js';
import { Zone } from '../driver/models/Zone.js';
import { getDriverIdsBlockedByUpcomingScheduledRides } from './rideService.js';
import { driverAcceptsTrip, findDriversWhoseActiveRouteMatches } from './routeMatchService.js';
import { subscriptionTierService } from './subscriptionTierService.js';
import { getPlanIdsForDrivers } from './requestStepsService.js';

const EARTH_RADIUS_METERS = 6371000;

// ponytail: the nearest this many per request step; raise it if one step ever has more drivers in range.
const STEP_CANDIDATE_LIMIT = 300;
const STEP_CHECKS_AT_ONCE = 20;

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

// A driver who has never reported a position timestamp (data from before
// `locationUpdatedAt` existed) is kept, not excluded.
const buildFreshLocationQuery = () => {
  if (!env.driverLocationStaleSeconds) {
    return null;
  }

  return {
    $or: [
      { locationUpdatedAt: null },
      { locationUpdatedAt: { $gte: new Date(Date.now() - env.driverLocationStaleSeconds * 1000) } },
    ],
  };
};

const buildDriverMatchFilters = ({ zoneId, serviceLocationId, vehicleTypeId, vehicleTypeIds, vehicleTypeKeys, fleetOwnerIds = [] }) => {
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
    ...(fleetOwnerIds.length ? [{ owner_id: { $in: fleetOwnerIds }, is_self_drive_owner: true }] : []),
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

const MATCH_FIELDS =
  'name phone socketId vehicleTypeId vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel rating location zoneId service_location_id isOnline isOnRide routeBooking owner_id is_self_drive_owner assignedFleetVehicleId wallet route_mode active_route_id driver_category';

const findDriversForZone = async ({
  zoneId,
  serviceLocationId,
  coordinates,
  effectiveMaxDistance,
  limit,
  normalizedVehicleTypeIds,
  vehicleTypeKeys,
  fleetOwnerIds = [],
}) => {
  const commonFilters = buildDriverMatchFilters({
    zoneId,
    serviceLocationId,
    vehicleTypeIds: normalizedVehicleTypeIds,
    vehicleTypeKeys,
    fleetOwnerIds,
  });
  // `wallet` has to be selected for the cash-debt check downstream to see a real
  // balance — without it every driver reads as balance 0 and the tier's debt
  // limit silently never applies.
  const selectedFields = MATCH_FIELDS;

  // Staleness only matters for drivers matched on their *live* position. A
  // route-booking driver is matched on their saved anchor point, which never
  // goes stale, so they are deliberately exempt.
  const freshLocationQuery = buildFreshLocationQuery();

  const [liveLocationDrivers, routeBookingDrivers] = await Promise.all([
    Driver.find({
      ...(freshLocationQuery ? { $and: [commonFilters, freshLocationQuery] } : commonFilters),
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
    rideModuleCode = null, // e.g. 'outstation', 'airport', 'carpool'
    paymentMethod = 'cash',
    dropCoords = null,
    // Request steps: ask every eligible driver of these plans instead of the top few.
    // { planIds, excludeDriverIds, onlyDriverId }
    step = null,
  } = options;
  const normalizedVehicleTypeIds = normalizeVehicleTypeIds(vehicleTypeIds, vehicleTypeId);
  const allowedVehicles = normalizedVehicleTypeIds.length
    ? await Vehicle.find({ _id: { $in: normalizedVehicleTypeIds } }).select('name vehicle_type icon_types').lean()
    : [];
  const vehicleTypeKeys = normalizeVehicleKeys(allowedVehicles);
  const fleetOwnerIds = normalizedVehicleTypeIds.length
    ? await FleetVehicle.distinct('owner_id', {
        vehicle_type_id: { $in: normalizedVehicleTypeIds },
        status: 'approved',
        active: true,
      })
    : [];

  const zone = await findZoneByPickup(coordinates);
  // A step's radius is the admin's; the zone edge does not shrink it.
  const zoneBoundaryCapMeters = zone && !step ? getZoneBoundaryCapMeters(zone, coordinates) : null;
  const effectiveMaxDistance = Number.isFinite(zoneBoundaryCapMeters) && zoneBoundaryCapMeters >= 0
    ? Math.min(Math.max(1, Math.round(maxDistance)), Math.max(1, zoneBoundaryCapMeters))
    : Math.max(1, Math.round(maxDistance));

  const candidateLimit = step ? STEP_CANDIDATE_LIMIT : limit * 2;
  const excluded = new Set((step?.excludeDriverIds || []).map(String));
  const isWanted = (driver) =>
    !excluded.has(String(driver._id)) && (!step?.onlyDriverId || String(driver._id) === String(step.onlyDriverId));

  let rawDrivers = await findDriversForZone({
    zoneId: step ? null : zone?._id || null,
    serviceLocationId,
    coordinates,
    effectiveMaxDistance,
    limit: candidateLimit, // Fetch extra candidate buffer before filtering
    normalizedVehicleTypeIds,
    vehicleTypeKeys,
    fleetOwnerIds,
  });

  const blockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
    rawDrivers.map((driver) => String(driver?._id || '')),
  );
  rawDrivers = rawDrivers.filter((driver) => !blockedDriverIds.has(String(driver?._id || '')));

  if (rawDrivers.length === 0 && zone?._id && !step) {
    rawDrivers = await findDriversForZone({
      zoneId: null,
      serviceLocationId,
      coordinates,
      effectiveMaxDistance,
      limit: limit * 2,
      normalizedVehicleTypeIds,
      vehicleTypeKeys,
      fleetOwnerIds,
    });

    const fallbackBlockedDriverIds = await getDriverIdsBlockedByUpcomingScheduledRides(
      rawDrivers.map((driver) => String(driver?._id || '')),
    );
    rawDrivers = rawDrivers.filter((driver) => !fallbackBlockedDriverIds.has(String(driver?._id || '')));
  }

  // A driver working a fixed corridor can be far outside the pickup radius and
  // still be the right match (parked in Indore, pickup in Ujjain on their
  // route). Radius search can never surface them, so pull them in separately
  // and de-duplicate.
  if (coordinates) {
    const routeMatched = await findDriversWhoseActiveRouteMatches({
      pickup: coordinates,
      drop: dropCoords,
      serviceLocationId,
      limit: candidateLimit,
      // The driver's saved route, not their home city, is the geographic
      // filter for these candidates — see routeMatchService.js.
      ignoreServiceLocation: true,
    });

    if (routeMatched.length) {
      const seen = new Set(rawDrivers.map((driver) => String(driver._id)));
      const eligibleRouteMatched = routeMatched.filter(
        (driver) =>
          !seen.has(String(driver._id)) &&
          driver.isOnline === true &&
          driver.isOnRide !== true &&
          !blockedDriverIds.has(String(driver._id)),
      );
      if (step) {
        // The route search ignores vehicle, wallet and approval, and loads too few
        // fields to tell a team lead from a member: read these drivers again under
        // the same rules as everyone else.
        const ids = eligibleRouteMatched.filter(isWanted).map((driver) => driver._id);
        const blockedIds = await getDriverIdsBlockedByUpcomingScheduledRides(ids.map(String));
        const eligible = ids.length
          ? await Driver.find({
              _id: { $in: ids },
              deletedAt: null,
              ...buildDriverMatchFilters({ vehicleTypeIds: normalizedVehicleTypeIds, vehicleTypeKeys, fleetOwnerIds }),
            }).select(MATCH_FIELDS)
          : [];
        rawDrivers = [...rawDrivers, ...eligible.filter((driver) => !blockedIds.has(String(driver._id)))];
      } else {
        rawDrivers = [...rawDrivers, ...eligibleRouteMatched];
      }
    }
  }

  if (step) {
    rawDrivers = rawDrivers.filter(isWanted);
    const planIds = await getPlanIdsForDrivers(rawDrivers.map((driver) => driver._id));
    const wantedPlans = new Set(step.planIds.map(String));
    rawDrivers = rawDrivers.filter((driver) => wantedPlans.has(planIds.get(String(driver._id))));
  }

  // Filter candidates by Subscription Tier rules (Module permissions, Cash Debt limits, and Priority score sort)
  const routeCache = new Map();
  const qualifiedDrivers = [];
  const skippedForDebt = [];
  const candidateCount = rawDrivers.length;
  const checkDriver = async (driver) => {
    // Honour the corridor the driver selected: in `route` mode they only want
    // trips that run along it, in the right direction.
    if (driver.route_mode === 'route') {
      const routeResult = await driverAcceptsTrip({
        driver,
        pickup: coordinates,
        drop: dropCoords,
        routeCache,
      });
      if (!routeResult.match) return;
    }

    try {
      const tier = await subscriptionTierService.getEffectiveDriverTier(driver._id);
      if (!tier) return; // Blocked if no subscription and no fallback default tier

      // Module Access Check
      if (rideModuleCode) {
        const allowedModules = (tier.ride_module_ids || []).map((m) => String(m.code || m._id || m).toLowerCase());
        if (allowedModules.length > 0 && !allowedModules.includes(String(rideModuleCode).toLowerCase())) {
          return; // Tier doesn't allow this module
        }
      }

      // Cash Debt Limit Check
      if (paymentMethod === 'cash') {
        const currentBalance = Number(driver?.wallet?.balance || 0);
        const maxDebtAllowed = Number(tier.max_cash_debt_allowed || 0);
        if (currentBalance < -maxDebtAllowed) {
          skippedForDebt.push(`${driver.phone || driver._id}(balance ${currentBalance}, limit ${maxDebtAllowed})`);
          return; // Driver cash debt exceeds tier limit
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
  };
  const checksAtOnce = step ? STEP_CHECKS_AT_ONCE : 1;
  for (let i = 0; i < rawDrivers.length; i += checksAtOnce) {
    await Promise.all(rawDrivers.slice(i, i + checksAtOnce).map(checkDriver));
  }

  console.log(
    `[matching] pickup=${coordinates.join(',')} vehicleTypes=${normalizedVehicleTypeIds.join('|') || 'any'} payment=${paymentMethod} ` +
      `candidates=${candidateCount} qualified=${qualifiedDrivers.length}` +
      (skippedForDebt.length ? ` skippedForCashDebt=[${skippedForDebt.join(', ')}]` : ''),
  );

  // Sort qualified drivers by Priority Score descending (highest priority wave first)
  qualifiedDrivers.sort((a, b) => {
    const scoreA = Number(a?.subscriptionTier?.priority_score || 0);
    const scoreB = Number(b?.subscriptionTier?.priority_score || 0);
    return scoreB - scoreA;
  });

  return {
    zone,
    drivers: step ? qualifiedDrivers : qualifiedDrivers.slice(0, limit),
    searchRadiusMeters: effectiveMaxDistance,
    zoneBoundaryCapMeters,
  };
};
