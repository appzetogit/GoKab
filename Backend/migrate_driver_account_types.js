import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Driver } from './src/modules/taxi/driver/models/Driver.js';
import { Vehicle } from './src/modules/taxi/admin/models/Vehicle.js';
import { AccountTypeAuditLog } from './src/modules/taxi/admin/models/AccountTypeAuditLog.js';
import { getAccountTypeSettings } from './src/modules/taxi/services/accountTypeReconciliationService.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGODB_DB_NAME || 'gokab';

async function runMigration() {
  try {
    console.log(`Connecting to MongoDB database: ${dbName}...`);
    await mongoose.connect(MONGODB_URI, { dbName });
    console.log('Connected successfully!');

    const settings = await getAccountTypeSettings();
    const gracePeriodMs = settings.grace_period_days * 24 * 60 * 60 * 1000;

    const allDrivers = await Driver.find({});
    console.log(`Found ${allDrivers.length} total drivers in database.`);

    let migratedCount = 0;

    for (const driver of allDrivers) {
      const ownerId = driver.owner_id || driver._id;
      const actualVehicleCount = await Vehicle.countDocuments({ owner_id: ownerId });

      let targetType = driver.account_type;

      // 1. Reclassify bus_driver or missing account_type
      if (driver.account_type === 'bus_driver' || !['individual', 'vendor', 'super_fleet_owner'].includes(driver.account_type)) {
        if (actualVehicleCount >= settings.super_fleet_min_vehicles) {
          targetType = 'super_fleet_owner';
        } else if (actualVehicleCount >= settings.vendor_min_vehicles) {
          targetType = 'vendor';
        } else {
          targetType = 'individual';
        }
      }

      // 2. Reclassify individual drivers with >= 2 vehicles
      if (driver.account_type === 'individual' && actualVehicleCount >= settings.vendor_min_vehicles) {
        if (actualVehicleCount >= settings.super_fleet_min_vehicles) {
          targetType = 'super_fleet_owner';
        } else {
          targetType = 'vendor';
        }
      }

      // Perform update if targetType is different or grace_period_ends_at is missing
      if (targetType !== driver.account_type || !driver.grace_period_ends_at) {
        const oldType = driver.account_type || 'legacy_unclassified';
        driver.account_type = targetType;
        driver.grace_period_ends_at = new Date(Date.now() + gracePeriodMs);
        await driver.save();

        await AccountTypeAuditLog.create({
          driver_id: driver._id,
          old_account_type: oldType,
          new_account_type: targetType,
          reason: 'migration_script',
          actual_vehicle_count: actualVehicleCount,
          performed_by: 'migration',
          details: `Migrated legacy account type ${oldType} to ${targetType}. Vehicle count: ${actualVehicleCount}`,
        });

        console.log(`+ Migrated Driver "${driver.name}" (${driver.phone}): ${oldType} -> ${targetType} (Vehicles: ${actualVehicleCount})`);
        migratedCount += 1;
      }
    }

    console.log(`\n--- MIGRATION COMPLETE ---`);
    console.log(`Successfully migrated ${migratedCount} driver accounts.`);
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

runMigration();
