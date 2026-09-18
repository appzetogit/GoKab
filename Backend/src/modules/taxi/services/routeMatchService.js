import { Driver } from '../driver/models/Driver.js';
import { DriverRoute } from '../driver/models/DriverRoute.js';
import { nearestPointOnPolyline } from '../../../utils/geo.js';

// A corridor wider than this is not a route any more, and it also caps the
// Mongo pre-filter radius so the candidate query stays cheap.
const MAX_CORRIDOR_METERS = 50_000;
const MAX_CANDIDATE_ROUTES = 500;

/**
 * Does this trip fit the driver's route?
 *
 * Both ends must sit inside the corridor, and — unless the route is marked
 * bidirectional — the drop must lie *further along* the line than the pickup,
 * otherwise a driver heading Indore→Bhopal would be offered Bhopal→Indore.
 */
export const matchRideToRoute = ({ route, pickup, drop }) => {
  const line = route?.path?.coordinates;
  if (!Array.isArray(line) || line.length < 2 || !pickup || !drop) {
    return { match: false, reason: 'INVALID_ROUTE' };
  }

  const corridorMeters = Math.min(
    Math.max(1, Number(route.corridor_km || 10)) * 1000,
    MAX_CORRIDOR_METERS,
  );

  const pickupHit = nearestPointOnPolyline(line, pickup);
  if (pickupHit.distanceMeters > corridorMeters) {
    return { match: false, reason: 'PICKUP_OFF_ROUTE', pickupDistanceKm: pickupHit.distanceMeters / 1000 };
  }

  const dropHit = nearestPointOnPolyline(line, drop);
  if (dropHit.distanceMeters > corridorMeters) {
    return { match: false, reason: 'DROP_OFF_ROUTE', dropDistanceKm: dropHit.distanceMeters / 1000 };
  }

  const pickupPosition = pickupHit.segIndex + pickupHit.t;
  const dropPosition = dropHit.segIndex + dropHit.t;

  if (!route.bidirectional && pickupPosition >= dropPosition) {
    return { match: false, reason: 'WRONG_DIRECTION' };
  }

  return {
    match: true,
    pickupIndex: pickupPosition,
    dropIndex: dropPosition,
    pickupDistanceKm: Math.round((pickupHit.distanceMeters / 1000) * 100) / 100,
    dropDistanceKm: Math.round((dropHit.distanceMeters / 1000) * 100) / 100,
  };
};

/**
 * True when the driver is willing to take this trip.
 *
 * A driver in `all_locations` mode has no corridor and always passes; this is
 * the default, so existing drivers are unaffected by the feature.
 */
export const driverAcceptsTrip = async ({ driver, pickup, drop, routeCache = null }) => {
  if (!driver || driver.route_mode !== 'route' || !driver.active_route_id) {
    return { match: true, reason: 'ALL_LOCATIONS' };
  }

  const routeId = String(driver.active_route_id);
  let route = routeCache?.get(routeId);

  if (route === undefined) {
    route = await DriverRoute.findOne({ _id: routeId, deletedAt: null, is_active: true }).lean();
    routeCache?.set(routeId, route);
  }

  // A driver pointed at a deleted or deactivated route would otherwise receive
  // nothing at all; treating it as "no filter" keeps them earning.
  if (!route) return { match: true, reason: 'ROUTE_MISSING' };

  return { ...matchRideToRoute({ route, pickup, drop }), route };
};

/**
 * Finds drivers whose *active* route covers this trip, regardless of where the
 * driver's car currently is.
 *
 * This is what lets an outstation driver parked in Indore be offered a pickup
 * in Ujjain that sits on their corridor — radius-based matching alone would
 * never surface them.
 */
export const findDriversWhoseActiveRouteMatches = async ({
  pickup,
  drop,
  serviceLocationId = null,
  limit = 50,
}) => {
  if (!pickup || !drop) return [];

  const routes = await DriverRoute.find({
    is_active: true,
    deletedAt: null,
    path: {
      $near: {
        $geometry: { type: 'Point', coordinates: pickup },
        $maxDistance: MAX_CORRIDOR_METERS,
      },
    },
  })
    .limit(MAX_CANDIDATE_ROUTES)
    .lean();

  if (!routes.length) return [];

  // Only a driver's *currently selected* route counts — an old saved route must
  // not keep pulling them into dispatch.
  const drivers = await Driver.find({
    active_route_id: { $in: routes.map((route) => route._id) },
    route_mode: 'route',
    deletedAt: null,
    approve: true,
    ...(serviceLocationId ? { service_location_id: serviceLocationId } : {}),
  })
    .select(
      'name phone socketId vehicleTypeId vehicleType vehicleIconType vehicleNumber vehicleColor ' +
        'vehicleMake vehicleModel rating location zoneId service_location_id isOnline isOnRide ' +
        'routeBooking owner_id assignedFleetVehicleId wallet route_mode active_route_id driver_category',
    )
    .lean();

  const routeById = new Map(routes.map((route) => [String(route._id), route]));
  const matched = [];

  for (const driver of drivers) {
    const route = routeById.get(String(driver.active_route_id));
    if (!route) continue;

    const result = matchRideToRoute({ route, pickup, drop });
    if (result.match) matched.push({ ...driver, routeMatch: { ...result, route } });
    if (matched.length >= limit) break;
  }

  return matched;
};
