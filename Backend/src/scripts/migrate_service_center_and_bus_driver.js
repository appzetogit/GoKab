import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { ServiceStore } from '../modules/taxi/admin/models/ServiceStore.js';
import { ServiceCenterStaff } from '../modules/taxi/admin/models/ServiceCenterStaff.js';
import { Owner } from '../modules/taxi/admin/models/Owner.js';
import { Driver } from '../modules/taxi/driver/models/Driver.js';
import { BusDriver } from '../modules/taxi/driver/models/BusDriver.js';
import { FleetVehicle } from '../modules/taxi/admin/models/FleetVehicle.js';
import { AccountTypeAuditLog } from '../modules/taxi/admin/models/AccountTypeAuditLog.js';

export const runMigration = async ({ dryRun = false } = {}) => {
  console.log(`[MIGRATION] Starting ServiceCenter & BusDriver migration (dryRun=${dryRun})...`);

  const auditLogs = [];
  const results = {
    serviceStoresMigrated: 0,
    staffMigrated: 0,
    busDriversMigrated: 0,
    errors: [],
  };

  // 1. Migrate ServiceStore -> Owner (account_type: 'super_fleet_owner')
  const stores = await ServiceStore.find().lean();
  for (const store of stores) {
    try {
      const phone = store.owner_phone || store.phone || '';
      if (!phone) {
        results.errors.push(`Store ${store._id} (${store.name}) has no phone number`);
        continue;
      }

      let existingOwner = await Owner.findOne({
        $or: [{ phone }, { mobile: phone }],
      });

      if (!existingOwner && !dryRun) {
        existingOwner = await Owner.create({
          company_name: store.name || 'Super Fleet',
          owner_name: store.owner_name || store.name || 'Fleet Owner',
          name: store.owner_name || store.name || 'Fleet Owner',
          mobile: phone,
          phone: phone,
          email: `${phone}@fleet.gokab.internal`,
          service_location_id: store.service_location_id || null,
          account_type: 'super_fleet_owner',
          address: store.address || '',
          active: store.active !== false,
          approve: true,
          status: 'approved',
        });
      } else if (existingOwner && !dryRun) {
        existingOwner.account_type = 'super_fleet_owner';
        await existingOwner.save();
      }

      const vehicleCount = existingOwner
        ? await FleetVehicle.countDocuments({ owner_id: existingOwner._id, active: true })
        : 0;

      if (existingOwner && !dryRun) {
        existingOwner.vehicle_count = vehicleCount;
        await existingOwner.save();
      }

      if (!dryRun && existingOwner) {
        await AccountTypeAuditLog.create({
          driver_id: existingOwner._id,
          old_account_type: 'service_center',
          new_account_type: 'super_fleet_owner',
          reason: 'migration_script',
          actual_vehicle_count: vehicleCount,
          performed_by: 'migration',
          details: `Migrated ServiceStore ${store._id} (${store.name}) to Owner ${existingOwner._id}`,
        });
      }

      results.serviceStoresMigrated++;
    } catch (err) {
      results.errors.push(`Error migrating store ${store._id}: ${err.message}`);
    }
  }

  // 2. Migrate ServiceCenterStaff -> Driver (linked via owner_id)
  const staffMembers = await ServiceCenterStaff.find().lean();
  for (const staff of staffMembers) {
    try {
      const store = await ServiceStore.findById(staff.serviceCenterId).lean();
      const ownerPhone = store?.owner_phone || store?.phone || '';
      const parentOwner = ownerPhone
        ? await Owner.findOne({ $or: [{ phone: ownerPhone }, { mobile: ownerPhone }] })
        : null;

      let existingDriver = await Driver.findOne({ phone: staff.phone });
      if (!existingDriver && !dryRun) {
        existingDriver = await Driver.create({
          name: staff.name,
          phone: staff.phone,
          password: 'MigratedStaffPassword123!',
          owner_id: parentOwner?._id || null,
          approve: true,
          status: 'approved',
          active: staff.active !== false,
        });
      } else if (existingDriver && parentOwner && !dryRun) {
        existingDriver.owner_id = parentOwner._id;
        await existingDriver.save();
      }

      if (!dryRun && existingDriver) {
        await AccountTypeAuditLog.create({
          driver_id: existingDriver._id,
          old_account_type: 'service_center_staff',
          new_account_type: 'driver',
          reason: 'migration_script',
          actual_vehicle_count: 0,
          performed_by: 'migration',
          details: `Migrated ServiceCenterStaff ${staff._id} (${staff.name}) to Driver ${existingDriver._id}`,
        });
      }

      results.staffMigrated++;
    } catch (err) {
      results.errors.push(`Error migrating staff ${staff._id}: ${err.message}`);
    }
  }

  // 3. Migrate BusDriver -> Driver
  const busDrivers = await BusDriver.find().lean();
  for (const busDriver of busDrivers) {
    try {
      let existingDriver = await Driver.findOne({ phone: busDriver.phone });
      if (!existingDriver && !dryRun) {
        existingDriver = await Driver.create({
          name: busDriver.name,
          phone: busDriver.phone,
          email: busDriver.email || '',
          password: 'MigratedBusDriverPassword123!',
          approve: busDriver.approve !== false,
          status: busDriver.status === 'blocked' ? 'blocked' : 'approved',
          active: busDriver.active !== false,
        });
      }

      if (!dryRun && existingDriver) {
        await AccountTypeAuditLog.create({
          driver_id: existingDriver._id,
          old_account_type: 'bus_driver',
          new_account_type: 'driver',
          reason: 'migration_script',
          actual_vehicle_count: 0,
          performed_by: 'migration',
          details: `Migrated BusDriver ${busDriver._id} (${busDriver.name}) to Driver ${existingDriver._id}`,
        });
      }

      results.busDriversMigrated++;
    } catch (err) {
      results.errors.push(`Error migrating BusDriver ${busDriver._id}: ${err.message}`);
    }
  }

  console.log('[MIGRATION] Completed successfully:', results);
  return results;
};

if (process.argv[1]?.includes('migrate_service_center_and_bus_driver.js')) {
  const isDryRun = process.argv.includes('--dry-run');
  mongoose.connect(env.mongoUri)
    .then(() => runMigration({ dryRun: isDryRun }))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[MIGRATION FAILED]', err);
      process.exit(1);
    });
}
