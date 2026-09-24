/**
 * Seeds the three driver-network recharge plans: Prime, Middle and Lower.
 *
 * These are ordinary `SubscriptionTier` documents — the recharge a driver buys
 * *is* what grants the category — so they sit alongside any tiers already in
 * the database. Matching is by name, so re-running updates rather than
 * duplicates.
 *
 * Every number here is a starting point the admin panel can change; nothing in
 * the code branches on tier *names*, only on the flags below.
 *
 * Usage: node scripts/seed_driver_network_tiers.js
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { SubscriptionTier } from '../src/modules/taxi/admin/models/SubscriptionTier.js';
import { RideModule } from '../src/modules/taxi/admin/models/RideModule.js';
import { DriverNeededDocument } from '../src/modules/taxi/admin/models/DriverNeededDocument.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const URI = process.env.SEED_DB_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.SEED_DB_NAME || process.env.MONGODB_DB_NAME;

if (process.env.SEED_DNS_SERVERS) {
  const dns = await import('node:dns');
  dns.setServers(process.env.SEED_DNS_SERVERS.split(',').map((entry) => entry.trim()));
}

// Bug fixed here: `ride_module_ids` used to be spread onto only the last
// object below (Prime) — Lower and Middle got no module list at all, which
// means "every module allowed" (matchingService.js), not the taxi-only
// modules this was meant to attach to every tier. Applying it once via
// `.map()` after the array, instead of duplicating a spread inside each
// object, is what should have prevented that.
const buildTiers = (moduleIds) => [
  {
    name: 'Lower',
    // The fallback every driver lands on with no active recharge, so this is
    // the one tier that must stay `is_default`.
    is_default: true,
    display_order: 1,
    priority_score: 10,
    price_monthly: 0,
    price_yearly: 0,
    commission_percent: 15,
    driver_category: 'lower',
    can_create_rides: false,
    can_publish_rides: false,
    can_manage_fleet: false,
    requires_commercial_and_private: false,
    requires_commercial_at_purchase: false,
    max_routes: 2,
    max_fleet_drivers: 0,
    // Any approved driver may add a second vehicle to become eligible for
    // Middle/Prime; this caps how many Lower may hold so that path doesn't
    // become a way to build a free fleet.
    max_vehicles: 2,
    // Lower pays to contact a customer lead; driver-published leads are free.
    customer_lead_contact_fee: 20,
    driver_lead_contact_fee: 0,
    customer_ride_accept_fee: 0,
    badge_color_hex: '#6B7280',
    is_active: true,
  },
  {
    name: 'Middle',
    is_default: false,
    display_order: 2,
    priority_score: 50,
    price_monthly: 999,
    price_yearly: 9990,
    commission_percent: 10,
    driver_category: 'middle',
    can_create_rides: true,
    can_publish_rides: true,
    can_manage_fleet: false,
    // Ongoing rule (grace-enforced): must hold both types to stay Middle.
    requires_commercial_and_private: true,
    // Purchase-time rule: commercial only. A driver only has their onboarding
    // vehicle at checkout, so demanding both up front is a bar a one-vehicle
    // driver could never clear.
    requires_commercial_at_purchase: true,
    max_routes: 5,
    max_fleet_drivers: 0,
    max_vehicles: 0, // unlimited — already Middle, no fleet-size reason to cap it
    customer_lead_contact_fee: 0,
    driver_lead_contact_fee: 0,
    customer_ride_accept_fee: 0,
    badge_color_hex: '#F59E0B',
    is_active: true,
  },
  {
    name: 'Prime',
    is_default: false,
    display_order: 3,
    priority_score: 100,
    price_monthly: 1999,
    price_yearly: 19990,
    commission_percent: 5,
    driver_category: 'prime',
    can_create_rides: true,
    can_publish_rides: true,
    can_manage_fleet: true,
    requires_commercial_and_private: true,
    requires_commercial_at_purchase: true,
    max_routes: 10,
    max_fleet_drivers: 50,
    max_vehicles: 0, // unlimited — fleet size is governed by max_fleet_drivers instead
    customer_lead_contact_fee: 0,
    driver_lead_contact_fee: 0,
    customer_ride_accept_fee: 0,
    badge_color_hex: '#8B5CF6',
    is_active: true,
  },
].map((tier) => (moduleIds.length ? { ...tier, ride_module_ids: moduleIds } : tier));

const run = async () => {
  if (!URI) {
    console.error('MONGODB_URI (or SEED_DB_URI) must be set.');
    process.exit(1);
  }

  await mongoose.connect(URI, {
    ...(DB_NAME ? { dbName: DB_NAME } : {}),
    serverSelectionTimeoutMS: 20000,
  });
  console.log(`Connected to "${mongoose.connection.name}"`);

  // This app is taxi-only: "Taxi" covers local and intercity rides alike, and
  // there is no delivery/pooling product for drivers of this app. Attaching
  // *every* ride module (as this used to do) put `parcel`/`carpool` requests
  // in front of taxi drivers too, and an ONLY-city-here tier — see
  // seed_tier_system.js's "Basic" — never received an intercity request at
  // all (matchingService.js skips a driver when their tier's module list is
  // non-empty and does not contain the ride's module). city + outstation
  // covers both; airport rides are matched as `city` regardless of module
  // list, so no module is needed for those.
  //
  // Ensured here, not just looked up: an empty `ride_module_ids` means "every
  // module allowed" (matchingService.js), so if this script runs before
  // seed_tier_system.js has ever created these two modules, silently getting
  // zero ids back and skipping the field would be a worse outcome than the
  // bug being fixed — it would open the door to parcel/carpool instead of
  // closing it.
  const REQUIRED_MODULES = [
    { code: 'city', display_name: 'City Taxi', description: 'Standard local city rides' },
    { code: 'outstation', display_name: 'Outstation Intercity', description: 'Long-distance intercity trips' },
  ];
  const moduleIds = [];
  for (const moduleData of REQUIRED_MODULES) {
    const module = await RideModule.findOneAndUpdate(
      { code: moduleData.code },
      { $setOnInsert: moduleData },
      { upsert: true, returnDocument: 'after' },
    );
    moduleIds.push(module._id);
  }

  // Proof that a vehicle may operate commercially. Required whenever a fleet
  // vehicle is registered as commercial, which is what the Prime/Middle
  // categories are gated on.
  const permitExists = await DriverNeededDocument.findOne({ slug: 'commercial_permit' });
  if (!permitExists) {
    await DriverNeededDocument.create({
      template_type: 'document',
      name: 'Commercial Permit',
      slug: 'commercial_permit',
      account_type: 'both',
      image_type: 'image',
      has_expiry_date: true,
      key: 'commercial_permit',
      is_required: false,
      is_editable: true,
      active: true,
      help_text: 'Required for commercial (yellow plate) vehicles only.',
      sort_order: 50,
    });
    console.log('+ Created document template: Commercial Permit');
  } else {
    console.log('= Existing document template: Commercial Permit');
  }

  for (const tierData of buildTiers(moduleIds)) {
    const existing = await SubscriptionTier.findOne({ name: tierData.name });
    if (existing) {
      await SubscriptionTier.updateOne({ _id: existing._id }, { $set: tierData });
      console.log(`= Updated ${tierData.name} (${tierData.driver_category})`);
    } else {
      await SubscriptionTier.create(tierData);
      console.log(`+ Created ${tierData.name} (${tierData.driver_category})`);
    }
  }

  // Exactly one tier may be the fallback, and it has to be the free one —
  // otherwise a driver with no recharge would inherit paid permissions.
  await SubscriptionTier.updateMany({ name: { $ne: 'Lower' } }, { $set: { is_default: false } });

  // Tiers that predate the driver network have no category fields at all, which
  // reads as "no permissions and zero routes" — strictly worse than the free
  // plan. Give them the Lower baseline so they behave sanely; an admin can
  // promote any of them to middle/prime afterwards. Pricing, commission and
  // module access are left untouched.
  const legacy = await SubscriptionTier.find({ driver_category: { $exists: false } }).lean();
  if (legacy.length) {
    await SubscriptionTier.updateMany(
      { _id: { $in: legacy.map((tier) => tier._id) } },
      {
        $set: {
          driver_category: 'lower',
          can_create_rides: false,
          can_publish_rides: false,
          can_manage_fleet: false,
          requires_commercial_and_private: false,
          requires_commercial_at_purchase: false,
          max_routes: 2,
          max_fleet_drivers: 0,
          max_vehicles: 2,
          customer_lead_contact_fee: 20,
          driver_lead_contact_fee: 0,
          customer_ride_accept_fee: 0,
        },
      },
    );
    console.log(
      `~ Gave the Lower baseline to ${legacy.length} pre-existing tier(s): ${legacy
        .map((tier) => tier.name)
        .join(', ')}`,
    );
  }

  console.log('\n--- Driver network tiers ---');
  const tiers = await SubscriptionTier.find({ driver_category: { $exists: true } })
    .sort({ display_order: 1 })
    .lean();
  for (const tier of tiers) {
    console.log(
      `- ${tier.name.padEnd(8)} ${String(tier.driver_category).padEnd(7)} ₹${String(tier.price_monthly).padEnd(5)}` +
        ` create:${tier.can_create_rides ? 'Y' : 'N'} publish:${tier.can_publish_rides ? 'Y' : 'N'}` +
        ` fleet:${tier.can_manage_fleet ? 'Y' : 'N'} routes:${tier.max_routes}` +
        `${tier.is_default ? '  (DEFAULT)' : ''}`,
    );
  }
};

run()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
