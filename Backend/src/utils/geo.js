import { ApiError } from './ApiError.js';

export const normalizePoint = (coordinates, fieldName = 'coordinates') => {
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    throw new ApiError(400, `${fieldName} must be [longitude, latitude]`);
  }

  const [longitude, latitude] = coordinates.map(Number);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new ApiError(400, `${fieldName} must contain valid longitude and latitude values`);
  }

  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new ApiError(400, `${fieldName} must be valid [longitude, latitude]`);
  }

  return [longitude, latitude];
};

export const toPoint = (coordinates, fieldName) => ({
  type: 'Point',
  coordinates: normalizePoint(coordinates, fieldName),
});

const EARTH_RADIUS_METERS = 6371000;

export const haversineMeters = ([lngA, latA], [lngB, latB]) => {
  const dLat = ((latB - latA) * Math.PI) / 180;
  const dLng = ((lngB - lngA) * Math.PI) / 180;
  const lat1 = (latA * Math.PI) / 180;
  const lat2 = (latB * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Projects lng/lat onto a flat metre grid centred on `origin`. Over the tens of
 * kilometres a route corridor spans this is accurate enough and lets the
 * point-to-segment maths below stay simple planar geometry.
 */
const toLocalMeters = (origin, target) => {
  const [originLng, originLat] = origin;
  const [targetLng, targetLat] = target;
  const metersPerDegreeLat = (Math.PI * EARTH_RADIUS_METERS) / 180;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos((originLat * Math.PI) / 180);

  return {
    x: (targetLng - originLng) * metersPerDegreeLng,
    y: (targetLat - originLat) * metersPerDegreeLat,
  };
};

/**
 * Nearest point on a polyline to `point`.
 *
 * Returns the distance in metres plus where along the line the match fell:
 * `segIndex` is the segment, `t` is the 0..1 position inside it. `segIndex + t`
 * gives a single monotonically increasing coordinate along the route, which is
 * what makes "is the drop *after* the pickup" a simple comparison.
 */
export const nearestPointOnPolyline = (lineCoordinates, point) => {
  if (!Array.isArray(lineCoordinates) || lineCoordinates.length < 2) {
    return { distanceMeters: Number.POSITIVE_INFINITY, segIndex: 0, t: 0 };
  }

  let best = { distanceMeters: Number.POSITIVE_INFINITY, segIndex: 0, t: 0 };

  for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
    const start = toLocalMeters(point, lineCoordinates[index]);
    const end = toLocalMeters(point, lineCoordinates[index + 1]);
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;

    let t = 0;
    if (lengthSquared > 0) {
      t = Math.max(
        0,
        Math.min(1, -((start.x * segmentX) + (start.y * segmentY)) / lengthSquared),
      );
    }

    const closestX = start.x + t * segmentX;
    const closestY = start.y + t * segmentY;
    const distanceMeters = Math.hypot(closestX, closestY);

    if (distanceMeters < best.distanceMeters) {
      best = { distanceMeters, segIndex: index, t };
    }
  }

  return best;
};

export const polylineLengthMeters = (lineCoordinates = []) => {
  let total = 0;
  for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
    total += haversineMeters(lineCoordinates[index], lineCoordinates[index + 1]);
  }
  return Math.round(total);
};
