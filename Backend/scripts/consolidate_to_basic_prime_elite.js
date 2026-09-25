/**
 * Consolidates the tier catalogue to exactly three plans — Basic / Prime /
 * Elite — per the "final driver flow" change request (backend spec,
 * 2026-09-25, §B2).
 *
 * PRICING AND THE EXACT PERMISSION SPLIT BETWEEN PRIME AND ELITE ARE NOT
 * BUSINESS DECISIONS THIS SCRIPT CAN MAKE (open question #1 in the spec).
 * The numbers below are placeholders carried over from the existing
 * Middle/Prime tiers so the catalogue is immediately usable; edit the
 * PLANS array (or the tiers afterwards from the admin panel) before this
 * goes live with real pricing.
 *
 * What this script does, idempotently:
 *   - Reuses the existing `lower`/`middle`/`prime` driver-network tiers as
 *     Basic/Prime/Elite (same _id, same category) if present, so any
 *     DriverSubscription already pointing at them keeps resolving — only
 *     their name and network fields change. Creates them if missing.
 *   - Sets exactly the table from the spec: Basic is the only default,
 *     requires_commercial_and_private is now FALSE on Prime/Elite (no
 *     grace period, no post-purchase private-vehicle requirement — the
 *     spec's "no private vehicle needed after purchase"),
 *     requires_commercial_at_purchase TRUE on both.
 *   - Deactivates every other tier (the older seed_tier_system.js set:
 *     Basic ₹99, Premium, Super Premium, and anything else), refusing to
 *     touch the default tier or one with active subscriptions on it — same
 *     safety rule as scripts/map_tiers_to_categories.js.
 *
 * Running this changes what scripts/smoke_vehicle_rule_purchase.mjs expects:
 * that suite tests the *previous* change request's grace-period behaviour on
 * the Middle/Prime tiers this script reuses, and 3 of its checks fail once
 * requires_commercial_and_private is false on them — correctly, since that
 * behaviour no longer applies to these tiers. That is not a regression; it
 * is two different product configurations of the same two tier records. A
 * fresh environment that runs seed_driver_network_tiers.js WITHOUT also
 * running this script keeps the grace-period behaviour and that suite in
 * sync with it.
 *
 * Usage:
 *   node scripts/consolidate_to_basic_prime_elite.js            # apply
 *   node scripts/consolidate_to_basic_prime_elite.js --dry-run  # report only
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { SubscriptionTier } from '../src/modules/taxi/admin/models/SubscriptionTier.js';
import { DriverSubscription } from '../src/modules/taxi/driver/models/DriverSubscription.js';
import { RideModule } from '../src/modules/taxi/admin/models/RideModule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const URI = process.env.TIER_DB_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.TIER_DB_NAME || process.env.MONGODB_DB_NAME;
const DRY_RUN = process.argv.includes('--dry-run');

if (process.env.TIER_DNS_SERVERS) {
  const dns = await import('node:dns');
  dns.setServers(process.env.TIER_DNS_SERVERS.split(',').map((entry) => entry.trim()));
}

// PLACEHOLDER pricing/permissions — see the file header. `driver_category`
// reuses the existing lower/middle/prime enum values (no schema change);
// only `name` is the customer-facing marketing label.
const PLANS = [
  {
    category: 'lower',
    name: 'Basic',
    is_default: true,
    price_monthly: 0,
    price_yearly: 0,
    commission_percent: 15,
    can_create_rides: false,
    can_publish_rides: false,
    can_manage_fleet: false,
    requires_commercial_and_private: false,
    requires_commercial_at_purchase: false,
    max_routes: 2,
    max_fleet_drivers: 0,
    // A private-registered driver needs to be able to add a commercial
    // vehicle while still on Basic, to ever become eligible for Prime/Elite.
    max_vehicles: 2,
    customer_lead_contact_fee: 20,
    driver_lead_contact_fee: 0,
    customer_ride_accept_fee: 0,
    badge_color_hex: '#6B7280',
  },
  {
    category: 'middle',
    name: 'Prime',
    is_default: false,
    price_monthly: 999,
    price_yearly: 9990,
    commission_percent: 10,
    can_create_rides: true,
    can_publish_rides: true,
    can_manage_fleet: false,
    // No ongoing private-vehicle requirement post-purchase: this is what
    // "no grace period, no downgrade for that reason" means in the spec.
    requires_commercial_and_private: false,
    requires_commercial_at_purchase: true,
    max_routes: 5,
    max_fleet_drivers: 0,
    max_vehicles: 0,
    customer_lead_contact_fee: 0,
    driver_lead_contact_fee: 0,
    customer_ride_accept_fee: 0,
    badge_color_hex: '#F59E0B',
  },
  {
    category: 'prime',
    name: 'Elite',
    is_default: false,
    price_monthly: 1999,
    price_yearly: 19990,
    commission_percent: 5,
    can_create_rides: true,
    can_publish_rides: true,
    can_manage_fleet: true,
    requires_commercial_and_private: false,
    requires_commercial_at_purchase: true,
    max_routes: 10,
    max_fleet_drivers: 50,
    max_vehicles: 0,
    customer_lead_contact_fee: 0,
    driver_lead_contact_fee: 0,
    customer_ride_accept_fee: 0,
    badge_color_hex: '#8B5CF6',
  },
];

const run = async () => {
  if (!URI) {
    console.error('MONGODB_URI (or TIER_DB_URI) must be set.');
    process.exit(1);
  }

  await mongoose.connect(URI, {
    ...(DB_NAME ? { dbName: DB_NAME } : {}),
    serverSelectionTimeoutMS: 20000,
  });
  console.log(`Connected to "${mongoose.connection.name}"${DRY_RUN ? ' (dry run)' : ''}\n`);

  // Every taxi tier needs city+outstation (see the earlier taxi-only-platform
  // change) and never parcel/carpool. Reuse whatever already exists; create
  // city/outstation if this is a fresh environment.
  const requiredModules = [];
  for (const code of ['city', 'outstation']) {
    const module = await RideModule.findOneAndUpdate(
      { code },
      { $setOnInsert: { code, display_name: code === 'city' ? 'City Taxi' : 'Outstation Intercity' } },
      { upsert: true, returnDocument: 'after' },
    );
    requiredModules.push(module._id);
  }

  for (const plan of PLANS) {
    const { category, ...fields } = plan;
    let tier = await SubscriptionTier.findOne({ driver_category: category });

    if (!tier) {
      console.log(`${DRY_RUN ? 'Would create' : 'Creating'} "${fields.name}" (${category}) — none exists yet`);
      if (!DRY_RUN) {
        tier = await SubscriptionTier.create({ ...fields, driver_category: category, ride_module_ids: requiredModules, is_active: true });
      }
      continue;
    }

    console.log(
      `${DRY_RUN ? 'Would rename' : 'Renaming '} "${tier.name}" -> "${fields.name}" ` +
        `(₹${tier.price_monthly} -> ₹${fields.price_monthly}, ${category})`,
    );
    if (!DRY_RUN) {
      await SubscriptionTier.updateOne(
        { _id: tier._id },
        { $set: { ...fields, ride_module_ids: requiredModules, is_active: true } },
      );
    }
  }

  // Enforce Basic as the only default.
  if (!DRY_RUN) {
    await SubscriptionTier.updateMany({ driver_category: { $ne: 'lower' } }, { $set: { is_default: false } });
  }

  // Deactivate every other tier — the older seed_tier_system.js set and any
  // stray duplicates. Never the default, never one with active subscribers.
  const others = await SubscriptionTier.find({ driver_category: { $nin: ['lower', 'middle', 'prime'] } });
  for (const tier of others) {
    if (tier.is_default) {
      console.log(`  REFUSE "${tier.name}" — it is the default fallback tier`);
      continue;
    }
    const inUse = await DriverSubscription.countDocuments({ tier_id: tier._id, status: 'active' });
    if (inUse > 0) {
      console.log(`  REFUSE "${tier.name}" — ${inUse} driver(s) are on it right now`);
      continue;
    }
    console.log(`  ${DRY_RUN ? 'would hide' : 'hiding  '} "${tier.name}" (not one of Basic/Prime/Elite)`);
    if (!DRY_RUN) {
      await SubscriptionTier.updateOne({ _id: tier._id }, { $set: { is_active: false } });
    }
  }

  console.log('\n--- resulting catalogue ---');
  const tiers = await SubscriptionTier.find().sort({ display_order: 1, price_monthly: 1 }).lean();
  for (const tier of tiers) {
    console.log(
      `  ${String(tier.name).padEnd(10)} ${String(tier.driver_category).padEnd(7)} ₹${String(tier.price_monthly).padEnd(5)}` +
        ` purchase-commercial:${tier.requires_commercial_at_purchase ? 'Y' : 'n'} ongoing-both:${tier.requires_commercial_and_private ? 'Y' : 'n'}` +
        ` ${tier.is_active ? '' : '[hidden]'}${tier.is_default ? '[DEFAULT]' : ''}`,
    );
  }

  console.log(`\n${DRY_RUN ? 'Dry run — nothing was written.' : 'Done.'}`);
};

run()
  .catch((error) => {
    console.error('Consolidation failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
