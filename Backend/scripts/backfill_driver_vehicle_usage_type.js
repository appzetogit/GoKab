/**
 * Backfill for drivers whose `vehicle_usage_type` was never set (P4 in the
 * vehicle-rule change request): drivers created before that field existed, or
 * created directly by admin, have it as `''`. `vehicleUsageSummary()` counts
 * an empty value as neither commercial nor private, so these drivers are
 * permanently blocked from Middle/Prime by `NEED_COMMERCIAL_VEHICLE` even if
 * their actual vehicle is commercial — there is nothing they can do about it
 * themselves.
 *
 * Defaults every affected driver to `'private'`, matching the schema default
 * FleetVehicle already uses for the same situation. This does not grant
 * anything — Lower has no vehicle-mix rule — it only unblocks a driver whose
 * true vehicle is commercial from adding a commercial fleet vehicle and
 * becoming eligible, without the empty field masking it as "has nothing".
 *
 * Writes a JSON report of every driver touched (id, name, phone, city) next to
 * this script, since defaulting to 'private' is a guess for any driver whose
 * real vehicle is commercial — admin should review the list once, not treat
 * this as silently correct for everyone in it.
 *
 * Usage:
 *   node scripts/backfill_driver_vehicle_usage_type.js            # apply
 *   node scripts/backfill_driver_vehicle_usage_type.js --dry-run  # report only
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { Driver } from '../src/modules/taxi/driver/models/Driver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const URI = process.env.MIGRATE_DB_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.MIGRATE_DB_NAME || process.env.MONGODB_DB_NAME;
const DRY_RUN = process.argv.includes('--dry-run');

if (process.env.MIGRATE_DNS_SERVERS) {
  const dns = await import('node:dns');
  dns.setServers(process.env.MIGRATE_DNS_SERVERS.split(',').map((entry) => entry.trim()));
}

const run = async () => {
  if (!URI) {
    console.error('MONGODB_URI (or MIGRATE_DB_URI) must be set.');
    process.exit(1);
  }

  await mongoose.connect(URI, {
    ...(DB_NAME ? { dbName: DB_NAME } : {}),
    serverSelectionTimeoutMS: 20000,
  });
  console.log(`Connected to "${mongoose.connection.name}"${DRY_RUN ? ' (dry run)' : ''}\n`);

  const filter = {
    $or: [{ vehicle_usage_type: { $exists: false } }, { vehicle_usage_type: '' }],
    deletedAt: null,
  };

  const affected = await Driver.find(filter)
    .select('_id name phone city driver_category service_location_id')
    .lean();

  console.log(`Drivers with no vehicle_usage_type: ${affected.length}`);

  if (affected.length) {
    const reportPath = path.resolve(__dirname, `backfill_vehicle_usage_type_report_${Date.now()}.json`);
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        affected.map((driver) => ({
          id: String(driver._id),
          name: driver.name,
          phone: driver.phone,
          city: driver.city,
          driver_category: driver.driver_category,
        })),
        null,
        2,
      ),
    );
    console.log(`Report written: ${reportPath}`);
  }

  if (!DRY_RUN && affected.length) {
    const result = await Driver.updateMany(filter, { $set: { vehicle_usage_type: 'private' } });
    console.log(`Set vehicle_usage_type = 'private': matched ${result.matchedCount}, modified ${result.modifiedCount}`);
  }

  console.log(`\n${DRY_RUN ? 'Dry run complete — nothing was written.' : 'Backfill complete.'}`);
};

run()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
