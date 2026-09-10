import { Driver } from '../driver/models/Driver.js';
import { Owner } from '../admin/models/Owner.js';
import { FleetVehicle } from '../admin/models/FleetVehicle.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';
import { AccountTypeAuditLog } from '../admin/models/AccountTypeAuditLog.js';

export const getAccountTypeSettings = async () => {
  const doc = await AdminBusinessSetting.findOne({ scope: 'default' }).lean();
  const settings = doc?.account_type_settings || {};
  return {
    vendor_min_vehicles: Number(settings.vendor_min_vehicles ?? 2),
    vendor_max_vehicles: Number(settings.vendor_max_vehicles ?? 4),
    super_fleet_min_vehicles: Number(settings.super_fleet_min_vehicles ?? 5),
    grace_period_days: Number(settings.grace_period_days ?? 10),
    delivery_module_globally_enabled: String(settings.delivery_module_globally_enabled ?? '1') === '1',
    pooling_module_globally_enabled: String(settings.pooling_module_globally_enabled ?? '1') === '1',
    copy_individual: settings.copy_individual || 'Individual Driver: Single vehicle owned & driven by you.',
    copy_vendor: settings.copy_vendor || 'Vendor: Small fleet owner with 2 to 4 vehicles.',
    copy_super_fleet_owner: settings.copy_super_fleet_owner || 'Super Fleet Owner: Enterprise fleet manager with 5+ vehicles.',
  };
};

export const updateAccountTypeSettings = async (payload = {}) => {
  const currentSettings = await getAccountTypeSettings();
  const updatedSettings = {
    ...currentSettings,
    ...payload,
    vendor_min_vehicles: Math.max(1, Number(payload.vendor_min_vehicles ?? currentSettings.vendor_min_vehicles)),
    vendor_max_vehicles: Math.max(1, Number(payload.vendor_max_vehicles ?? currentSettings.vendor_max_vehicles)),
    super_fleet_min_vehicles: Math.max(1, Number(payload.super_fleet_min_vehicles ?? currentSettings.super_fleet_min_vehicles)),
    grace_period_days: Math.max(1, Number(payload.grace_period_days ?? currentSettings.grace_period_days)),
    delivery_module_globally_enabled: payload.delivery_module_globally_enabled !== undefined ? (payload.delivery_module_globally_enabled ? '1' : '0') : (currentSettings.delivery_module_globally_enabled ? '1' : '0'),
    pooling_module_globally_enabled: payload.pooling_module_globally_enabled !== undefined ? (payload.pooling_module_globally_enabled ? '1' : '0') : (currentSettings.pooling_module_globally_enabled ? '1' : '0'),
  };

  await AdminBusinessSetting.findOneAndUpdate(
    { scope: 'default' },
    { $set: { account_type_settings: updatedSettings } },
    { new: true, upsert: true }
  );

  return getAccountTypeSettings();
};

export const setAccountTypeAndRecalculateGracePeriod = async ({ driver, owner, newAccountType, reason, performedBy = 'system', details = '' }) => {
  const entity = owner || driver;
  if (!entity) return null;

  const oldAccountType = entity.account_type || 'vendor';
  const settings = await getAccountTypeSettings();
  const newGracePeriodEndsAt = new Date(Date.now() + settings.grace_period_days * 24 * 60 * 60 * 1000);

  entity.account_type = newAccountType;
  entity.grace_period_ends_at = newGracePeriodEndsAt;
  await entity.save();

  const actualVehicleCount = await FleetVehicle.countDocuments({ owner_id: entity._id, active: true });

  await AccountTypeAuditLog.create({
    driver_id: entity._id,
    old_account_type: oldAccountType,
    new_account_type: newAccountType,
    reason,
    actual_vehicle_count: actualVehicleCount,
    performed_by: performedBy,
    details: details || `Account type changed to ${newAccountType}. Grace period reset to ${settings.grace_period_days} days.`,
  });

  return entity;
};

export const runAccountTypeReconciliation = async () => {
  try {
    const now = new Date();
    const settings = await getAccountTypeSettings();

    const candidateOwners = await Owner.find({
      account_type: { $in: ['vendor', 'super_fleet_owner'] },
      grace_period_ends_at: { $lte: now },
    });

    let reconciledCount = 0;

    for (const owner of candidateOwners) {
      const actualVehicleCount = await FleetVehicle.countDocuments({ owner_id: owner._id, active: true });
      owner.vehicle_count = actualVehicleCount;
      owner.no_of_vehicles = actualVehicleCount;

      let targetAccountType = owner.account_type;

      if (owner.account_type === 'super_fleet_owner') {
        if (actualVehicleCount >= settings.super_fleet_min_vehicles) {
          owner.grace_period_ends_at = null;
          await owner.save();
          continue;
        } else if (actualVehicleCount >= settings.vendor_min_vehicles) {
          targetAccountType = 'vendor';
        } else {
          targetAccountType = 'vendor';
        }
      } else if (owner.account_type === 'vendor') {
        if (actualVehicleCount >= settings.vendor_min_vehicles) {
          owner.grace_period_ends_at = null;
          await owner.save();
          continue;
        } else if (actualVehicleCount >= settings.super_fleet_min_vehicles) {
          targetAccountType = 'super_fleet_owner';
        }
      }

      if (targetAccountType !== owner.account_type) {
        await setAccountTypeAndRecalculateGracePeriod({
          owner,
          newAccountType: targetAccountType,
          reason: 'grace_period_reconciliation',
          performedBy: 'system',
          details: `Reconciled after grace period. Actual vehicles: ${actualVehicleCount}`,
        });
        reconciledCount += 1;
      }
    }

    console.log(`[accountTypeReconciliationService] Reconciled ${reconciledCount} owner accounts.`);
    return { success: true, reconciledCount };
  } catch (error) {
    console.error('[accountTypeReconciliationService] Reconciliation error:', error);
    return { success: false, error: error.message };
  }
};
