import { SubscriptionTier } from '../admin/models/SubscriptionTier.js';
import { DriverSubscription } from '../driver/models/DriverSubscription.js';
import { getDriverNetworkSettings, isPlanRulesEnabled } from './appSettingsService.js';
import { REQUEST_STEP_MODES, kindOfRide, plansOpenAtStep, stepsForKind } from './requestSteps.js';

/** The switch, the steps for this kind of ride and the All Locations radius. */
export const getRequestSteps = async (kind = 'default') => {
  const settings = await getDriverNetworkSettings();
  const steps = stepsForKind(settings.request_steps, kind);
  const mode = REQUEST_STEP_MODES.includes(settings.request_steps_mode) ? settings.request_steps_mode : 'off';
  return {
    mode: steps ? mode : 'off',
    steps,
    radiusKm: Number(settings.all_locations_radius_km) > 0 ? Number(settings.all_locations_radius_km) : null,
  };
};

/** Whether rides are being sent by request steps now. Any doubt means the earlier phases apply. */
export const areRequestStepsOn = async () => {
  try {
    return (await getDriverNetworkSettings()).request_steps_mode === 'on';
  } catch (error) {
    console.error('[requestSteps] switch unreadable, treating as off:', error.message);
    return false;
  }
};

/**
 * driverId → plan id, for many drivers at once. Same rule as
 * `getEffectiveDriverTier`: the running subscription's plan, else the default.
 */
export const getPlanIdsForDrivers = async (driverIds = []) => {
  if (!driverIds.length) return new Map();
  const now = new Date();
  const [subscriptions, plans, planRulesOn] = await Promise.all([
    DriverSubscription.find({
      driver_id: { $in: driverIds },
      status: 'active',
      start_date: { $lte: now },
      end_date: { $gte: now },
    }).select('driver_id tier_id').lean(),
    SubscriptionTier.find({}).select('is_default is_active').lean(),
    isPlanRulesEnabled(),
  ]);

  const usable = new Set(plans.filter((plan) => plan.is_active || planRulesOn).map((plan) => String(plan._id)));
  const defaultPlan = plans.find((plan) => plan.is_default && plan.is_active);
  const result = new Map(driverIds.map((id) => [String(id), defaultPlan ? String(defaultPlan._id) : null]));
  for (const subscription of subscriptions) {
    const planId = String(subscription.tier_id);
    if (usable.has(planId)) result.set(String(subscription.driver_id), planId);
  }
  return result;
};

/** How long before pickup a ride booked for later starts searching. */
export const getDispatchLeadMs = async (ride) => {
  // Imported when needed: rideService reaches this file through tierPhaseService.
  const { getScheduledDispatchLeadMs } = await import('./rideService.js');
  const commonMs = await getScheduledDispatchLeadMs();
  if (kindOfRide(ride) !== 'outstation') return commonMs;
  const settings = await getDriverNetworkSettings();
  const minutes = Number(settings.outstation_dispatch_lead_minutes);
  return settings.request_steps_mode === 'on' && minutes > 0 ? minutes * 60 * 1000 : commonMs;
};

/** True while a ride booked for later has not reached its search time. */
export const isBeforeSearchTime = async (ride, now = Date.now()) => {
  if (!ride?.scheduledAt || ride.tierPhaseIndex != null || String(ride.bookingMode || 'normal') !== 'normal') return false;
  return now < new Date(ride.scheduledAt).getTime() - (await getDispatchLeadMs(ride));
};

/** Whether a ride sent by request steps is open to this plan now. */
export const isRideOpenToPlan = (ride, planId) =>
  plansOpenAtStep(ride?.requestSteps || [], ride?.tierPhaseIndex ?? 0).includes(String(planId));
