import simplify from 'simplify-js';
import { ApiError } from '../../../../utils/ApiError.js';
import { normalizePoint, polylineLengthMeters } from '../../../../utils/geo.js';
import { AdminThirdPartySetting } from '../../admin/models/AdminThirdPartySetting.js';
import { Driver } from '../models/Driver.js';
import { DriverRoute } from '../models/DriverRoute.js';
import { getDriverNetworkSettings } from '../../services/appSettingsService.js';
import { getDriverPermissions } from '../../services/driverCategoryService.js';
import { emitToRoom, getDriverRoom } from '../../services/dispatchService.js';

const MAX_PATH_POINTS = 500;
// Roughly every 5 km. A two-point straight line would leave `$near` and the
// corridor check blind to everything between the stops.
const DENSIFY_STEP_METERS = 5000;

const resolveGoogleMapsKey = async () => {
  const settings = await AdminThirdPartySetting.findOne({ scope: 'default' }).select('map_apis').lean();
  return (
    settings?.map_apis?.google_map_key ||
    settings?.map_apis?.google_maps_key ||
    settings?.map_apis?.key ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ''
  );
};

const densifySegment = (start, end) => {
  const points = [start];
  const metersPerDegreeLat = 111_320;
  const deltaLng = end[0] - start[0];
  const deltaLat = end[1] - start[1];
  const approxMeters = Math.hypot(
    deltaLng * metersPerDegreeLat * Math.cos((start[1] * Math.PI) / 180),
    deltaLat * metersPerDegreeLat,
  );
  const steps = Math.max(1, Math.min(60, Math.round(approxMeters / DENSIFY_STEP_METERS)));

  for (let step = 1; step < steps; step += 1) {
    points.push([start[0] + (deltaLng * step) / steps, start[1] + (deltaLat * step) / steps]);
  }

  return points;
};

const buildStraightPath = (stops) => {
  const coordinates = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    coordinates.push(...densifySegment(stops[index].location.coordinates, stops[index + 1].location.coordinates));
  }
  coordinates.push(stops[stops.length - 1].location.coordinates);
  return coordinates;
};

const decodePolyline = (encoded) => {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lng / 1e5, lat / 1e5]);
  }

  return points;
};

const buildGooglePath = async (stops) => {
  const key = await resolveGoogleMapsKey();
  if (!key) return null;

  const origin = stops[0].location.coordinates;
  const destination = stops[stops.length - 1].location.coordinates;
  const waypoints = stops.slice(1, -1).map((stop) => `${stop.location.coordinates[1]},${stop.location.coordinates[0]}`);

  const url =
    'https://maps.googleapis.com/maps/api/directions/json' +
    `?origin=${origin[1]},${origin[0]}` +
    `&destination=${destination[1]},${destination[0]}` +
    (waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join('|'))}` : '') +
    `&key=${key}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const payload = await response.json();
    const route = payload?.routes?.[0];
    if (!route?.overview_polyline?.points) return null;

    return {
      coordinates: decodePolyline(route.overview_polyline.points),
      distanceMeters: (route.legs || []).reduce((sum, leg) => sum + Number(leg?.distance?.value || 0), 0),
    };
  } catch (error) {
    // A directions outage must not stop a driver from saving a route; the
    // straight-line fallback is a slightly blunter corridor, nothing worse.
    console.error('[driverRouteService] Directions lookup failed:', error.message);
    return null;
  }
};

const simplifyPath = (coordinates) => {
  if (coordinates.length <= MAX_PATH_POINTS) return coordinates;

  // Tolerance is in degrees; step it up until the path fits the cap.
  let tolerance = 0.0005;
  let simplified = coordinates;

  for (let attempt = 0; attempt < 8 && simplified.length > MAX_PATH_POINTS; attempt += 1) {
    simplified = simplify(
      coordinates.map(([x, y]) => ({ x, y })),
      tolerance,
      true,
    ).map((point) => [point.x, point.y]);
    tolerance *= 2;
  }

  return simplified.length > MAX_PATH_POINTS ? simplified.slice(0, MAX_PATH_POINTS) : simplified;
};

const normalizeStops = (stops) => {
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > 10) {
    throw new ApiError(422, 'A route needs between 2 and 10 stops', null, 'INVALID_STOPS');
  }

  return stops.map((stop, index) => {
    const name = String(stop?.name || '').trim();
    if (!name) {
      throw new ApiError(422, `Stop #${index + 1} needs a name`, null, 'INVALID_STOPS');
    }

    const coordinates = normalizePoint(
      stop?.coordinates || stop?.location?.coordinates,
      `stops[${index}].coordinates`,
    );

    return { name, location: { type: 'Point', coordinates } };
  });
};

// Mongo's 2dsphere index rejects a LineString whose coordinates collapse to a
// single point as "at least 2 vertices" — but that error only fires on
// insert, deep inside a driver call stack, as an unhandled 500. Stops that all
// share one location (a map picker that never moved between "add stop" taps)
// produce exactly this, so it is checked here and turned into a normal
// validation error before anything reaches the database.
const hasDistinctVertices = (coordinates) =>
  coordinates.some(
    ([lng, lat]) => lng !== coordinates[0][0] || lat !== coordinates[0][1],
  );

const buildPath = async (stops) => {
  const google = await buildGooglePath(stops);
  if (google?.coordinates?.length >= 2 && hasDistinctVertices(google.coordinates)) {
    return {
      coordinates: simplifyPath(google.coordinates),
      source: 'google',
      distanceMeters: google.distanceMeters || polylineLengthMeters(google.coordinates),
    };
  }

  const coordinates = buildStraightPath(stops);
  if (!hasDistinctVertices(coordinates)) {
    throw new ApiError(
      422,
      'Route stops must not all be at the same location',
      null,
      'INVALID_STOPS',
    );
  }

  return {
    coordinates: simplifyPath(coordinates),
    source: 'straight',
    distanceMeters: polylineLengthMeters(coordinates),
  };
};

export const serializeDriverRoute = (route) => ({
  id: String(route._id),
  name: route.name,
  stops: (route.stops || []).map((stop) => ({
    name: stop.name,
    coordinates: stop.location?.coordinates || [],
  })),
  corridor_km: route.corridor_km,
  bidirectional: Boolean(route.bidirectional),
  distance_meters: route.distance_meters || 0,
  path_source: route.path_source,
  is_active: route.is_active !== false,
  created_at: route.createdAt,
});

export const listDriverRoutes = async (driverId) => {
  const permissions = await getDriverPermissions(driverId);
  const routes = await DriverRoute.find({ driver_id: driverId, deletedAt: null })
    .sort({ createdAt: -1 })
    .lean();

  return {
    route_mode: permissions.driver.route_mode || 'all_locations',
    active_route_id: permissions.driver.active_route_id
      ? String(permissions.driver.active_route_id)
      : null,
    limit: permissions.max_routes,
    used: routes.length,
    routes: routes.map(serializeDriverRoute),
  };
};

export const createDriverRoute = async ({ driverId, name, stops, corridorKm, bidirectional }) => {
  const permissions = await getDriverPermissions(driverId);
  const used = await DriverRoute.countDocuments({ driver_id: driverId, deletedAt: null });

  if (used >= permissions.max_routes) {
    throw new ApiError(
      403,
      `Your plan allows up to ${permissions.max_routes} routes`,
      { limit: permissions.max_routes, used },
      'ROUTE_LIMIT_REACHED',
    );
  }

  const routeName = String(name || '').trim();
  if (!routeName) {
    throw new ApiError(422, 'Route name is required', null, 'INVALID_STOPS');
  }

  const normalizedStops = normalizeStops(stops);
  const settings = await getDriverNetworkSettings();
  const path = await buildPath(normalizedStops);

  const route = await DriverRoute.create({
    driver_id: driverId,
    name: routeName,
    stops: normalizedStops,
    path: { type: 'LineString', coordinates: path.coordinates },
    path_source: path.source,
    distance_meters: path.distanceMeters,
    corridor_km: Math.min(
      50,
      Math.max(1, Number(corridorKm ?? settings.default_corridor_km ?? 10)),
    ),
    bidirectional: Boolean(bidirectional),
  });

  return serializeDriverRoute(route.toObject());
};

export const updateDriverRoute = async ({ driverId, routeId, name, stops, corridorKm, bidirectional }) => {
  const route = await DriverRoute.findOne({ _id: routeId, driver_id: driverId, deletedAt: null });
  if (!route) {
    throw new ApiError(404, 'Route not found', null, 'ROUTE_NOT_FOUND');
  }

  if (name !== undefined) {
    const routeName = String(name || '').trim();
    if (!routeName) throw new ApiError(422, 'Route name cannot be empty', null, 'INVALID_STOPS');
    route.name = routeName;
  }

  if (stops !== undefined) {
    const normalizedStops = normalizeStops(stops);
    const path = await buildPath(normalizedStops);
    route.stops = normalizedStops;
    route.path = { type: 'LineString', coordinates: path.coordinates };
    route.path_source = path.source;
    route.distance_meters = path.distanceMeters;
  }

  if (corridorKm !== undefined) {
    route.corridor_km = Math.min(50, Math.max(1, Number(corridorKm)));
  }

  if (bidirectional !== undefined) {
    route.bidirectional = Boolean(bidirectional);
  }

  await route.save();
  return serializeDriverRoute(route.toObject());
};

export const deleteDriverRoute = async ({ driverId, routeId }) => {
  const route = await DriverRoute.findOne({ _id: routeId, driver_id: driverId, deletedAt: null });
  if (!route) {
    throw new ApiError(404, 'Route not found', null, 'ROUTE_NOT_FOUND');
  }

  route.deletedAt = new Date();
  route.is_active = false;
  await route.save();

  // Leaving a driver pointed at a deleted route would silently narrow their
  // dispatch to nothing, so fall back to taking work from everywhere.
  const driver = await Driver.findById(driverId);
  if (driver && String(driver.active_route_id || '') === String(routeId)) {
    driver.active_route_id = null;
    driver.route_mode = 'all_locations';
    await driver.save();
  }

  return { deleted: true, route_mode: driver?.route_mode || 'all_locations' };
};

export const setDriverRouteMode = async ({ driverId, mode, routeId }) => {
  const driver = await Driver.findById(driverId);
  if (!driver) throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');

  if (mode === 'all_locations') {
    driver.route_mode = 'all_locations';
    driver.active_route_id = null;
    await driver.save();

    // The driver may be signed in on more than one device; the others have to
    // see the switch or they will keep showing a corridor that is no longer on.
    emitToRoom(getDriverRoom(driverId), 'driver:route-mode:updated', {
      route_mode: 'all_locations',
      active_route_id: null,
    });

    return { route_mode: 'all_locations', active_route: null };
  }

  if (mode !== 'route') {
    throw new ApiError(422, "mode must be 'route' or 'all_locations'", null, 'INVALID_ROUTE_MODE');
  }

  const route = await DriverRoute.findOne({
    _id: routeId,
    driver_id: driverId,
    deletedAt: null,
    is_active: true,
  }).lean();

  if (!route) {
    throw new ApiError(404, 'Route not found', null, 'ROUTE_NOT_FOUND');
  }

  driver.route_mode = 'route';
  driver.active_route_id = route._id;
  await driver.save();

  emitToRoom(getDriverRoom(driverId), 'driver:route-mode:updated', {
    route_mode: 'route',
    active_route_id: String(route._id),
  });

  return { route_mode: 'route', active_route: serializeDriverRoute(route) };
};
