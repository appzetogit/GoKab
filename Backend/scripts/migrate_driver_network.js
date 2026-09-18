/**
 * Backfill for the driver-network module (Prime / Middle / Lower).
 *
 * Idempotent: every step only touches documents that do not already carry the
 * new shape, so it is safe to re-run after a partial failure or a later deploy.
 *
 * Usage:
 *   node scripts/migrate_driver_network.js            # apply
 *   node scripts/migrate_driver_network.js --dry-run  # report only
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { Driver } from '../src/modules/taxi/driver/models/Driver.js';
import { DriverRoute } from '../src/modules/taxi/driver/models/DriverRoute.js';
import { FleetVehicle } from '../src/modules/taxi/admin/models/FleetVehicle.js';
import { PrimeCitySlot } from '../src/modules/taxi/admin/models/PrimeCitySlot.js';
import { Ride } from '../src/modules/taxi/user/models/Ride.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const URI = process.env.MIGRATE_DB_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.MIGRATE_DB_NAME || process.env.MONGODB_DB_NAME;
const DRY_RUN = process.argv.includes('--dry-run');

if (process.env.MIGRATE_DNS_SERVERS) {
  const dns = await import('node:dns');
  dns.setServers(process.env.MIGRATE_DNS_SERVERS.split(',').map((entry) => entry.trim()));
}

const RIDE_BATCH_SIZE = 1000;

const report = (label, result) => {
  console.log(`  ${label}: matched ${result.matchedCount ?? 0}, modified ${result.modifiedCount ?? 0}`);
};

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

  // 1. Drivers -----------------------------------------------------------
  const driverFilter = {
    $or: [
      { driver_category: { $exists: false } },
      { route_mode: { $exists: false } },
      { 'wallet.frozenBalance': { $exists: false } },
    ],
  };
  const driversToFix = await Driver.countDocuments(driverFilter);
  console.log(`Drivers needing backfill: ${driversToFix}`);
  if (!DRY_RUN && driversToFix) {
    // Each field is set independently so a driver who already has a category
    // (from a re-run) does not get reset to 'lower'.
    report('driver_category', await Driver.updateMany(
      { driver_category: { $exists: false } },
      { $set: { driver_category: 'lower', driver_category_updated_at: null } },
    ));
    report('route_mode', await Driver.updateMany(
      { route_mode: { $exists: false } },
      { $set: { route_mode: 'all_locations', active_route_id: null } },
    ));
    report('wallet.frozenBalance', await Driver.updateMany(
      { 'wallet.frozenBalance': { $exists: false } },
      { $set: { 'wallet.frozenBalance': 0 } },
    ));
  }

  // 2. Fleet vehicles ----------------------------------------------------
  // Everything starts as 'private'; admin flips the genuinely commercial ones
  // after seeing a permit, which is also what sets usage_type_verified.
  const vehiclesToFix = await FleetVehicle.countDocuments({ usage_type: { $exists: false } });
  console.log(`\nFleet vehicles needing usage_type: ${vehiclesToFix}`);
  if (!DRY_RUN && vehiclesToFix) {
    report('usage_type', await FleetVehicle.updateMany(
      { usage_type: { $exists: false } },
      { $set: { usage_type: 'private', usage_type_verified: false } },
    ));
  }

  // 3. Rides -------------------------------------------------------------
  const rideFilter = { origin: { $exists: false } };
  const ridesToFix = await Ride.countDocuments(rideFilter);
  console.log(`\nRides needing network defaults: ${ridesToFix}`);
  if (!DRY_RUN && ridesToFix) {
    // Batched by _id so a large rides collection is not rewritten in one
    // long-running write that blocks the oplog.
    let processed = 0;
    let lastId = null;

    for (;;) {
      const batch = await Ride.find(lastId ? { ...rideFilter, _id: { $gt: lastId } } : rideFilter)
        .select('_id')
        .sort({ _id: 1 })
        .limit(RIDE_BATCH_SIZE)
        .lean();

      if (!batch.length) break;

      await Ride.updateMany(
        { _id: { $in: batch.map((ride) => ride._id) } },
        {
          $set: {
            origin: 'customer_app',
            'publish.status': 'none',
            'publish.is_published': false,
            'escrow.state': 'none',
            'assignment.mode': 'dispatch',
          },
        },
      );

      processed += batch.length;
      lastId = batch[batch.length - 1]._id;
      console.log(`  ...${processed}/${ridesToFix}`);
    }
  }

  // 4. Indexes -----------------------------------------------------------
  // `createIndexes()`, deliberately not `syncIndexes()`: the latter DROPS every
  // index the schema does not declare, which on a live database would silently
  // remove indexes added by hand or by an older release. Creating what is
  // missing is additive and safe to re-run.
  console.log('\nIndexes:');
  for (const model of [Driver, DriverRoute, FleetVehicle, PrimeCitySlot, Ride]) {
    const existing = await model.collection.indexes().catch(() => []);

    if (DRY_RUN) {
      console.log(`  ${model.modelName}: ${existing.length} present, ${model.schema.indexes().length} declared`);
      continue;
    }

    await model.createIndexes();
    const after = await model.collection.indexes().catch(() => []);
    console.log(`  ${model.modelName}: ${existing.length} -> ${after.length}`);
  }

  console.log(`\n${DRY_RUN ? 'Dry run complete — nothing was written.' : 'Migration complete.'}`);
};

run()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
