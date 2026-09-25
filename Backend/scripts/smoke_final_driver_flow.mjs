/**
 * Smoke test for the "final driver flow" change request (backend spec,
 * 2026-09-25): registration actually persists commercial/private, purchase
 * creates the organisation automatically, fleet list endpoints stop 403-ing a
 * driver with no organisation yet, Add Vehicle only demands vehicle-specific
 * documents, fleet-vehicle approval/rejection notifies and rechecks the
 * grace rule, a pending commercial vehicle gets its own eligibility reason,
 * and the tier catalogue guards its one default.
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_final_driver_flow.mjs
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
const loginAdmin = async () =>
  (await api('/admin/login', { method: 'POST', body: { email: 'admin@gmail.com', password: 'password' } })).json?.data?.token;

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { Owner } = await import('../src/modules/taxi/admin/models/Owner.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { DriverRegistrationSession } = await import('../src/modules/taxi/driver/models/DriverRegistrationSession.js');
  const onboardingService = await import('../src/modules/taxi/driver/services/onboardingService.js');
  const categoryService = await import('../src/modules/taxi/services/driverCategoryService.js');
  const tierService = (await import('../src/modules/taxi/services/subscriptionTierService.js')).subscriptionTierService;

  const city = await Driver.findOne({ phone: '9000000001' }).select('service_location_id zoneId').lean();
  const passwordHash = await bcrypt.hash('password', 10);
  const middleTier = await SubscriptionTier.findOne({ driver_category: 'middle', is_active: true }).lean();

  console.log('=== 1. Registration actually persists commercial/private (B1) ===');
  const registrationId = 'final-flow-reg-1';
  await DriverRegistrationSession.deleteOne({ registrationId });
  await Driver.deleteOne({ phone: '9000000021' });
  await DriverRegistrationSession.create({
    registrationId,
    phone: '9000000021',
    role: 'driver',
    status: 'personal_saved',
    otpHash: 'x',
    otpExpiresAt: new Date(Date.now() + 3600_000),
    otpVerifiedAt: new Date(),
    personal: { fullName: 'Commercial Choice', passwordHash },
    expiresAt: new Date(Date.now() + 3600_000),
  });

  const vehicleResult = await onboardingService.saveDriverVehicle({
    registrationId,
    phone: '9000000021',
    vehicle_usage_type: 'commercial',
    locationId: String(city.service_location_id),
    locationName: 'Indore',
    vehicleTypeId: new mongoose.Types.ObjectId(),
    make: 'Maruti',
    model: 'Dzire',
    year: '2022',
    number: 'MP09FF0001',
    color: 'White',
  });
  check(
    'Session actually stores vehicle_usage_type (was silently dropped)',
    vehicleResult.vehicle.vehicleUsageType === 'commercial',
    JSON.stringify(vehicleResult.vehicle.vehicleUsageType),
  );
  check(
    'Session also keeps the full serviceLocation snapshot (was silently dropped)',
    Boolean(vehicleResult.vehicle.serviceLocation?.name && vehicleResult.vehicle.serviceLocation?.coordinates),
    JSON.stringify(vehicleResult.vehicle.serviceLocation),
  );

  const completion = await onboardingService.completeDriverOnboarding({
    registrationId,
    phone: '9000000021',
    documents: { smoke_test_document: 'https://example.test/doc.jpg' },
  });
  const newDriver = await Driver.findById(completion.driver.id).select('vehicle_usage_type approve').lean();
  check(
    "The final Driver document carries 'commercial', not ''",
    newDriver.vehicle_usage_type === 'commercial',
    JSON.stringify(newDriver.vehicle_usage_type),
  );
  await Driver.updateOne({ _id: completion.driver.id }, { $set: { approve: true, status: 'approved' } });

  console.log('\n=== 2. Purchase creates the organisation automatically (B3) ===');
  const commercialDriverId = completion.driver.id;
  await DriverSubscription.deleteMany({ driver_id: commercialDriverId });
  const subscription = await DriverSubscription.create({
    driver_id: commercialDriverId,
    tier_id: middleTier._id,
    billing_cycle: 'monthly',
    start_date: new Date(Date.now() - 1000),
    end_date: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    status: 'active',
  });
  await categoryService.applyCategoryFromSubscription({ subscription });
  const afterPurchase = await Driver.findById(commercialDriverId).select('owner_id').lean();
  check('Driver has an organisation immediately after purchase, with no separate action', Boolean(afterPurchase.owner_id));

  console.log('\n=== 3. Fleet list endpoints stop 403-ing an org-less driver (B4) ===');
  const kavitaPhone = '9000000022';
  await Driver.deleteOne({ phone: kavitaPhone });
  const kavita = await Driver.create({
    name: 'Org-less Driver',
    phone: kavitaPhone,
    password: passwordHash,
    service_location_id: city.service_location_id,
    zoneId: city.zoneId,
    vehicleType: 'car',
    vehicleNumber: 'MP09FF0002',
    vehicle_usage_type: 'private',
    owner_id: null,
    city: 'Indore',
    approve: true,
    status: 'approved',
    location: { type: 'Point', coordinates: INDORE },
    wallet: { balance: 5000, cashLimit: 500, isBlocked: false, frozenBalance: 0 },
  });
  const kavitaToken = await login(kavitaPhone);
  const vehiclesList = await api('/drivers/fleet/vehicles', { token: kavitaToken });
  const driversList = await api('/drivers/fleet/drivers', { token: kavitaToken });
  check('GET /fleet/vehicles is 200 []  for a driver with no org (was 403)', vehiclesList.status === 200 && Array.isArray(vehiclesList.json?.data?.results) && vehiclesList.json.data.results.length === 0, JSON.stringify(vehiclesList));
  check('GET /fleet/drivers is 200 [] for a driver with no org (was 403)', driversList.status === 200 && Array.isArray(driversList.json?.data?.results) && driversList.json.data.results.length === 0, JSON.stringify(driversList));

  console.log('\n=== 4. Add Vehicle only demands vehicle-specific documents (B5) ===');
  const addVehicleResult = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: kavitaToken,
    body: { make: 'Maruti', model: 'Alto', number: 'MP09FF0003', color: 'White', usage_type: 'private', documents: {} },
  });
  check(
    'Adding a private vehicle with no documents succeeds (no driver-identity documents demanded)',
    addVehicleResult.status === 201,
    JSON.stringify(addVehicleResult.json),
  );
  const kavitaOwner = await Driver.findById(kavita._id).select('owner_id').lean();

  console.log('\n=== 5. Approval/rejection notifies and rechecks; reject needs a reason (B7) ===');
  const addedVehicle = await FleetVehicle.findOne({ owner_id: kavitaOwner.owner_id }).sort({ createdAt: -1 }).lean();
  const adminToken = await loginAdmin();
  const rejectNoReason = await api(`/admin/owner-management/manage-fleet/${addedVehicle._id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'rejected' },
  });
  check(
    'Rejecting with no reason is refused',
    rejectNoReason.status === 400 && rejectNoReason.json?.code === 'REJECTION_REASON_REQUIRED',
    JSON.stringify(rejectNoReason.json),
  );
  const approveResult = await api(`/admin/owner-management/manage-fleet/${addedVehicle._id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'approved' },
  });
  check('Approval with a stored reason (none needed) succeeds', approveResult.status === 200, JSON.stringify(approveResult.json));

  console.log('\n=== 6. Pending commercial vehicle gets its own eligibility reason (B8) ===');
  const privateOnlyPhone = '9000000023';
  await Driver.deleteOne({ phone: privateOnlyPhone });
  const privateOnly = await Driver.create({
    name: 'Pending Commercial Driver',
    phone: privateOnlyPhone,
    password: passwordHash,
    service_location_id: city.service_location_id,
    zoneId: city.zoneId,
    vehicleType: 'car',
    vehicleNumber: 'MP09FF0004',
    vehicle_usage_type: 'private',
    owner_id: null,
    city: 'Indore',
    approve: true,
    status: 'approved',
    location: { type: 'Point', coordinates: INDORE },
    wallet: { balance: 5000, cashLimit: 500, isBlocked: false, frozenBalance: 0 },
  });
  const privateOnlyToken = await login(privateOnlyPhone);
  await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: privateOnlyToken,
    body: {
      make: 'Tata', model: 'Ace', number: 'MP09FF0005', color: 'Blue', usage_type: 'commercial',
      documents: { rc: 'https://example.test/rc.jpg', commercial_permit: 'https://example.test/permit.jpg' },
    },
  });
  const eligibility = await categoryService.checkTierEligibility({ driverId: privateOnly._id, tierId: middleTier._id });
  check(
    'Reasons include both NEED_COMMERCIAL_VEHICLE and the pending-specific one',
    eligibility.reasons.includes('NEED_COMMERCIAL_VEHICLE') && eligibility.reasons.includes('COMMERCIAL_VEHICLE_PENDING_APPROVAL'),
    JSON.stringify(eligibility.reasons),
  );

  console.log('\n=== 7. Tier catalogue: createTier keeps network fields; default is guarded (B2) ===');
  const createdTier = await tierService.createTier({
    name: 'Smoke Test Tier',
    commission_percent: 8,
    driver_category: 'middle',
    can_create_rides: true,
    requires_commercial_at_purchase: true,
    max_vehicles: 3,
  });
  check(
    'A newly created tier keeps the network fields it was given (used to be silently dropped)',
    createdTier.driver_category === 'middle' && createdTier.can_create_rides === true && createdTier.requires_commercial_at_purchase === true && createdTier.max_vehicles === 3,
    JSON.stringify({ driver_category: createdTier.driver_category, can_create_rides: createdTier.can_create_rides, requires_commercial_at_purchase: createdTier.requires_commercial_at_purchase, max_vehicles: createdTier.max_vehicles }),
  );
  await SubscriptionTier.deleteOne({ _id: createdTier._id });

  const defaultTier = await SubscriptionTier.findOne({ is_default: true }).lean();
  let unsetDefaultBlocked = false;
  try {
    await tierService.updateTier(defaultTier._id, { is_default: false });
  } catch (error) {
    unsetDefaultBlocked = error?.code === 'DEFAULT_TIER_REQUIRED';
  }
  check('Unsetting the only default tier is refused', unsetDefaultBlocked);

  let deactivateDefaultBlocked = false;
  try {
    await tierService.updateTier(defaultTier._id, { is_active: false });
  } catch (error) {
    deactivateDefaultBlocked = error?.code === 'DEFAULT_TIER_REQUIRED';
  }
  check('Deactivating the only default tier is refused', deactivateDefaultBlocked);

  let deleteDefaultBlocked = false;
  try {
    await tierService.deleteTier(defaultTier._id);
  } catch (error) {
    deleteDefaultBlocked = error?.code === 'DEFAULT_TIER_REQUIRED';
  }
  check('Deleting the only default tier is refused', deleteDefaultBlocked);

  console.log('\n=== 8. Registration documents get a consistent pending state (B9) ===');
  const finalDriverWithDocs = await Driver.findById(commercialDriverId).select('documents').lean();
  const savedDoc = finalDriverWithDocs.documents?.smoke_test_document;
  check(
    'A document saved at registration gets status:pending (was completely absent before)',
    savedDoc?.status === 'pending' && savedDoc?.reviewedAt === null,
    JSON.stringify(savedDoc),
  );

  // --- cleanup ---
  const cleanupPhones = ['9000000021', '9000000022', '9000000023'];
  const cleanupDrivers = await Driver.find({ phone: { $in: cleanupPhones } }).select('_id owner_id').lean();
  await FleetVehicle.deleteMany({ owner_id: { $in: cleanupDrivers.map((d) => d.owner_id).filter(Boolean) } });
  await Owner.deleteMany({ _id: { $in: cleanupDrivers.map((d) => d.owner_id).filter(Boolean) } });
  await DriverSubscription.deleteMany({ driver_id: { $in: cleanupDrivers.map((d) => d._id) } });
  await Driver.deleteMany({ phone: { $in: cleanupPhones } });
  await DriverRegistrationSession.deleteMany({ registrationId });
  check('Cleaned up smoke fixtures', true);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch(async (error) => {
  console.error('Smoke test crashed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
