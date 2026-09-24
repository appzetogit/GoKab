import { createDefaultAppSettings } from '../admin/data/defaultAppSettings.js';
import { AdminAppSetting } from '../admin/models/AdminAppSetting.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';

const defaultAppSettings = createDefaultAppSettings();

export const DEFAULT_DRIVER_NETWORK_SETTINGS = Object.freeze({
  enabled: true,
  prime_per_city: 5,
  default_corridor_km: 10,
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
  cancel_penalty_after_accept: 0,
});

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
