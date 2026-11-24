import { createDefaultAppSettings } from '../admin/data/defaultAppSettings.js';
import { AdminAppSetting } from '../admin/models/AdminAppSetting.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';

const defaultAppSettings = createDefaultAppSettings();

export const DEFAULT_DRIVER_NETWORK_SETTINGS = Object.freeze({
  enabled: true,
  prime_per_city: 5,
  default_corridor_km: 10,
  // Widest corridor a driver may pick, the longest route, and how often a driver
  // may change mode / route in a day. All Locations radius: rides this far from
  // the driver (plus the driver's own city) are offered in All Locations mode.
  max_corridor_km: 25,
  max_route_km: 1500,
  route_switches_per_day: 10,
  all_locations_radius_km: 15,
  publish_expiry_minutes: 60,
  publish_min_lead_minutes: 0,
  platform_commission_on_published_rides_percent: 0,
  escrow_dispute_window_hours: 24,
  category_grace_days: 7,
  // Longer than the ongoing-rule grace above: this one starts the moment a
  // Middle/Prime purchase is granted on commercial alone, giving the driver
  // time to add the private vehicle the *ongoing* rule will otherwise demand.
  purchase_grace_days: 15,
  prime_slot_reservation_minutes: 15,
  call_mode: 'reveal',
  live_location_emit_interval_ms: 4000,
  // OTP on rides drivers create (published / assigned) until SMS and WhatsApp are live.
  // Empty = a random OTP for each ride.
  network_fixed_otp: '1234',
  cancel_penalty_after_accept: 0,
  // Published rides go to a driver the publisher approves (request → approve)
  // instead of the first driver to tap Accept.
  feed_requires_approval: true,
  // Admin-managed plans: drivers keep the benefits they bought until renewal.
  // Off = plans work as before.
  plan_rules_enabled: false,
  // Request steps (requestSteps.js). 'off' = the earlier plan phases; 'shadow' =
  // those phases, plus a log line of whom the steps would ask; 'on' = the steps.
  request_steps_mode: 'off',
  request_steps: {},
  // With steps on: outstation rides booked for later start searching this long
  // before pickup. 0 = the same lead time as other scheduled rides.
  outstation_dispatch_lead_minutes: 0,
});

let planRules = { enabled: false, readAt: 0 };

/** The `plan_rules_enabled` switch, read at most every 15 s. Any doubt means off. */
export const isPlanRulesEnabled = async () => {
  if (Date.now() - planRules.readAt < 15_000) return planRules.enabled;
  planRules = { ...planRules, readAt: Date.now() };
  try {
    planRules.enabled = (await getDriverNetworkSettings()).plan_rules_enabled === true;
  } catch (error) {
    planRules.enabled = false;
    console.error('[appSettings] plan rules switch unreadable, treating as off:', error.message);
  }
  return planRules.enabled;
};

export const getTipSettings = async () => {
  const settings = await AdminAppSetting.findOne({ scope: 'default' })
    .select('tip_setting')
    .lean();

  return {
    ...(defaultAppSettings.tip_setting || {}),
    ...(settings?.tip_setting || {}),
  };
};

export const getWalletSettings = async () => {
  const settings = await AdminAppSetting.findOne({ scope: 'default' })
    .select('wallet_setting')
    .lean();

  return {
    ...(defaultAppSettings.wallet_setting || {}),
    ...(settings?.wallet_setting || {}),
  };
};

export const getDriverNetworkSettings = async () => {
  const settings = await AdminBusinessSetting.findOne({ scope: 'default' })
    .select('driver_network')
    .lean();

  return {
    ...DEFAULT_DRIVER_NETWORK_SETTINGS,
    ...(settings?.driver_network || {}),
  };
};
