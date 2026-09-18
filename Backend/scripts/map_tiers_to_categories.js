/**
 * Maps existing subscription tiers onto driver-network categories.
 *
 * Use this when a deployment already sells plans under its own names and those
 * plans — not the seeded placeholders — should be what grants Prime/Middle.
 * Only the network fields are written: price, commission, priority, ride
 * modules and support channel are left exactly as they are.
 *
 * Idempotent: re-running writes the same values.
 *
 * Usage:
 *   TIER_MAP='Premium=middle,Super Premium=prime' \
 *   DEACTIVATE='Middle,Prime' \
 *   node scripts/map_tiers_to_categories.js [--dry-run]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { SubscriptionTier } from '../src/modules/taxi/admin/models/SubscriptionTier.js';
import { DriverSubscription } from '../src/modules/taxi/driver/models/DriverSubscription.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const URI = process.env.TIER_DB_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.TIER_DB_NAME || process.env.MONGODB_DB_NAME;
const DRY_RUN = process.argv.includes('--dry-run');

if (process.env.TIER_DNS_SERVERS) {
  const dns = await import('node:dns');
  dns.setServers(process.env.TIER_DNS_SERVERS.split(',').map((entry) => entry.trim()));
}

// What each category unlocks. Deliberately the only fields this script touches.
const CATEGORY_PERMISSIONS = {
  lower: {
    can_create_rides: false,
    can_publish_rides: false,
    can_manage_fleet: false,
    requires_commercial_and_private: false,
    max_routes: 2,
    max_fleet_drivers: 0,
    customer_lead_contact_fee: 20,
    driver_lead_contact_fee: 0,
    customer_ride_accept_fee: 0,
  },
  middle: {
    can_create_rides: true,
    can_publish_rides: true,
    can_manage_fleet: false,
    requires_commercial_and_private: true,
    max_routes: 5,
    max_fleet_drivers: 0,
    customer_lead_contact_fee: 0,
    driver_lead_contact_fee: 0,
    customer_ride_accept_fee: 0,
  },
  prime: {
    can_create_rides: true,
    can_publish_rides: true,
    can_manage_fleet: true,
    requires_commercial_and_private: true,
    max_routes: 10,
    max_fleet_drivers: 50,
    customer_lead_contact_fee: 0,
    driver_lead_contact_fee: 0,
    customer_ride_accept_fee: 0,
  },
};

const parseMap = (raw) =>
  String(raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, category] = entry.split('=').map((part) => part.trim());
      if (!name || !CATEGORY_PERMISSIONS[category]) {
        throw new Error(`Bad mapping "${entry}" — expected Name=prime|middle|lower`);
      }
      return { name, category };
    });

const run = async () => {
  if (!URI) {
    console.error('MONGODB_URI (or TIER_DB_URI) must be set.');
    process.exit(1);
  }

  const mappings = parseMap(process.env.TIER_MAP);
  const deactivate = String(process.env.DEACTIVATE || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  if (!mappings.length && !deactivate.length) {
    console.error('Nothing to do — set TIER_MAP and/or DEACTIVATE.');
    process.exit(1);
  }

  await mongoose.connect(URI, {
    ...(DB_NAME ? { dbName: DB_NAME } : {}),
    serverSelectionTimeoutMS: 20000,
  });
  console.log(`Connected to "${mongoose.connection.name}"${DRY_RUN ? ' (dry run)' : ''}\n`);

  for (const { name, category } of mappings) {
    const tier = await SubscriptionTier.findOne({ name });
    if (!tier) {
      console.log(`  SKIP  "${name}" — no such tier`);
      continue;
    }

    const permissions = CATEGORY_PERMISSIONS[category];
    console.log(
      `  ${DRY_RUN ? 'would map' : 'mapping '} "${name}" (₹${tier.price_monthly}, ${tier.commission_percent}% commission): ` +
        `${tier.driver_category} -> ${category}`,
    );

    if (!DRY_RUN) {
      await SubscriptionTier.updateOne(
        { _id: tier._id },
        { $set: { driver_category: category, ...permissions } },
      );
    }
  }

  for (const name of deactivate) {
    const tier = await SubscriptionTier.findOne({ name });
    if (!tier) {
      console.log(`  SKIP  "${name}" — no such tier`);
      continue;
    }

    if (tier.is_default) {
      // The fallback tier is what every driver without a subscription resolves
      // to; hiding it would leave them with no tier at all.
      console.log(`  REFUSE "${name}" — it is the default fallback tier`);
      continue;
    }

    const inUse = await DriverSubscription.countDocuments({ tier_id: tier._id, status: 'active' });
    if (inUse > 0) {
      console.log(`  REFUSE "${name}" — ${inUse} driver(s) are on it right now`);
      continue;
    }

    console.log(`  ${DRY_RUN ? 'would hide' : 'hiding  '} "${name}" (unused placeholder)`);
    // Deactivated, not deleted: reversible with a single flag, and any audit
    // log or payment row that references it still resolves.
    if (!DRY_RUN) {
      await SubscriptionTier.updateOne({ _id: tier._id }, { $set: { is_active: false } });
    }
  }

  console.log('\n--- resulting catalogue ---');
  const tiers = await SubscriptionTier.find().sort({ display_order: 1, price_monthly: 1 }).lean();
  for (const tier of tiers) {
    console.log(
      `  ${String(tier.name).padEnd(14)} ${String(tier.driver_category).padEnd(7)} ₹${String(tier.price_monthly).padEnd(5)}` +
        ` create:${tier.can_create_rides ? 'Y' : 'n'} publish:${tier.can_publish_rides ? 'Y' : 'n'}` +
        ` fleet:${tier.can_manage_fleet ? 'Y' : 'n'} routes:${String(tier.max_routes).padEnd(2)}` +
        ` ${tier.is_active ? '' : '[hidden]'}${tier.is_default ? '[DEFAULT]' : ''}`,
    );
  }

  console.log(`\n${DRY_RUN ? 'Dry run — nothing was written.' : 'Done.'}`);
};

run()
  .catch((error) => {
    console.error('Mapping failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
