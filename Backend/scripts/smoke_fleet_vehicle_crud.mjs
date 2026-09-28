/**
 * Smoke test for the Fleet Vehicles CRUD spec (backend spec, 2026-09-29):
 * block delete/edit of an assigned/on-trip vehicle, sync the assigned
 * driver's copied fields after an edit, send an approved vehicle back to
 * pending on a material change, applies_when_usage_type-aware document
 * validation, global plate uniqueness, and the assignedDriver.isOnRide /
 * documents_summary additions on the list endpoint.
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_fleet_vehicle_crud.mjs
 */

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4077/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27033/gokab_vehicle_test?replicaSet=rs0';

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

const login = async (phone) =>
  (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data?.token;

const doc = (name) => ({ secureUrl: `https://example.com/${name}.jpg`, previewUrl: `https://example.com/${name}.jpg` });

const run = async () => {
  await mongoose.connect(DB_URI);
  const bcrypt = (await import('bcryptjs')).default;
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { Owner } = await import('../src/modules/taxi/admin/models/Owner.js');
  const { ServiceLocation } = await import('../src/modules/taxi/admin/models/ServiceLocation.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');

  let serviceLocation = await ServiceLocation.findOne({ service_location_name: 'Indore' });
  if (!serviceLocation) {
    serviceLocation = await ServiceLocation.create({
      name: 'Indore', service_location_name: 'Indore', country: 'India',
      latitude: 22.7196, longitude: 75.8577, status: 'active', active: true,
    });
  }

  const passwordHash = await bcrypt.hash('password', 10);
  const primeTier = await SubscriptionTier.findOne({ driver_category: 'prime' });
  if (!primeTier) throw new Error('No Prime tier found — run scripts/seed_driver_network_tiers.js first');

  // --- Two separate owners, to exercise cross-owner plate uniqueness. ---
  let ownerADriver = await Driver.findOne({ phone: '9222200001' });
  if (!ownerADriver) {
    ownerADriver = await Driver.create({
      name: 'Fleet Vehicle Smoke Owner A', phone: '9222200001', password: passwordHash,
      vehicleType: 'car', service_location_id: serviceLocation._id, city: 'Indore',
      approve: true, status: 'approved', registerFor: 'taxi',
      location: { type: 'Point', coordinates: [75.8577, 22.7196] },
    });
  }
  await DriverSubscription.deleteMany({ driver_id: ownerADriver._id });
  await DriverSubscription.create({
    driver_id: ownerADriver._id, tier_id: primeTier._id, billing_cycle: 'monthly',
    status: 'active', start_date: new Date(), end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  let ownerBDriver = await Driver.findOne({ phone: '9222200002' });
  if (!ownerBDriver) {
    ownerBDriver = await Driver.create({
      name: 'Fleet Vehicle Smoke Owner B', phone: '9222200002', password: passwordHash,
      vehicleType: 'car', service_location_id: serviceLocation._id, city: 'Indore',
      approve: true, status: 'approved', registerFor: 'taxi',
      location: { type: 'Point', coordinates: [75.8577, 22.7196] },
    });
  }
  await DriverSubscription.deleteMany({ driver_id: ownerBDriver._id });
  await DriverSubscription.create({
    driver_id: ownerBDriver._id, tier_id: primeTier._id, billing_cycle: 'monthly',
    status: 'active', start_date: new Date(), end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  // Reset per-run state: no vehicles, no organisations, no leftover fleet
  // drivers or plates from a previous run of this same script.
  const TEST_PLATES = ['MP09VC0001', 'MP09VC0002', 'MP09VC0003'];
  await FleetVehicle.deleteMany({ license_plate_number: { $in: TEST_PLATES } });
  await Driver.deleteMany({ phone: '9222299901' });
  await Owner.deleteOne({ mobile: ownerADriver.phone });
  await Owner.deleteOne({ mobile: ownerBDriver.phone });
  await Driver.updateMany({ _id: { $in: [ownerADriver._id, ownerBDriver._id] } }, { $set: { owner_id: null, is_self_drive_owner: false } });

  const tokenA = await login('9222200001');
  const tokenB = await login('9222200002');
  check('Owner A logs in', Boolean(tokenA));
  check('Owner B logs in', Boolean(tokenB));

  console.log('\n=== 1. Create: missing vehicleTypeId -> 400 FIELD_REQUIRED ===');
  const missingType = await api('/drivers/fleet/vehicles', {
    method: 'POST', token: tokenA,
    body: { make: 'Maruti', model: 'Dzire', number: 'MP09VC0001', color: 'White', usage_type: 'private', documents: {} },
  });
  check('400 FIELD_REQUIRED', missingType.status === 400 && missingType.json?.code === 'FIELD_REQUIRED', JSON.stringify(missingType.json));

  console.log('\n=== 2. Create: commercial without permit -> 400 COMMERCIAL_PERMIT_REQUIRED ===');
  const noPermit = await api('/drivers/fleet/vehicles', {
    method: 'POST', token: tokenA,
    body: { vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Maruti', model: 'Dzire', number: 'MP09VC0001', color: 'White', usage_type: 'commercial', documents: {} },
  });
  check('400 COMMERCIAL_PERMIT_REQUIRED', noPermit.status === 400 && noPermit.json?.code === 'COMMERCIAL_PERMIT_REQUIRED', JSON.stringify(noPermit.json));

  console.log('\n=== 3. Create: private vehicle, commercial-only template not demanded ===');
  const privateOk = await api('/drivers/fleet/vehicles', {
    method: 'POST', token: tokenA,
    body: { vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Maruti', model: 'Dzire', number: 'MP09VC0001', color: 'White', usage_type: 'private', documents: {} },
  });
  check('201 private vehicle created with no documents', privateOk.status === 201, JSON.stringify(privateOk.json));
  const vehicleAId = privateOk.json?.data?.id;

  console.log('\n=== 4. Create: plate already used by ANOTHER owner\'s active vehicle -> 409 PLATE_ALREADY_REGISTERED ===');
  const crossOwnerClash = await api('/drivers/fleet/vehicles', {
    method: 'POST', token: tokenB,
    body: { vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Hyundai', model: 'Aura', number: 'MP09VC0001', color: 'Red', usage_type: 'private', documents: {} },
  });
  check('409 PLATE_ALREADY_REGISTERED (cross-owner)', crossOwnerClash.status === 409 && crossOwnerClash.json?.code === 'PLATE_ALREADY_REGISTERED', JSON.stringify(crossOwnerClash.json));

  console.log('\n=== 5. List: assignedDriver.isOnRide and documents_summary present ===');
  const createB = await api('/drivers/fleet/vehicles', { method: 'POST', token: tokenB, body: { vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Hyundai', model: 'Aura', number: 'MP09VC0002', color: 'Red', usage_type: 'private', documents: { rc: doc('rc') } } });
  check('201 owner B vehicle created', createB.status === 201, JSON.stringify(createB.json));
  const listB = await api('/drivers/fleet/vehicles', { token: tokenB });
  const vehicleB = (listB.json?.data?.results || [])[0];
  check('documents_summary is an array with entries', Array.isArray(vehicleB?.documents_summary) && vehicleB.documents_summary.length > 0, JSON.stringify(vehicleB?.documents_summary));
  check('documents_summary entries have no raw base64, just previewUrl', vehicleB.documents_summary[0]?.previewUrl?.startsWith('https://'));

  console.log('\n=== 6. Update: approved vehicle, colour-only change stays approved ===');
  await FleetVehicle.updateOne({ _id: vehicleAId }, { $set: { status: 'approved' } });
  const colourOnly = await api(`/drivers/fleet/vehicles/${vehicleAId}`, {
    method: 'PATCH', token: tokenA,
    body: { vehicleTypeId: (await FleetVehicle.findById(vehicleAId).lean()).vehicle_type_id, make: 'Maruti', model: 'Dzire', number: 'MP09VC0001', color: 'Blue', usage_type: 'private' },
  });
  check('200 updated', colourOnly.status === 200, JSON.stringify(colourOnly.json));
  check('stays approved after a colour-only change', colourOnly.json?.data?.status === 'approved', JSON.stringify(colourOnly.json));

  console.log('\n=== 7. Update: approved vehicle, plate change -> back to pending ===');
  const plateChange = await api(`/drivers/fleet/vehicles/${vehicleAId}`, {
    method: 'PATCH', token: tokenA,
    body: { vehicleTypeId: (await FleetVehicle.findById(vehicleAId).lean()).vehicle_type_id, make: 'Maruti', model: 'Dzire', number: 'MP09VC0003', color: 'Blue', usage_type: 'private' },
  });
  check('200 updated', plateChange.status === 200, JSON.stringify(plateChange.json));
  check('goes back to pending after a plate change', plateChange.json?.data?.status === 'pending', JSON.stringify(plateChange.json));

  console.log('\n=== 8. Update: switch to commercial without permit -> 400 COMMERCIAL_PERMIT_REQUIRED ===');
  const switchNoPermit = await api(`/drivers/fleet/vehicles/${vehicleAId}`, {
    method: 'PATCH', token: tokenA,
    body: { vehicleTypeId: (await FleetVehicle.findById(vehicleAId).lean()).vehicle_type_id, make: 'Maruti', model: 'Dzire', number: 'MP09VC0003', color: 'Blue', usage_type: 'commercial' },
  });
  check('400 COMMERCIAL_PERMIT_REQUIRED on update', switchNoPermit.status === 400 && switchNoPermit.json?.code === 'COMMERCIAL_PERMIT_REQUIRED', JSON.stringify(switchNoPermit.json));

  console.log('\n=== 9. Update: switch to commercial WITH permit -> pending, usage_type_verified false ===');
  const switchWithPermit = await api(`/drivers/fleet/vehicles/${vehicleAId}`, {
    method: 'PATCH', token: tokenA,
    body: {
      vehicleTypeId: (await FleetVehicle.findById(vehicleAId).lean()).vehicle_type_id,
      make: 'Maruti', model: 'Dzire', number: 'MP09VC0003', color: 'Blue', usage_type: 'commercial',
      documents: { commercial_permit: doc('permit') },
    },
  });
  check('200 switched to commercial', switchWithPermit.status === 200, JSON.stringify(switchWithPermit.json));
  check('usage_type_verified is false', switchWithPermit.json?.data?.usage_type_verified === false);
  check('status is pending', switchWithPermit.json?.data?.status === 'pending');

  console.log('\n=== 10. Assign vehicle to a driver, then verify sync + on-trip guards ===');
  const driverRes = await api('/drivers/fleet/drivers', {
    method: 'POST', token: tokenA,
    body: {
      name: 'Assigned Test Driver',
      phone: '9222299901',
      assignedFleetVehicleId: vehicleAId,
      // The shared test DB may already have fleet-driver document templates
      // seeded by scripts/smoke_fleet_driver_crud.mjs — supply the usual set
      // so this doesn't fail on documents unrelated to what this test covers.
      documents: {
        drivingLicense: doc('dl'),
        aadhaarFront: doc('aadhaar-f'),
        aadhaarBack: doc('aadhaar-b'),
        panCard: doc('pan'),
      },
    },
  });
  check('201 fleet driver created and assigned', driverRes.status === 201, JSON.stringify(driverRes.json));
  const assignedDriverId = driverRes.json?.data?.id;

  const editAssigned = await api(`/drivers/fleet/vehicles/${vehicleAId}`, {
    method: 'PATCH', token: tokenA,
    body: { vehicleTypeId: (await FleetVehicle.findById(vehicleAId).lean()).vehicle_type_id, make: 'Maruti', model: 'Swift', number: 'MP09VC0003', color: 'Green', usage_type: 'commercial', documents: { commercial_permit: doc('permit') } },
  });
  check('200 edited while assigned (not on trip)', editAssigned.status === 200, JSON.stringify(editAssigned.json));
  const syncedDriver = await Driver.findById(assignedDriverId).lean();
  check('assigned driver\'s vehicleModel synced', syncedDriver.vehicleModel === 'Swift', JSON.stringify({ vehicleModel: syncedDriver.vehicleModel }));
  check('assigned driver\'s vehicleColor synced', syncedDriver.vehicleColor === 'Green');

  await Driver.updateOne({ _id: assignedDriverId }, { $set: { isOnRide: true } });
  const editOnTrip = await api(`/drivers/fleet/vehicles/${vehicleAId}`, {
    method: 'PATCH', token: tokenA,
    body: { vehicleTypeId: (await FleetVehicle.findById(vehicleAId).lean()).vehicle_type_id, make: 'Maruti', model: 'Swift', number: 'MP09VC0003', color: 'Yellow', usage_type: 'commercial', documents: {} },
  });
  check('409 VEHICLE_ON_TRIP on edit while assigned driver is on a trip', editOnTrip.status === 409 && editOnTrip.json?.code === 'VEHICLE_ON_TRIP', JSON.stringify(editOnTrip.json));

  console.log('\n=== 11. Delete: invalid id -> 400 (not 500) ===');
  const deleteBadId = await api('/drivers/fleet/vehicles/not-a-real-id', { method: 'DELETE', token: tokenA });
  check('400 on malformed delete id', deleteBadId.status === 400, JSON.stringify(deleteBadId.json));

  console.log('\n=== 12. Delete: assigned vehicle (driver on trip) -> 409 VEHICLE_ASSIGNED with driver details ===');
  const deleteAssigned = await api(`/drivers/fleet/vehicles/${vehicleAId}`, { method: 'DELETE', token: tokenA });
  check(
    '409 VEHICLE_ASSIGNED with driver_id/driver_name',
    deleteAssigned.status === 409 && deleteAssigned.json?.code === 'VEHICLE_ASSIGNED' && deleteAssigned.json?.details?.driver_id === assignedDriverId,
    JSON.stringify(deleteAssigned.json),
  );

  await Driver.updateOne({ _id: assignedDriverId }, { $set: { isOnRide: false } });
  await api(`/drivers/fleet/drivers/${assignedDriverId}`, { method: 'DELETE', token: tokenA });

  console.log('\n=== 13. Delete: free vehicle -> succeeds; same plate can now be re-added ===');
  const deleteFree = await api(`/drivers/fleet/vehicles/${vehicleAId}`, { method: 'DELETE', token: tokenA });
  check('200 deleted', deleteFree.status === 200, JSON.stringify(deleteFree.json));
  const readdSamePlate = await api('/drivers/fleet/vehicles', {
    method: 'POST', token: tokenA,
    body: { vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Maruti', model: 'Swift', number: 'MP09VC0003', color: 'Green', usage_type: 'private', documents: {} },
  });
  check('201 same plate re-added after hard delete', readdSamePlate.status === 201, JSON.stringify(readdSamePlate.json));

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
