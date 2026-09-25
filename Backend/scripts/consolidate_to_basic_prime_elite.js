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
 *   - Reuses an existing `lower`/`middle`/`prime` driver-network tier as
 *     Basic/Prime/Elite (same _id, same category) if present, so any
 *     DriverSubscription already pointing at it keeps resolving — only its
 *     name and network fields change. Creates one if missing.
 *   - If MORE THAN ONE tier already shares that category — this happens on a
 *     database that ran both the older seed_tier_system.js set
 *     (Basic/Premium/Super Premium, all defaulting to driver_category:'lower'
 *     or later mapped onto middle/prime) and the driver-network seed
 *     (Lower/Middle/Prime) — the one with active subscribers on it is kept
 *     and renamed; every other same-category tier is treated exactly like
 *     any other leftover duplicate below. An earlier version of this script
 *     picked whichever tier a plain `findOne` happened to return first,
 *     which could rename the wrong one and leave its sibling active and
 *     un-deactivated, silently keeping more than three tiers live and
 *     risking two tiers marked `is_default` at once.
 *   - Sets exactly the table from the spec: Basic is the only default,
 *     requires_commercial_and_private is now FALSE on Prime/Elite (no
 *     grace period, no post-purchase private-vehicle requirement — the
 *     spec's "no private vehicle needed after purchase"),
 *     requires_commercial_at_purchase TRUE on both.
 *   - Deactivates every other tier — the older seed_tier_system.js set, any
 *     stray duplicate not chosen above, and anything else — refusing to
 *     touch one with active subscriptions on it. `is_default` is cleared on
 *     every tier except the chosen Basic by _id, not by category, so a
 *     leftover default flag on a duplicate can never coexist with it.
 *
 * Running this changes what three other smoke suites expect, all for the same
 * reason: they test the *previous* change request's grace-period behaviour
 * (start a countdown when the vehicle-mix rule breaks, downgrade if it's
 * still broken when it expires) on the Middle/Prime tiers this script
 * reuses, and requires_commercial_and_private is false on them now, so that
 * behaviour no longer applies to these tiers at all:
 *   - scripts/smoke_vehicle_rule_purchase.mjs — 3 checks (grace starting at
 *     purchase)
 *   - scripts/smoke_network_notifications.mjs — 2 checks ("Vehicle-rule
 *     grace warns the driver")
 *   - scripts/smoke_network_qa_checklist.mjs — 3 checks (grace start /
 *     downgrade / seat release)
 * None of this is a regression; it is two different product configurations
 * of the same tier records. A fresh environment that runs
 * seed_driver_network_tiers.js WITHOUT also running this script keeps the
 * grace-period behaviour and all three suites in sync with it.
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

  const chosenIds = [];
  // Every tier this loop has already made a decision about — the 3 chosen
  // primaries AND every same-category duplicate folded into one of them.
  // The later "others" pass must skip all of these, not just the primaries:
  // a duplicate is a decided case (fold into its primary), not an unrelated
  // tier for that pass to independently re-judge. Missing this was a second
  // bug from the same root cause as the first — a duplicate that happened to
  // be the current default got a "would hide" here and a contradictory
  // "REFUSE ... it is the default fallback tier" from the other pass, purely
  // because dry-run mode can't see its own hypothetical write when the next
  // pass re-reads the database. The intended effect (default moves from the
  // old tier to the newly chosen one) is genuinely safe here — it's the
  // *replacement* is_default assignment below that makes it so, not a
  // coincidence — but the double-handling made that impossible to see in
  // the output.
  const handledIds = [];
  let basicTierId = null;

  for (const plan of PLANS) {
    const { category, ...fields } = plan;
    const candidates = await SubscriptionTier.find({ driver_category: category });

    if (candidates.length === 0) {
      console.log(`${DRY_RUN ? 'Would create' : 'Creating'} "${fields.name}" (${category}) — none exists yet`);
      if (!DRY_RUN) {
        const created = await SubscriptionTier.create({ ...fields, driver_category: category, ride_module_ids: requiredModules, is_active: true });
        chosenIds.push(String(created._id));
        handledIds.push(String(created._id));
        if (category === 'lower') basicTierId = String(created._id);
      }
      continue;
    }

    // Rank by active subscribers — whichever tier real drivers are actually
    // on is the one that must be kept and renamed; deactivating it would
    // silently change what they're subscribed to. With no subscribers on
    // either (the common case before this goes live), the first one Mongo
    // returns is used — harmless, since nothing yet distinguishes them.
    const ranked = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        inUse: await DriverSubscription.countDocuments({ tier_id: candidate._id, status: 'active' }),
      })),
    );
    ranked.sort((a, b) => b.inUse - a.inUse);
    const primary = ranked[0].candidate;
    const duplicates = ranked.slice(1);

    console.log(
      `${DRY_RUN ? 'Would rename' : 'Renaming '} "${primary.name}" -> "${fields.name}" ` +
        `(₹${primary.price_monthly} -> ₹${fields.price_monthly}, ${category})` +
        (candidates.length > 1
          ? ` [chosen from ${candidates.length} tiers sharing this category, ${ranked[0].inUse} active subscriber(s)]`
          : ''),
    );
    if (!DRY_RUN) {
      await SubscriptionTier.updateOne(
        { _id: primary._id },
        { $set: { ...fields, ride_module_ids: requiredModules, is_active: true } },
      );
    }
    chosenIds.push(String(primary._id));
    handledIds.push(String(primary._id));
    if (category === 'lower') basicTierId = String(primary._id);

    for (const { candidate: duplicate, inUse } of duplicates) {
      handledIds.push(String(duplicate._id));
      if (inUse > 0) {
        console.log(`  REFUSE "${duplicate.name}" — ${inUse} driver(s) are on it right now (duplicate ${category}-category tier)`);
        continue;
      }
      // A duplicate that happens to be the current default is fine to
      // demote here specifically — this same pass is establishing a new
      // default for this exact category (the chosen primary above), so the
      // old flag isn't being dropped, it's being handed off. The generic
      // "refuse to touch the default" rule below is for a tier this script
      // has no replacement default lined up for.
      console.log(
        `  ${DRY_RUN ? 'would hide' : 'hiding  '} "${duplicate.name}" (duplicate ${category}-category tier, folded into "${fields.name}")` +
          (duplicate.is_default ? ' — was the default, replaced by the tier above' : ''),
      );
      if (!DRY_RUN) {
        await SubscriptionTier.updateOne({ _id: duplicate._id }, { $set: { is_active: false, is_default: false } });
      }
    }
  }

  // Enforce the chosen Basic as the only default — by _id, never by
  // category, so a leftover default flag on a duplicate handled above (or on
  // any other tier entirely) can never coexist with it.
  if (!DRY_RUN && basicTierId) {
    await SubscriptionTier.updateMany({ _id: { $ne: basicTierId } }, { $set: { is_default: false } });
  }

  // Deactivate everything not already decided above — genuinely unrelated
  // tiers only (some other category value entirely). Every duplicate that
  // shared lower/middle/prime with a chosen tier was already handled in the
  // loop above; excluding only `chosenIds` here (instead of `handledIds`)
  // used to let this pass re-examine those same duplicates with no memory of
  // why they were already being hidden, producing a second, contradictory
  // "REFUSE ... it is the default fallback tier" for a duplicate the loop
  // above had already decided to fold in.
  const others = await SubscriptionTier.find({ _id: { $nin: handledIds } });
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
