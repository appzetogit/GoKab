import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { Driver } from '../../driver/models/Driver.js';
import { DriverSubscription } from '../../driver/models/DriverSubscription.js';
import { getBillAllowance } from '../../driver/services/billAllowanceService.js';
import { isPlanRulesEnabled } from '../../services/appSettingsService.js';
import { resolveTierPermissions } from '../../services/driverCategoryService.js';
import { subscriptionTierService } from '../../services/subscriptionTierService.js';
import { FleetVehicle } from '../models/FleetVehicle.js';
import { ServiceLocation } from '../models/ServiceLocation.js';
import { SubscriptionTier } from '../models/SubscriptionTier.js';

/** Read only: who is on a plan, and the team and vehicles under one of its drivers. */

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_DAYS = 7;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plate = (value) => String(value || '').toUpperCase().replace(/\s+/g, '');

const assertId = (value, field) => {
  if (!mongoose.isValidObjectId(value)) throw new ApiError(400, `${field} is invalid`, null, 'INVALID_ID');
};

/**
 * Running subscriptions by plan, with the rule `getEffectiveDriverTier` uses: a
 * subscription on a plan that no longer counts leaves the driver on the default.
 */
const loadPlanMembership = async () => {
  const now = new Date();
  const [tiers, subscriptions, planRulesOn] = await Promise.all([
    SubscriptionTier.find({}).lean(),
    DriverSubscription.find({ status: 'active', start_date: { $lte: now }, end_date: { $gte: now } })
      .select('driver_id tier_id end_date')
      .lean(),
    isPlanRulesEnabled(),
  ]);
  const usable = new Set(tiers.filter((tier) => tier.is_active || planRulesOn).map((tier) => String(tier._id)));
  const byDriver = new Map();
  for (const subscription of subscriptions) {
    if (usable.has(String(subscription.tier_id))) byDriver.set(String(subscription.driver_id), subscription);
  }
  return { tiers, byDriver };
};

/** The plan's own vehicle count: the fleet, plus the registration vehicle unless it is in the fleet too. */
const countVehicles = (driver, fleetPlates = []) => {
  const own = plate(driver.vehicleNumber);
  return fleetPlates.length + (own && !fleetPlates.includes(own) ? 1 : 0);
};

const limitsOf = (tier) => {
  const permissions = resolveTierPermissions(tier);
  return {
    can_manage_fleet: permissions.can_manage_fleet,
    // 0 = no limit, when the plan has teams at all.
    max_team: permissions.max_fleet_drivers,
    max_vehicles: permissions.max_vehicles,
  };
};

export const listPlanDrivers = async ({ tierId, page = 1, limit = 20, search = '', cityId = '', online = '', expiring = '', includeTeam = '' }) => {
  assertId(tierId, 'tierId');
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const { tiers, byDriver } = await loadPlanMembership();
  const tier = tiers.find((item) => String(item._id) === String(tierId));
  if (!tier) throw new ApiError(404, 'Plan not found', null, 'TIER_NOT_FOUND');

  const onThisPlan = [...byDriver.values()].filter((item) => String(item.tier_id) === String(tierId));
  const isExpiring = (item) => new Date(item.end_date).getTime() - Date.now() <= EXPIRING_DAYS * DAY_MS;
  const planIds = onThisPlan.map((item) => item.driver_id);
  const isDefault = Boolean(tier.is_default && tier.is_active);

  // The default plan also holds every driver without a running subscription.
  const others = [...byDriver.values()]
    .filter((item) => String(item.tier_id) !== String(tierId))
    .map((item) => item.driver_id);
  const membership = isDefault ? { _id: { $nin: others } } : { _id: { $in: planIds } };

  // A team member (their organisation has a lead who drives) is listed under the lead.
  const leadOrgs = (await Driver.distinct('owner_id', { is_self_drive_owner: true, deletedAt: null })).filter(Boolean);
  const notTeam = { $nor: [{ owner_id: { $in: leadOrgs }, is_self_drive_owner: { $ne: true } }] };
  const base = [{ deletedAt: null }, membership, ...(String(includeTeam) === 'true' ? [] : [notTeam])];

  const filters = [...base];
  const term = String(search || '').trim().slice(0, 60);
  if (term) {
    const pattern = new RegExp(escapeRegex(term), 'i');
    filters.push({ $or: [{ name: pattern }, { phone: pattern }, { vehicleNumber: pattern }] });
  }
  if (cityId) {
    assertId(cityId, 'cityId');
    filters.push({ service_location_id: new mongoose.Types.ObjectId(String(cityId)) });
  }
  if (String(online) === 'true') filters.push({ isOnline: true });
  if (String(expiring) === 'true') filters.push({ _id: { $in: onThisPlan.filter(isExpiring).map((item) => item.driver_id) } });

  const [drivers, total, planTotal, planOnline, expiringCount, cities] = await Promise.all([
    Driver.find({ $and: filters })
      .select('name phone city service_location_id owner_id is_self_drive_owner isOnline isOnRide approve status vehicleNumber')
      .sort({ createdAt: -1, _id: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    Driver.countDocuments({ $and: filters }),
    Driver.countDocuments({ $and: base }),
    Driver.countDocuments({ $and: [...base, { isOnline: true }] }),
    Driver.countDocuments({ $and: [...base, { _id: { $in: onThisPlan.filter(isExpiring).map((item) => item.driver_id) } }] }),
    ServiceLocation.find({}).select('name service_location_name').sort({ name: 1 }).lean(),
  ]);

  const orgIds = drivers.map((driver) => driver.owner_id).filter(Boolean);
  const [team, vehicles, leads] = await Promise.all([
    Driver.find({ owner_id: { $in: orgIds }, deletedAt: null }).select('owner_id').lean(),
    FleetVehicle.find({ owner_id: { $in: orgIds }, active: true }).select('owner_id license_plate_number').lean(),
    Driver.find({ owner_id: { $in: orgIds }, is_self_drive_owner: true, deletedAt: null }).select('owner_id name').lean(),
  ]);
  const teamSize = new Map();
  for (const item of team) teamSize.set(String(item.owner_id), (teamSize.get(String(item.owner_id)) || 0) + 1);
  const plates = new Map();
  for (const item of vehicles) {
    const key = String(item.owner_id);
    plates.set(key, [...(plates.get(key) || []), plate(item.license_plate_number)]);
  }
  const leadByOrg = new Map(leads.map((item) => [String(item.owner_id), item]));
  const cityName = new Map(cities.map((city) => [String(city._id), city.name || city.service_location_name || '']));

  const results = await Promise.all(
    drivers.map(async (driver) => {
      const org = driver.owner_id ? String(driver.owner_id) : '';
      const lead = leadByOrg.get(org);
      const isMember = Boolean(lead) && driver.is_self_drive_owner !== true;
      // What the driver really has, benefits kept from their purchase included.
      const limits = limitsOf((await subscriptionTierService.getEffectiveDriverTier(driver._id)) || tier);
      return {
        id: String(driver._id),
        name: driver.name || '',
        phone: driver.phone || '',
        city: cityName.get(String(driver.service_location_id)) || driver.city || '',
        approved: driver.approve === true,
        online: Boolean(driver.isOnline),
        on_ride: Boolean(driver.isOnRide),
        valid_until: byDriver.get(String(driver._id))?.end_date || null,
        team_of: isMember ? lead.name || 'Team lead' : null,
        team_count: isMember || !org ? 0 : Math.max(0, (teamSize.get(org) || 0) - 1),
        vehicle_count: countVehicles(driver, isMember ? [] : plates.get(org)),
        limits,
      };
    }),
  );

  return {
    plan: { id: String(tier._id), name: tier.name, badge_color_hex: tier.badge_color_hex || '#10B981', is_default: isDefault, is_active: Boolean(tier.is_active) },
    summary: { drivers: planTotal, online: planOnline, expiring: expiringCount, expiring_days: EXPIRING_DAYS },
    results,
    cities: cities.map((city) => ({ id: String(city._id), name: city.name || city.service_location_name || '' })),
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.max(1, Math.ceil(total / safeLimit)) },
  };
};

export const getDriverFleet = async ({ driverId }) => {
  assertId(driverId, 'driverId');
  const driver = await Driver.findOne({ _id: driverId, deletedAt: null })
    .select('name phone owner_id is_self_drive_owner vehicleNumber vehicleMake vehicleModel')
    .lean();
  if (!driver) throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');

  const tier = await subscriptionTierService.getEffectiveDriverTier(driverId);
  const lead =
    driver.owner_id && driver.is_self_drive_owner !== true
      ? await Driver.findOne({ owner_id: driver.owner_id, is_self_drive_owner: true, deletedAt: null }).select('name phone').lean()
      : null;
  const ownsFleet = Boolean(driver.owner_id) && !lead;

  const [team, vehicles, bills] = await Promise.all([
    ownsFleet
      ? Driver.find({ owner_id: driver.owner_id, deletedAt: null, _id: { $ne: driver._id } })
          .select('name phone isOnline isOnRide approve status vehicleNumber assignedFleetVehicleId')
          .sort({ name: 1 })
          .limit(200)
          .lean()
      : [],
    ownsFleet
      ? FleetVehicle.find({ owner_id: driver.owner_id, active: true })
          .select('license_plate_number car_brand car_model status usage_type')
          .sort({ createdAt: -1 })
          .limit(200)
          .lean()
      : [],
    getBillAllowance(driverId),
  ]);

  const driverByVehicle = new Map(
    team.filter((item) => item.assignedFleetVehicleId).map((item) => [String(item.assignedFleetVehicleId), item.name]),
  );
  const ownPlate = plate(driver.vehicleNumber);
  const fleetPlates = vehicles.map((item) => plate(item.license_plate_number));

  return {
    driver: { id: String(driver._id), name: driver.name || '', phone: driver.phone || '' },
    plan: tier ? { id: String(tier._id), name: tier.name, valid_until: tier.subscription?.end_date || null } : null,
    team_of: lead ? { id: String(lead._id), name: lead.name || '' } : null,
    limits: limitsOf(tier),
    vehicle_count: countVehicles(driver, fleetPlates),
    team: team.map((item) => ({
      id: String(item._id),
      name: item.name || '',
      phone: item.phone || '',
      vehicle_number: item.vehicleNumber || '',
      approved: item.approve === true,
      status: item.status || '',
      online: Boolean(item.isOnline),
      on_ride: Boolean(item.isOnRide),
    })),
    vehicles: [
      ...(ownPlate && !fleetPlates.includes(ownPlate)
        ? [{ id: 'own', number: driver.vehicleNumber, model: [driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' '), status: 'registration', usage_type: '', driver: driver.name || '' }]
        : []),
      ...vehicles.map((item) => ({
        id: String(item._id),
        number: item.license_plate_number || '',
        model: [item.car_brand, item.car_model].filter(Boolean).join(' '),
        status: item.status || 'pending',
        usage_type: item.usage_type || '',
        driver: driverByVehicle.get(String(item._id)) || '',
      })),
    ],
    bills,
  };
};
