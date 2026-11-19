import { FleetVehicle } from '../../admin/models/FleetVehicle.js';
import { Owner } from '../../admin/models/Owner.js';
import { Vehicle } from '../../admin/models/Vehicle.js';
import { Driver } from '../../driver/models/Driver.js';
import { DriverRoute } from '../../driver/models/DriverRoute.js';

/**
 * A travel "operator" is a driver on the Pro (category `middle`) or Elite
 * (category `prime`) plan: they can run an organisation with their own fleet
 * and routes, which Basic drivers cannot.
 */
const OPERATOR_CATEGORIES = { middle: 'Pro', prime: 'Elite' };

const toRad = (deg) => (deg * Math.PI) / 180;
const distanceKm = (aLat, aLng, bLat, bLng) => {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

const unique = (values) => [...new Set(values.filter(Boolean))];

/**
 * Pro / Elite operators near the rider, nearest first. Each one is placed where
 * the driver last reported their location. Without a rider location they are
 * returned unsorted by distance (Elite first).
 */
// ponytail: in-memory distance filter over approved Pro/Elite drivers (a few hundred at most); add a 2dsphere $near query if that grows.
export const listNearestOperators = async ({ lat = null, lng = null, radiusKm = 100, limit = 20 }) => {
  const drivers = await Driver.find({
    deletedAt: null,
    approve: true,
    status: 'approved',
    driver_category: { $in: Object.keys(OPERATOR_CATEGORIES) },
    'location.coordinates.1': { $exists: true },
  })
    .select('name phone profileImage profile_picture rating ratingCount city owner_id vehicleType driver_category location isOnline')
    .limit(500)
    .lean();

  const located = Number.isFinite(lat) && Number.isFinite(lng);
  const ranked = [];
  for (const driver of drivers) {
    const [dLng, dLat] = driver.location?.coordinates || [];
    if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) continue;
    const km = located ? distanceKm(lat, lng, dLat, dLng) : null;
    if (located && km > radiusKm) continue;
    ranked.push({ driver, km });
  }
  if (located) ranked.sort((a, b) => a.km - b.km);
  else ranked.sort((a, b) => Number(b.driver.driver_category === 'prime') - Number(a.driver.driver_category === 'prime'));
  const top = ranked.slice(0, limit);

  const driverIds = top.map((r) => r.driver._id);
  const ownerIds = unique(top.map((r) => String(r.driver.owner_id || '')));
  const [owners, routes, fleet] = await Promise.all([
    Owner.find({ _id: { $in: ownerIds } }).select('company_name owner_name name city address').lean(),
    DriverRoute.find({ driver_id: { $in: driverIds }, is_active: true, deletedAt: null }).select('driver_id name').lean(),
    FleetVehicle.find({ owner_id: { $in: ownerIds }, status: 'approved', active: { $ne: false } }).select('owner_id vehicle_type_id').lean(),
  ]);
  const vehicleTypes = await Vehicle.find({ _id: { $in: unique(fleet.map((f) => String(f.vehicle_type_id || ''))) } })
    .select('name')
    .lean();

  const ownerMap = new Map(owners.map((o) => [String(o._id), o]));
  const typeName = new Map(vehicleTypes.map((v) => [String(v._id), v.name]));
  const routesByDriver = new Map();
  for (const route of routes) {
    const key = String(route.driver_id);
    routesByDriver.set(key, [...(routesByDriver.get(key) || []), route.name]);
  }
  const carsByOwner = new Map();
  for (const vehicle of fleet) {
    const key = String(vehicle.owner_id);
    carsByOwner.set(key, [...(carsByOwner.get(key) || []), typeName.get(String(vehicle.vehicle_type_id))]);
  }

  return top.map(({ driver, km }) => {
    const owner = ownerMap.get(String(driver.owner_id || ''));
    return {
      id: String(driver._id),
      name: owner?.company_name || driver.name,
      owner: owner?.owner_name || owner?.name || driver.name,
      plan: OPERATOR_CATEGORIES[driver.driver_category],
      rating: Number(driver.rating) || 0,
      reviews: Number(driver.ratingCount) || 0,
      area: driver.city || owner?.city || '',
      address: owner?.address || '',
      distance_km: km === null ? null : Math.round(km * 10) / 10,
      routes: unique(routesByDriver.get(String(driver._id)) || []).slice(0, 6),
      car_types: unique([...(carsByOwner.get(String(driver.owner_id || '')) || []), driver.vehicleType]),
      phone: driver.phone || '',
      image: driver.profileImage || driver.profile_picture || '',
      online: Boolean(driver.isOnline),
    };
  });
};
