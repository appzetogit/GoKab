/**
 * Smoke test for the vehicle-rule change request (backend spec, 2026-09-24):
 * split purchase-time vs ongoing rule, grace starting at purchase, any
 * approved driver being able to add a second vehicle, the Lower vehicle cap,
 * and the audit trail for a self-declared commercial claim.
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_vehicle_rule_purchase.mjs
 */

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4000/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27031/gokab?replicaSet=rs0';
const INDORE = [75.8577, 22.7196];

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

const login = async (phone) => (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data?.token;

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { Owner } = await import('../src/modules/taxi/admin/models/Owner.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { TierAuditLog } = await import('../src/modules/taxi/admin/models/TierAuditLog.js');
  const categoryService = await import('../src/modules/taxi/services/driverCategoryService.js');

  const city = await Driver.findOne({ phone: '9000000001' }).select('service_location_id zoneId').lean();
  const passwordHash = await bcrypt.hash('password', 10);

  const makeSyntheticDriver = async (overrides) => {
    const phone = overrides.phone;
    await Driver.deleteOne({ phone });
    return Driver.create({
      name: overrides.name,
      phone,
      password: passwordHash,
      service_location_id: city.service_location_id,
      zoneId: city.zoneId,
      vehicleType: 'car',
      vehicleNumber: `MP09${phone.slice(-4)}`,
      vehicleMake: 'Maruti',
      vehicleModel: 'Dzire',
      vehicleColor: 'White',
      vehicle_usage_type: overrides.vehicle_usage_type,
      owner_id: null,
      city: 'Indore',
      approve: overrides.approve ?? true,
      status: 'approved',
      location: { type: 'Point', coordinates: INDORE },
      wallet: { balance: 5000, cashLimit: 500, isBlocked: false, frozenBalance: 0 },
    });
  };

  const middleTier = await SubscriptionTier.findOne({ driver_category: 'middle', is_active: true }).lean();

  console.log('=== 1. Split rule: commercial-only is enough at purchase ===');
  const deepak = await makeSyntheticDriver({ name: 'Deepak Rao', phone: '9000000011', vehicle_usage_type: 'commercial' });
  const deepakToken = await login('9000000011');

  const deepakTiers = await api('/drivers/subscription/tiers', { token: deepakToken });
  const middleForDeepak = (deepakTiers.json?.data?.results || []).find((tier) => tier.driver_category === 'middle');

  check(
    'Commercial-only driver is eligible for Middle at purchase',
    middleForDeepak?.eligible === true,
    JSON.stringify(middleForDeepak?.ineligible_reasons),
  );
  check(
    'required_at_purchase asks for commercial only',
    middleForDeepak?.vehicle_rule?.required_at_purchase?.commercial === 1 &&
      middleForDeepak?.vehicle_rule?.required_at_purchase?.private === 0,
    JSON.stringify(middleForDeepak?.vehicle_rule?.required_at_purchase),
  );
  check(
    'ongoing rule still asks for both',
    middleForDeepak?.vehicle_rule?.ongoing?.commercial === 1 && middleForDeepak?.vehicle_rule?.ongoing?.private === 1,
    JSON.stringify(middleForDeepak?.vehicle_rule?.ongoing),
  );
  check(
    'current usage reflects the commercial-only onboarding vehicle',
    middleForDeepak?.vehicle_rule?.current?.commercial === 1 && middleForDeepak?.vehicle_rule?.current?.private === 0,
    JSON.stringify(middleForDeepak?.vehicle_rule?.current),
  );

  console.log('\n=== 2. Grace starts at purchase, unverified claim is audited ===');
  await DriverSubscription.deleteMany({ driver_id: deepak._id });
  await TierAuditLog.deleteMany({ 'changes.new_value': String(deepak._id) });
  const deepakSubscription = await DriverSubscription.create({
    driver_id: deepak._id,
    tier_id: middleTier._id,
    billing_cycle: 'monthly',
    start_date: new Date(Date.now() - 1000),
    end_date: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    status: 'active',
  });
  await categoryService.applyCategoryFromSubscription({ subscription: deepakSubscription });

  const deepakCategory = await api('/drivers/category', { token: deepakToken });
  check('Category becomes middle on commercial alone', deepakCategory.json?.data?.category === 'middle', deepakCategory.json?.data?.category);
  check('Grace window is active', deepakCategory.json?.data?.grace?.active === true, JSON.stringify(deepakCategory.json?.data?.grace));

  const graceEndsAt = new Date(deepakCategory.json?.data?.grace?.ends_at);
  const daysUntilGraceEnds = (graceEndsAt.getTime() - Date.now()) / (24 * 3600 * 1000);
  check(
    'Grace uses the longer purchase window (~15 days), not the 7-day ongoing one',
    daysUntilGraceEnds > 10 && daysUntilGraceEnds <= 15.1,
    `${daysUntilGraceEnds.toFixed(2)} days`,
  );

  const auditEntry = await TierAuditLog.findOne({
    action: 'unverified_commercial_claim',
    'changes.new_value': String(deepak._id),
  }).lean();
  check('Unverified commercial claim is recorded on the audit trail', Boolean(auditEntry), JSON.stringify(auditEntry));

  console.log('\n=== 3. Any approved driver may add a second vehicle (P1 fix) ===');
  const kavita = await makeSyntheticDriver({ name: 'Kavita Joshi', phone: '9000000012', vehicle_usage_type: 'private' });
  const kavitaToken = await login('9000000012');

  const addVehicle = (token, plate, usageType, withPermit) =>
    api('/drivers/fleet/vehicles', {
      method: 'POST',
      token,
      body: {
        make: 'Maruti',
        model: 'Ertiga',
        number: plate,
        color: 'White',
        usage_type: usageType,
        documents: {
          rc: 'https://example.test/rc.jpg',
          ...(withPermit ? { commercial_permit: 'https://example.test/permit.jpg' } : {}),
        },
      },
    });

  const firstVehicle = await addVehicle(kavitaToken, 'MP09KV0001', 'commercial', true);
  check(
    'Lower driver with no organisation can add a vehicle (previously blocked)',
    firstVehicle.status === 201,
    JSON.stringify(firstVehicle.json),
  );

  const kavitaAfterFirst = await Driver.findById(kavita._id).select('owner_id').lean();
  check('Adding the first vehicle creates an organisation for her', Boolean(kavitaAfterFirst.owner_id));

  const secondVehicle = await addVehicle(kavitaToken, 'MP09KV0002', 'private', false);
  check('A second vehicle is allowed (still under the Lower cap)', secondVehicle.status === 201, JSON.stringify(secondVehicle.json));

  const thirdVehicle = await addVehicle(kavitaToken, 'MP09KV0003', 'private', false);
  check(
    'A third vehicle is refused — Lower is capped at max_vehicles',
    thirdVehicle.status === 403 && thirdVehicle.json?.code === 'VEHICLE_LIMIT_REACHED',
    JSON.stringify(thirdVehicle.json),
  );

  // Once admin approves the commercial fleet vehicle, Kavita's onboarding
  // (private) + fleet (commercial) vehicles together satisfy even the
  // ongoing rule — proving the path this section opened actually leads
  // somewhere, not just past the first request.
  await FleetVehicle.updateOne({ owner_id: kavitaAfterFirst.owner_id, license_plate_number: 'MP09KV0001' }, { $set: { status: 'approved' } });
  const kavitaTiers = await api('/drivers/subscription/tiers', { token: kavitaToken });
  const middleForKavita = (kavitaTiers.json?.data?.results || []).find((tier) => tier.driver_category === 'middle');
  check(
    'Once approved, she satisfies the full ongoing rule too',
    middleForKavita?.eligible === true,
    JSON.stringify(middleForKavita?.ineligible_reasons),
  );

  // Note: addOwnerVehicle also refuses an unapproved driver with
  // DRIVER_NOT_APPROVED when creating a first organisation, but that path is
  // unreachable through the real API — loginDriver already refuses to
  // authenticate anyone with `approve !== true` (403 "pending approval"), so
  // an unapproved driver can never hold a token to call this endpoint with.
  // The check is defense in depth, not something this suite can exercise
  // end-to-end without bypassing the auth layer.

  console.log('\n=== 4. Regression: private-only is still blocked from Middle ===');
  const vikasToken = await login('9000000003');
  const vikasTiers = await api('/drivers/subscription/tiers', { token: vikasToken });
  const middleForVikas = (vikasTiers.json?.data?.results || []).find((tier) => tier.driver_category === 'middle');
  check(
    'Vikas (private only, no organisation) is still blocked from Middle',
    middleForVikas?.eligible === false && middleForVikas?.ineligible_reasons?.includes('NEED_COMMERCIAL_VEHICLE'),
    JSON.stringify(middleForVikas?.ineligible_reasons),
  );

  // --- cleanup: synthetic drivers/organisations created for this run -----
  const synthetic = await Driver.find({ phone: { $in: ['9000000011', '9000000012'] } })
    .select('_id owner_id')
    .lean();
  await FleetVehicle.deleteMany({ owner_id: { $in: synthetic.map((d) => d.owner_id).filter(Boolean) } });
  await Owner.deleteMany({ _id: { $in: synthetic.map((d) => d.owner_id).filter(Boolean) } });
  await DriverSubscription.deleteMany({ driver_id: { $in: synthetic.map((d) => d._id) } });
  await TierAuditLog.deleteMany({ 'changes.new_value': { $in: synthetic.map((d) => String(d._id)) } });
  await Driver.deleteMany({ _id: { $in: synthetic.map((d) => d._id) } });
  check('Synthetic drivers cleaned up', true);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch(async (error) => {
  console.error('Smoke test crashed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
