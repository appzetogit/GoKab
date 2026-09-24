/**
 * Smoke test for the "one Taxi service" change request (backend spec,
 * 2026-09-24): registration forces taxi regardless of input, every taxi tier
 * gets city+outstation (never parcel/carpool), the public vehicle catalog can
 * be filtered, and deleting a referenced vehicle type deactivates it instead.
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_taxi_only_platform.mjs
 */

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

const loginAdmin = async () =>
  (await api('/admin/login', { method: 'POST', body: { email: 'admin@gmail.com', password: 'password' } })).json?.data?.token;

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { DriverRegistrationSession } = await import('../src/modules/taxi/driver/models/DriverRegistrationSession.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  await import('../src/modules/taxi/admin/models/RideModule.js'); // registers the schema for .populate('ride_module_ids')
  const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
  const onboardingService = await import('../src/modules/taxi/driver/services/onboardingService.js');
  const matchingService = await import('../src/modules/taxi/services/matchingService.js');

  console.log('=== 1. Registration forces taxi, regardless of input ===');

  const makeSession = async (registrationId, role) => {
    await DriverRegistrationSession.deleteOne({ registrationId });
    return DriverRegistrationSession.create({
      registrationId,
      phone: `90000000${registrationId.slice(-2)}`,
      role,
      status: 'personal_saved',
      otpHash: 'x',
      otpExpiresAt: new Date(Date.now() + 3600_000),
      personal: { fullName: 'Test Person' },
      expiresAt: new Date(Date.now() + 3600_000),
    });
  };

  await makeSession('taxi-only-1', 'driver');
  const driverVehicle = await onboardingService.saveDriverVehicle({
    registrationId: 'taxi-only-1',
    phone: '9000000001',
    serviceCategories: ['delivery', 'pooling'],
    registerFor: 'pooling',
    locationId: String(new mongoose.Types.ObjectId()),
    locationName: 'Indore',
    serviceLocation: { _id: new mongoose.Types.ObjectId(), name: 'Indore' },
    vehicleTypeId: new mongoose.Types.ObjectId(),
    make: 'Maruti',
    model: 'Alto',
    year: '2022',
    number: 'MP09AB1234',
    color: 'White',
  });
  check(
    'A driver session gets taxi, never what it sent',
    driverVehicle.vehicle.registerFor === 'taxi' && JSON.stringify(driverVehicle.vehicle.serviceCategories) === JSON.stringify(['taxi']),
    JSON.stringify({ registerFor: driverVehicle.vehicle.registerFor, serviceCategories: driverVehicle.vehicle.serviceCategories }),
  );

  await makeSession('taxi-only-2', 'driver');
  const driverVehicleNoInput = await onboardingService.saveDriverVehicle({
    registrationId: 'taxi-only-2',
    phone: '9000000002',
    locationId: String(new mongoose.Types.ObjectId()),
    locationName: 'Indore',
    serviceLocation: { _id: new mongoose.Types.ObjectId(), name: 'Indore' },
    vehicleTypeId: new mongoose.Types.ObjectId(),
    make: 'Maruti',
    model: 'Alto',
    year: '2022',
    number: 'MP09AB5678',
    color: 'White',
  });
  check(
    'Sending nothing also lands on taxi (never 400, never both)',
    driverVehicleNoInput.vehicle.registerFor === 'taxi' && driverVehicleNoInput.vehicle.serviceCategories.length === 1 && driverVehicleNoInput.vehicle.serviceCategories[0] === 'taxi',
    JSON.stringify({ registerFor: driverVehicleNoInput.vehicle.registerFor, serviceCategories: driverVehicleNoInput.vehicle.serviceCategories }),
  );

  await makeSession('taxi-only-owner-1', 'vendor');
  const ownerVehicle = await onboardingService.saveDriverVehicle({
    registrationId: 'taxi-only-owner-1',
    phone: '9000000003',
    serviceCategories: ['taxi', 'outstation'],
    registerFor: 'both',
    companyName: 'Test Fleet Co',
    companyAddress: '123 Main St',
    city: 'Indore',
    postalCode: '452001',
    locationId: String(new mongoose.Types.ObjectId()),
    locationName: 'Indore',
    serviceLocation: { _id: new mongoose.Types.ObjectId(), name: 'Indore' },
    vehicles: [{ vehicleTypeId: new mongoose.Types.ObjectId() }],
  });
  check(
    "Owner/vendor onboarding is untouched — still gets 'both'",
    ownerVehicle.vehicle.registerFor === 'both',
    JSON.stringify({ registerFor: ownerVehicle.vehicle.registerFor, serviceCategories: ownerVehicle.vehicle.serviceCategories }),
  );

  console.log('\n=== 2. Every taxi tier gets city+outstation, never parcel/carpool ===');
  const taxiTiers = await SubscriptionTier.find({ driver_category: { $in: ['lower', 'middle', 'prime'] } })
    .populate('ride_module_ids')
    .select('name ride_module_ids')
    .lean();
  check('At least the three driver-network tiers exist', taxiTiers.length >= 3, String(taxiTiers.length));
  for (const tier of taxiTiers) {
    const codes = (tier.ride_module_ids || []).map((m) => m.code);
    check(
      `${tier.name}: has city + outstation, no parcel/carpool`,
      codes.includes('city') && codes.includes('outstation') && !codes.includes('parcel') && !codes.includes('carpool'),
      codes.join(', '),
    );
  }

  console.log('\n=== 3. Matching actually offers intercity rides now ===');
  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  // Give Ramesh a subscription-free "Lower" tier context by ensuring he has no
  // active override; matchDrivers resolves his effective tier itself.
  const cityMatches = (await matchingService.matchDrivers(INDORE, {
    vehicleTypeIds: [ramesh.vehicleTypeId].filter(Boolean),
    serviceLocationId: ramesh.service_location_id,
    maxDistance: 50000,
    rideModuleCode: 'city',
  })).drivers;
  const outstationMatches = (await matchingService.matchDrivers(INDORE, {
    vehicleTypeIds: [ramesh.vehicleTypeId].filter(Boolean),
    serviceLocationId: ramesh.service_location_id,
    maxDistance: 50000,
    rideModuleCode: 'outstation',
  })).drivers;
  const parcelMatches = (await matchingService.matchDrivers(INDORE, {
    vehicleTypeIds: [ramesh.vehicleTypeId].filter(Boolean),
    serviceLocationId: ramesh.service_location_id,
    maxDistance: 50000,
    rideModuleCode: 'parcel',
  })).drivers;
  const includesRamesh = (list) => list.some((d) => String(d._id) === String(ramesh._id));
  check('A taxi driver is offered a city ride', includesRamesh(cityMatches));
  check('The same driver is now offered an intercity (outstation) ride', includesRamesh(outstationMatches));
  check('The same driver is never offered a parcel request', !includesRamesh(parcelMatches));

  console.log('\n=== 4. Public vehicle catalog can be filtered ===');
  await Vehicle.deleteMany({ name: { $in: ['Smoke Taxi Van', 'Smoke Delivery Bike'] } });
  const taxiVehicle = await Vehicle.create({
    name: 'Smoke Taxi Van',
    transport_type: 'taxi',
    dispatch_type: 'normal',
    icon_types: 'car',
    capacity: 4,
    active: true,
    status: 1,
  });
  await Vehicle.create({
    name: 'Smoke Delivery Bike',
    transport_type: 'delivery',
    dispatch_type: 'normal',
    icon_types: 'bike',
    capacity: 1,
    active: true,
    status: 1,
  });
  const unfiltered = await api('/users/vehicle-types');
  const filtered = await api('/users/vehicle-types?transport_type=taxi&active=true');
  const unfilteredNames = new Set((unfiltered.json?.data?.results || []).map((v) => v.name));
  const filteredNames = new Set((filtered.json?.data?.results || []).map((v) => v.name));
  check('Unfiltered catalog still includes the delivery vehicle', unfilteredNames.has('Smoke Delivery Bike'));
  check('Filtered catalog excludes the delivery vehicle', !filteredNames.has('Smoke Delivery Bike'));
  check('Filtered catalog still includes the taxi vehicle', filteredNames.has('Smoke Taxi Van'));

  console.log('\n=== 5. Deleting a referenced vehicle type deactivates it ===');
  const adminToken = await loginAdmin();
  await Driver.updateOne({ _id: ramesh._id }, { $set: { vehicleTypeId: taxiVehicle._id } });
  const deleteResult = await api(`/admin/types/vehicle-types/${taxiVehicle._id}`, { method: 'DELETE', token: adminToken });
  check('Delete call succeeds', deleteResult.status === 200, JSON.stringify(deleteResult.json));
  check('...but reports deactivation, not deletion', deleteResult.json?.data?.deactivated === true, JSON.stringify(deleteResult.json));
  const stillThere = await Vehicle.findById(taxiVehicle._id).lean();
  check('The vehicle type document still exists', Boolean(stillThere));
  check('...and is now inactive', stillThere?.active === false, JSON.stringify({ active: stillThere?.active, status: stillThere?.status }));

  // Restore Ramesh's original vehicle type reference and clean up.
  await Driver.updateOne({ _id: ramesh._id }, { $set: { vehicleTypeId: ramesh.vehicleTypeId } });
  await Vehicle.deleteMany({ name: { $in: ['Smoke Taxi Van', 'Smoke Delivery Bike'] } });
  await DriverRegistrationSession.deleteMany({ registrationId: { $in: ['taxi-only-1', 'taxi-only-2', 'taxi-only-owner-1'] } });
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
