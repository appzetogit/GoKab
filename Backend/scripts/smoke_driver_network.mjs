/**
 * Phase-1 smoke test for the driver-network module: category resolution, tier
 * eligibility, the commercial+private vehicle rule and the Prime city cap
 * (including the concurrent-claim race).
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_driver_network.mjs
 */

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4000/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27031/gokab?replicaSet=rs0';

let pass = 0;
let fail = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const api = async (path, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
};

const login = async (phone) => {
  const { json } = await api('/drivers/login', {
    method: 'POST',
    body: { phone, password: 'password' },
  });
  return json?.data?.token;
};

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { PrimeCitySlot } = await import('../src/modules/taxi/admin/models/PrimeCitySlot.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const categoryService = await import('../src/modules/taxi/services/driverCategoryService.js');

  // Start from a known state so the run is repeatable — a previous run leaves
  // seats claimed and subscriptions active.
  await PrimeCitySlot.deleteMany({});
  await DriverSubscription.deleteMany({});
  await Driver.updateMany(
    {},
    {
      $set: {
        driver_category: 'lower',
        driver_category_source_subscription_id: null,
        category_grace_ends_at: null,
      },
    },
  );

  console.log('\n=== 1. Login & default category ===');
  const rameshToken = await login('9000000001');
  const vikasToken = await login('9000000003');
  check('Ramesh logs in', Boolean(rameshToken));
  check('Vikas logs in', Boolean(vikasToken));

  const rameshCategory = await api('/drivers/category', { token: rameshToken });
  check('GET /drivers/category returns 200', rameshCategory.status === 200, JSON.stringify(rameshCategory.json));
  check(
    'Driver with no recharge falls back to lower',
    rameshCategory.json?.data?.category === 'lower',
    rameshCategory.json?.data?.category,
  );
  check(
    'Lower cannot create rides',
    rameshCategory.json?.data?.permissions?.can_create_rides === false,
  );
  check(
    'City shows 5 Prime slots free',
    rameshCategory.json?.data?.city?.prime_slots_left === 5,
    String(rameshCategory.json?.data?.city?.prime_slots_left),
  );

  console.log('\n=== 2. Tier eligibility ===');
  const rameshTiers = await api('/drivers/subscription/tiers', { token: rameshToken });
  const vikasTiers = await api('/drivers/subscription/tiers', { token: vikasToken });
  // Resolved by category, never by tier name: a deployment may sell these
  // categories under its own names (here Premium/Super Premium), and the
  // product code branches on the category flags, so the test must too.
  const byCategory = (payload, category) =>
    (payload?.json?.data?.results || []).find((tier) => tier.driver_category === category);

  const rameshPrime = byCategory(rameshTiers, 'prime');
  const vikasPrime = byCategory(vikasTiers, 'prime');
  const vikasMiddle = byCategory(vikasTiers, 'middle');

  check(
    'Ramesh (1 commercial + 1 private) is eligible for Prime',
    rameshPrime?.eligible === true,
    JSON.stringify(rameshPrime?.ineligible_reasons),
  );
  check('Prime tier reports slots left', rameshPrime?.prime_slots_left === 5, String(rameshPrime?.prime_slots_left));
  check(
    'Vikas (private only) is blocked from Prime',
    vikasPrime?.eligible === false && vikasPrime?.ineligible_reasons?.includes('NEED_COMMERCIAL_VEHICLE'),
    JSON.stringify(vikasPrime?.ineligible_reasons),
  );
  check(
    'Vikas is blocked from Middle for the same reason',
    vikasMiddle?.ineligible_reasons?.includes('NEED_COMMERCIAL_VEHICLE'),
    JSON.stringify(vikasMiddle?.ineligible_reasons),
  );

  const anonTiers = await api('/drivers/subscription/tiers');
  check(
    'Anonymous tier list still works (no eligibility annotation)',
    anonTiers.status === 200 && byCategory(anonTiers, 'prime')?.eligible === undefined,
  );
  check(
    'Only active tiers are offered',
    (anonTiers.json?.data?.results || []).every((tier) => tier.is_active !== false),
  );

  console.log('\n=== 3. Prime city cap & race ===');
  await PrimeCitySlot.deleteMany({});
  const indoreDriver = await Driver.findOne({ phone: '9000000001' }).lean();
  const cityId = indoreDriver.service_location_id;

  // Five synthetic contenders, all claiming at once. Only five may be seated,
  // and no two may share a slot number.
  // Synthetic contenders only, so the seeded drivers stay unseated and can be
  // used below to prove the cap refuses a genuine sixth applicant.
  const allIds = [];
  for (let i = 0; i < 7; i += 1) allIds.push(new mongoose.Types.ObjectId());

  const results = await Promise.allSettled(
    allIds.map((driverId) =>
      categoryService.reservePrimeSlot({ driverId, serviceLocationId: cityId }),
    ),
  );
  const seated = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');

  check('Exactly 5 drivers are seated', seated.length === 5, `seated=${seated.length}`);
  check(
    `${allIds.length - 5} contenders are refused with PRIME_SLOTS_FULL`,
    rejected.length === allIds.length - 5 &&
      rejected.every((result) => result.reason?.code === 'PRIME_SLOTS_FULL'),
    rejected.map((r) => r.reason?.code).join(','),
  );

  const slots = await PrimeCitySlot.find({ service_location_id: cityId }).lean();
  check('Exactly 5 slot rows exist', slots.length === 5, String(slots.length));
  check(
    'Slot numbers are unique 1..5',
    new Set(slots.map((slot) => slot.slot_no)).size === 5,
    slots.map((slot) => slot.slot_no).join(','),
  );

  // Check the cap against a driver who is *not* already seated — a seat holder
  // is legitimately still eligible for the plan they hold.
  const unseated = await Driver.findOne({
    service_location_id: cityId,
    _id: { $nin: slots.map((slot) => slot.driver_id) },
  }).lean();
  check('A city driver is left unseated to test the cap', Boolean(unseated));
  if (unseated) {
    const eligibility = await categoryService.checkTierEligibility({
      driverId: unseated._id,
      tierId: (await SubscriptionTier.findOne({ driver_category: 'prime', is_active: true }).lean())._id,
    });
    check(
      'Sixth applicant is refused with PRIME_SLOTS_FULL',
      eligibility.reasons.includes('PRIME_SLOTS_FULL'),
      JSON.stringify(eligibility.reasons),
    );
  }

  console.log('\n=== 4. Stale reservation sweep ===');
  await PrimeCitySlot.updateOne(
    { service_location_id: cityId, slot_no: 1 },
    { $set: { reserved_until: new Date(Date.now() - 60_000) } },
  );
  const swept = await categoryService.releaseStalePrimeReservations();
  check('Expired reservation is released', swept.released === 1, JSON.stringify(swept));
  check(
    'Freed seat is reclaimable',
    Boolean(
      await categoryService.reservePrimeSlot({
        driverId: new mongoose.Types.ObjectId(),
        serviceLocationId: cityId,
      }),
    ),
  );

  console.log('\n=== 5. Subscription activation drives category ===');
  await PrimeCitySlot.deleteMany({});
  const primeTier = await SubscriptionTier.findOne({ driver_category: 'prime', is_active: true }).lean();
  await DriverSubscription.deleteMany({ driver_id: indoreDriver._id });
  const subscription = await DriverSubscription.create({
    driver_id: indoreDriver._id,
    tier_id: primeTier._id,
    billing_cycle: 'monthly',
    start_date: new Date(Date.now() - 1000),
    end_date: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    status: 'active',
  });
  await categoryService.applyCategoryFromSubscription({ subscription });

  const afterUpgrade = await api('/drivers/category', { token: rameshToken });
  check('Category becomes prime', afterUpgrade.json?.data?.category === 'prime', afterUpgrade.json?.data?.category);
  check('Prime can create rides', afterUpgrade.json?.data?.permissions?.can_create_rides === true);
  check('Prime can manage fleet', afterUpgrade.json?.data?.permissions?.can_manage_fleet === true);
  check('Prime route limit is 10', afterUpgrade.json?.data?.permissions?.max_routes === 10);
  check('Prime seat is taken', (await PrimeCitySlot.countDocuments({ driver_id: indoreDriver._id })) === 1);
  check(
    'Remaining seats drop to 4',
    afterUpgrade.json?.data?.city?.prime_slots_left === 4,
    String(afterUpgrade.json?.data?.city?.prime_slots_left),
  );

  console.log('\n=== 6. Expiry downgrades and frees the seat ===');
  await DriverSubscription.updateOne(
    { _id: subscription._id },
    { $set: { end_date: new Date(Date.now() - 1000) } },
  );
  const { processSubscriptionExpirations } = await import(
    '../src/modules/taxi/services/subscriptionCronService.js'
  );
  await processSubscriptionExpirations();

  const afterExpiry = await api('/drivers/category', { token: rameshToken });
  check('Category falls back to lower', afterExpiry.json?.data?.category === 'lower', afterExpiry.json?.data?.category);
  check('Prime seat is released', (await PrimeCitySlot.countDocuments({ driver_id: indoreDriver._id })) === 0);
  check('Lower can no longer create rides', afterExpiry.json?.data?.permissions?.can_create_rides === false);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
};

run()
  .catch((error) => {
    console.error('Smoke run crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
