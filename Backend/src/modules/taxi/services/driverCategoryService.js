import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { Driver } from '../driver/models/Driver.js';
import { DriverRoute } from '../driver/models/DriverRoute.js';
import { DriverSubscription } from '../driver/models/DriverSubscription.js';
import { FleetVehicle } from '../admin/models/FleetVehicle.js';
import { PrimeCitySlot } from '../admin/models/PrimeCitySlot.js';
import { ServiceLocation } from '../admin/models/ServiceLocation.js';
import { SubscriptionTier } from '../admin/models/SubscriptionTier.js';
import { TierAuditLog } from '../admin/models/TierAuditLog.js';
import { getDriverNetworkSettings } from './appSettingsService.js';
import { subscriptionTierService } from './subscriptionTierService.js';

export const CATEGORY_RANK = Object.freeze({ lower: 1, middle: 2, prime: 3 });

const DUPLICATE_KEY = 11000;

/**
 * Accepts a driver document, a lean driver object, or an id.
 *
 * The ObjectId check is load-bearing: Mongoose defines `_id` on ObjectId itself
 * (it returns the id), so a plain `"typeof === object" && _id` test would treat
 * an id as an already-loaded driver and then read every other field as
 * undefined.
 */
const toDriver = async (driverOrId, { session = null } = {}) => {
  if (
    driverOrId &&
    typeof driverOrId === 'object' &&
    !(driverOrId instanceof mongoose.Types.ObjectId) &&
    driverOrId._id
  ) {
    return driverOrId;
  }

  const driver = await Driver.findById(driverOrId).session(session);
  if (!driver) {
    throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');
  }

  return driver;
};

/**
 * Counts the driver's commercial and private vehicles across both places one
 * can live: the vehicle captured during their own onboarding, and any fleet
 * vehicles under the organisation they own.
 *
 * Only approved + active fleet vehicles count — a pending or rejected one is
 * not something the driver can actually put on the road.
 */
export const vehicleUsageSummary = async (driverOrId, { session = null } = {}) => {
  const driver = await toDriver(driverOrId, { session });

  let commercial = 0;
  let privateCount = 0;

  if (driver.vehicle_usage_type === 'commercial') commercial += 1;
  if (driver.vehicle_usage_type === 'private') privateCount += 1;

  if (driver.owner_id) {
    const fleetVehicles = await FleetVehicle.find({
      owner_id: driver.owner_id,
      active: true,
      status: 'approved',
    })
      .select('usage_type')
      .session(session)
      .lean();

    for (const vehicle of fleetVehicles) {
      if (vehicle.usage_type === 'commercial') commercial += 1;
      else privateCount += 1;
    }
  }

  return {
    commercial,
    private: privateCount,
    ok: commercial >= 1 && privateCount >= 1,
  };
};

export const getPrimeLimitForCity = async (serviceLocationId) => {
  const settings = await getDriverNetworkSettings();
  const globalLimit = Math.max(0, Number(settings.prime_per_city ?? 5));

  if (!serviceLocationId) return globalLimit;

  const city = await ServiceLocation.findById(serviceLocationId).select('prime_limit').lean();
  const cityLimit = city?.prime_limit;

  return cityLimit === null || cityLimit === undefined ? globalLimit : Math.max(0, Number(cityLimit));
};

/**
 * Drops reservations whose payment window has passed. Called before any slot
 * count or claim so an abandoned checkout never blocks a paying driver.
 */
export const releaseStalePrimeReservations = async ({ session = null } = {}) => {
  const result = await PrimeCitySlot.deleteMany(
    { status: 'reserved', reserved_until: { $ne: null, $lt: new Date() } },
    { session },
  );

  return { released: result?.deletedCount || 0 };
};

export const getPrimeSlotUsage = async (serviceLocationId) => {
  await releaseStalePrimeReservations();

  const limit = await getPrimeLimitForCity(serviceLocationId);
  const used = serviceLocationId
    ? await PrimeCitySlot.countDocuments({ service_location_id: serviceLocationId })
    : 0;

  return { limit, used, left: Math.max(0, limit - used) };
};

/**
 * Claims a Prime seat for the driver, or returns the one they already hold.
 *
 * Seats are claimed by *winning an insert*, not by counting: the unique index
 * on (city, slot_no) rejects the loser of a race with a duplicate-key error and
 * we simply try the next seat number. That is what makes "max 5 per city" hold
 * when two drivers pay at the same instant.
 */
export const reservePrimeSlot = async ({ driverId, serviceLocationId, session = null }) => {
  if (!serviceLocationId) {
    throw new ApiError(422, 'Set your city before buying a Prime plan', null, 'CITY_REQUIRED');
  }

  await releaseStalePrimeReservations({ session });

  const existing = await PrimeCitySlot.findOne({ driver_id: driverId }).session(session);
  if (existing) {
    // Re-arm the hold so a retried checkout does not expire mid-payment.
    if (existing.status === 'reserved') {
      const settings = await getDriverNetworkSettings();
      existing.reserved_until = new Date(
        Date.now() + Math.max(1, Number(settings.prime_slot_reservation_minutes ?? 15)) * 60 * 1000,
      );
      await existing.save({ session });
    }
    return existing;
  }

  const settings = await getDriverNetworkSettings();
  const limit = await getPrimeLimitForCity(serviceLocationId);
  const reservedUntil = new Date(
    Date.now() + Math.max(1, Number(settings.prime_slot_reservation_minutes ?? 15)) * 60 * 1000,
  );

  for (let slotNo = 1; slotNo <= limit; slotNo += 1) {
    try {
      const [slot] = await PrimeCitySlot.create(
        [
          {
            service_location_id: serviceLocationId,
            slot_no: slotNo,
            driver_id: driverId,
            status: 'reserved',
            reserved_until: reservedUntil,
          },
        ],
        { session },
      );
      return slot;
    } catch (error) {
      if (error?.code !== DUPLICATE_KEY) throw error;

      // Losing on driver_id means a concurrent request already seated us.
      if (String(error?.keyPattern && Object.keys(error.keyPattern)[0]) === 'driver_id') {
        const claimed = await PrimeCitySlot.findOne({ driver_id: driverId }).session(session);
        if (claimed) return claimed;
      }
      // Otherwise this seat number is taken — try the next one.
    }
  }

  throw new ApiError(
    409,
    'All Prime slots in this city are currently taken',
    { limit },
    'PRIME_SLOTS_FULL',
  );
};

export const activatePrimeSlot = async ({ driverId, subscriptionId = null, serviceLocationId = null, session = null }) => {
  const existing = await PrimeCitySlot.findOne({ driver_id: driverId }).session(session);

  if (!existing) {
    const slot = await reservePrimeSlot({ driverId, serviceLocationId, session });
    slot.status = 'active';
    slot.reserved_until = null;
    slot.subscription_id = subscriptionId;
    await slot.save({ session });
    return slot;
  }

  existing.status = 'active';
  existing.reserved_until = null;
  if (subscriptionId) existing.subscription_id = subscriptionId;
  await existing.save({ session });

  return existing;
};

export const releasePrimeSlot = async ({ driverId, session = null }) => {
  const result = await PrimeCitySlot.deleteOne({ driver_id: driverId }, { session });
  return { released: (result?.deletedCount || 0) > 0 };
};

export const resolveTierPermissions = (tier) => ({
  can_create_rides: Boolean(tier?.can_create_rides),
  can_publish_rides: Boolean(tier?.can_publish_rides),
  can_manage_fleet: Boolean(tier?.can_manage_fleet),
  requires_commercial_and_private: Boolean(tier?.requires_commercial_and_private),
  max_routes: Math.max(0, Number(tier?.max_routes ?? 0)),
  max_fleet_drivers: Math.max(0, Number(tier?.max_fleet_drivers ?? 0)),
  customer_lead_contact_fee: Math.max(0, Number(tier?.customer_lead_contact_fee ?? 0)),
  driver_lead_contact_fee: Math.max(0, Number(tier?.driver_lead_contact_fee ?? 0)),
  customer_ride_accept_fee: Math.max(0, Number(tier?.customer_ride_accept_fee ?? 0)),
});

/**
 * The single source of truth for "what is this driver allowed to do right now".
 *
 * The category is read from the *tier* of the active subscription rather than
 * from `driver.driver_category`, so a subscription that lapsed between the
 * nightly cron runs cannot leave a stale Prime badge granting Prime powers.
 */
export const getDriverPermissions = async (driverOrId, { session = null } = {}) => {
  const driver = await toDriver(driverOrId, { session });
  const tier = await subscriptionTierService.getEffectiveDriverTier(driver._id);
  const permissions = resolveTierPermissions(tier);
  const category = String(tier?.driver_category || 'lower');

  const routesUsed = await DriverRoute.countDocuments({ driver_id: driver._id, deletedAt: null });
  const maxRoutes =
    driver.max_routes_override === null || driver.max_routes_override === undefined
      ? permissions.max_routes
      : Math.max(0, Number(driver.max_routes_override));

  const vehicleRule = permissions.requires_commercial_and_private
    ? await vehicleUsageSummary(driver, { session })
    : { commercial: 0, private: 0, ok: true };

  return {
    driver,
    category,
    tier,
    ...permissions,
    max_routes: maxRoutes,
    routes_used: routesUsed,
    expires_at: tier?.subscription?.end_date || null,
    vehicle_rule: {
      required: permissions.requires_commercial_and_private,
      ok: vehicleRule.ok,
      commercial: vehicleRule.commercial,
      private: vehicleRule.private,
    },
    grace: {
      active: Boolean(driver.category_grace_ends_at && driver.category_grace_ends_at > new Date()),
      ends_at: driver.category_grace_ends_at || null,
    },
  };
};

export const checkTierEligibility = async ({ driverId, tierId }) => {
  const driver = await toDriver(driverId);
  const tier = await SubscriptionTier.findById(tierId).lean();

  if (!tier || !tier.is_active) {
    throw new ApiError(404, 'Selected subscription tier is unavailable', null, 'TIER_NOT_FOUND');
  }

  const reasons = [];

  if (tier.requires_commercial_and_private) {
    const usage = await vehicleUsageSummary(driver);
    if (usage.commercial < 1) reasons.push('NEED_COMMERCIAL_VEHICLE');
    if (usage.private < 1) reasons.push('NEED_PRIVATE_VEHICLE');
  }

  let slotsLeft = null;
  if (tier.driver_category === 'prime') {
    if (!driver.service_location_id) {
      reasons.push('CITY_REQUIRED');
    } else {
      const holdsSlot = await PrimeCitySlot.exists({ driver_id: driver._id });
      const usage = await getPrimeSlotUsage(driver.service_location_id);
      slotsLeft = holdsSlot ? Math.max(usage.left, 1) : usage.left;
      if (!holdsSlot && usage.left <= 0) reasons.push('PRIME_SLOTS_FULL');
    }
  }

  if (driver.approve !== true) reasons.push('DRIVER_NOT_APPROVED');

  return {
    eligible: reasons.length === 0,
    reasons,
    slots_left: slotsLeft,
    tier,
  };
};

/**
 * Category changes are silent to the driver unless we say so — a downgrade that
 * quietly removes their ability to create rides is the worst kind of surprise.
 * Imported lazily because the notification service reaches back into dispatch.
 */
const notifyCategory = async ({ driverId, category, previousCategory, reason }) => {
  try {
    const { notifyCategoryChanged } = await import('./networkNotificationService.js');
    await notifyCategoryChanged({ driverId, category, previousCategory, reason });
  } catch (error) {
    console.error('[driverCategoryService] category notification failed:', error.message);
  }
};

const writeCategoryAudit = async ({ driverId, tierId, action, changes = [], session = null }) => {
  await TierAuditLog.create(
    [
      {
        admin_id: null,
        admin_email: 'system',
        tier_id: tierId || null,
        action,
        changes: [{ field: 'driver_id', old_value: null, new_value: String(driverId) }, ...changes],
        ip_address: '',
      },
    ],
    { session },
  );
};

/**
 * Pushes the category implied by a freshly activated subscription onto the
 * driver, and moves the Prime seat to match.
 */
export const applyCategoryFromSubscription = async ({ subscription, session = null }) => {
  if (!subscription) return null;

  const driver = await toDriver(subscription.driver_id, { session });
  const tier = await SubscriptionTier.findById(subscription.tier_id).session(session).lean();
  if (!tier) return null;

  const category = String(tier.driver_category || 'lower');
  const previousCategory = driver.driver_category;

  if (category === 'prime') {
    await activatePrimeSlot({
      driverId: driver._id,
      subscriptionId: subscription._id,
      serviceLocationId: driver.service_location_id,
      session,
    });
  } else {
    await releasePrimeSlot({ driverId: driver._id, session });
  }

  await Driver.updateOne(
    { _id: driver._id },
    {
      $set: {
        driver_category: category,
        driver_category_source_subscription_id: subscription._id,
        driver_category_updated_at: new Date(),
        category_grace_ends_at: null,
      },
    },
    { session },
  );

  await writeCategoryAudit({
    driverId: driver._id,
    tierId: tier._id,
    action: 'driver_category_applied',
    changes: [{ field: 'driver_category', old_value: previousCategory, new_value: category }],
    session,
  });

  await notifyCategory({ driverId: driver._id, category, previousCategory, reason: 'subscription_activated' });

  return { category, previousCategory };
};

export const downgradeToLower = async ({ driverId, reason = 'subscription_expired', session = null }) => {
  const driver = await toDriver(driverId, { session });
  if (driver.driver_category === 'lower') {
    await releasePrimeSlot({ driverId: driver._id, session });
    return { changed: false, category: 'lower' };
  }

  await releasePrimeSlot({ driverId: driver._id, session });
  await Driver.updateOne(
    { _id: driver._id },
    {
      $set: {
        driver_category: 'lower',
        driver_category_source_subscription_id: null,
        driver_category_updated_at: new Date(),
        category_grace_ends_at: null,
      },
    },
    { session },
  );

  await writeCategoryAudit({
    driverId: driver._id,
    tierId: null,
    action: 'driver_category_downgraded',
    changes: [
      { field: 'driver_category', old_value: driver.driver_category, new_value: 'lower' },
      { field: 'reason', old_value: null, new_value: reason },
    ],
    session,
  });

  await notifyCategory({
    driverId: driver._id,
    category: 'lower',
    previousCategory: driver.driver_category,
    reason,
  });

  return { changed: true, category: 'lower', previousCategory: driver.driver_category };
};

/**
 * Re-checks the commercial+private rule after a vehicle is removed, rejected or
 * deactivated. A broken rule does not downgrade on the spot — the driver gets a
 * grace window to add a vehicle back, and `categoryGraceCheck` finishes the job.
 */
export const recheckCategoryVehicleRule = async (driverId) => {
  const permissions = await getDriverPermissions(driverId);

  if (!permissions.requires_commercial_and_private) {
    if (permissions.driver.category_grace_ends_at) {
      await Driver.updateOne({ _id: driverId }, { $set: { category_grace_ends_at: null } });
    }
    return { ok: true, graceStarted: false };
  }

  if (permissions.vehicle_rule.ok) {
    if (permissions.driver.category_grace_ends_at) {
      await Driver.updateOne({ _id: driverId }, { $set: { category_grace_ends_at: null } });
    }
    return { ok: true, graceStarted: false };
  }

  if (permissions.grace.active) {
    return { ok: false, graceStarted: false, graceEndsAt: permissions.grace.ends_at };
  }

  const settings = await getDriverNetworkSettings();
  const graceDays = Math.max(0, Number(settings.category_grace_days ?? 7));
  const graceEndsAt = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000);
  await Driver.updateOne({ _id: driverId }, { $set: { category_grace_ends_at: graceEndsAt } });

  // The driver cannot act on a deadline they were never told about.
  try {
    const { notifyVehicleRuleGraceStarted } = await import('./networkNotificationService.js');
    await notifyVehicleRuleGraceStarted({ driverId, graceEndsAt, days: graceDays });
  } catch (error) {
    console.error('[driverCategoryService] grace notification failed:', error.message);
  }

  return { ok: false, graceStarted: true, graceEndsAt };
};

export const expireLapsedCategories = async () => {
  const now = new Date();
  const candidates = await Driver.find({
    driver_category: { $in: ['prime', 'middle'] },
    deletedAt: null,
  })
    .select('_id driver_category')
    .lean();

  const downgraded = [];
  for (const candidate of candidates) {
    const active = await DriverSubscription.findOne({
      driver_id: candidate._id,
      status: 'active',
      start_date: { $lte: now },
      end_date: { $gte: now },
    })
      .select('_id tier_id')
      .lean();

    if (active) continue;

    await downgradeToLower({ driverId: candidate._id, reason: 'subscription_expired' });
    downgraded.push(String(candidate._id));
  }

  return { downgraded };
};

export const enforceCategoryGrace = async () => {
  const expired = await Driver.find({
    category_grace_ends_at: { $ne: null, $lt: new Date() },
    deletedAt: null,
  })
    .select('_id')
    .lean();

  const downgraded = [];
  for (const driver of expired) {
    const permissions = await getDriverPermissions(driver._id);
    if (permissions.requires_commercial_and_private && !permissions.vehicle_rule.ok) {
      await downgradeToLower({ driverId: driver._id, reason: 'vehicle_rule_broken' });
      downgraded.push(String(driver._id));
    } else {
      await Driver.updateOne({ _id: driver._id }, { $set: { category_grace_ends_at: null } });
    }
  }

  return { downgraded };
};
