/**
 * Backfill for the "one Taxi service" change request (backend spec,
 * 2026-09-24): this app has no separate Delivery/Pooling/Outstation product
 * for drivers, and "Taxi" is meant to cover local and intercity rides alike.
 * The code-level fix (onboarding, seeds, matching) only affects new data;
 * this catches up what already exists.
 *
 * Idempotent: every step only touches documents that do not already carry the
 * new shape, so it is safe to re-run after a partial failure or a later
 * deploy.
 *
 * Usage:
 *   node scripts/migrate_taxi_only_platform.js            # apply
 *   node scripts/migrate_taxi_only_platform.js --dry-run  # report only
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { Driver } from '../src/modules/taxi/driver/models/Driver.js';
import { SubscriptionTier } from '../src/modules/taxi/admin/models/SubscriptionTier.js';
import { RideModule } from '../src/modules/taxi/admin/models/RideModule.js';
import { DriverNeededDocument } from '../src/modules/taxi/admin/models/DriverNeededDocument.js';

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

  // 1. Legacy drivers: registerFor/serviceCategories --------------------
  // account_type is the real role marker on Driver (individual | vendor |
  // super_fleet_owner) — the schema's own enum. There is no fourth value for
  // service-center/bus/pooling-owner accounts on THIS model; those are a
  // different collection entirely, so scoping to account_type here already
  // keeps this migration away from them without needing to name them.
  const legacyDriverFilter = {
    account_type: { $in: [null, 'individual'] },
    registerFor: { $in: ['both', 'outstation', 'delivery', 'pooling'] },
  };
  const legacyDrivers = await Driver.countDocuments(legacyDriverFilter);
  console.log(`Drivers with a non-taxi registerFor: ${legacyDrivers}`);
  if (!DRY_RUN && legacyDrivers) {
    const result = await Driver.updateMany(legacyDriverFilter, {
      $set: { registerFor: 'taxi', serviceCategories: ['taxi'] },
    });
    console.log(`  matched ${result.matchedCount}, modified ${result.modifiedCount}`);
  }

  // 2. Subscription tiers: ride_module_ids -------------------------------
  // Every tier a taxi driver can hold must include city+outstation (an
  // empty list means "every module allowed" in matchingService.js, and a
  // city-only list — the live "Basic" tier — skips every intercity ride) and
  // must not include parcel/carpool (there is no delivery/pooling product
  // for drivers of this app).
  const requiredModules = await RideModule.find({ code: { $in: ['city', 'outstation'] } })
    .select('_id code')
    .lean();
  const excludedModules = await RideModule.find({ code: { $in: ['parcel', 'carpool'] } })
    .select('_id')
    .lean();
  const requiredIds = requiredModules.map((m) => String(m._id));
  const excludedIdSet = new Set(excludedModules.map((m) => String(m._id)));

  if (requiredIds.length < 2) {
    console.log(
      '\nSkipping tier module backfill: city/outstation RideModule documents are ' +
        'missing. Run seed_tier_system.js or seed_driver_network_tiers.js first.',
    );
  } else {
    const tiers = await SubscriptionTier.find({}).select('_id name ride_module_ids').lean();
    let tiersChanged = 0;
    for (const tier of tiers) {
      const current = (tier.ride_module_ids || []).map((id) => String(id));
      const withoutExcluded = current.filter((id) => !excludedIdSet.has(id));
      const next = [...new Set([...withoutExcluded, ...requiredIds])];
      const changed =
        next.length !== current.length || !next.every((id) => current.includes(id));

      if (changed) {
        tiersChanged += 1;
        console.log(`  ${tier.name}: ${current.length} module(s) -> ${next.length}`);
        if (!DRY_RUN) {
          await SubscriptionTier.updateOne({ _id: tier._id }, { $set: { ride_module_ids: next } });
        }
      }
    }
    console.log(`\nSubscription tiers needing a module fix: ${tiersChanged} / ${tiers.length}`);
  }

  // 3. Hide the Service Category field on existing installs --------------
  // A fresh install already seeds this hidden (adminService.js); an existing
  // database seeded it long before this change and needs the same update
  // applied to the row that already exists.
  const fieldFilter = { template_type: 'vehicle_field', field_key: 'serviceCategories' };
  const fieldTemplate = await DriverNeededDocument.findOne(fieldFilter).lean();
  if (fieldTemplate) {
    const alreadyHidden = fieldTemplate.active === false;
    console.log(`\nService Category field template: ${alreadyHidden ? 'already hidden' : 'currently visible'}`);
    if (!DRY_RUN && !alreadyHidden) {
      await DriverNeededDocument.updateOne(fieldFilter, {
        $set: { active: false, is_required: false, options: ['taxi'] },
      });
      console.log('  hidden');
    }
  } else {
    console.log('\nService Category field template: not present (nothing to hide)');
  }

  console.log(`\n${DRY_RUN ? 'Dry run complete — nothing was written.' : 'Migration complete.'}`);
};

run()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
