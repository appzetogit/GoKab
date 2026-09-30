/**
 * Smoke test for the Fleet Drivers CRUD spec (backend spec, 2026-09-27):
 * email/salary/zone dropped from the API, org auto-created on first fleet
 * driver, vehicle required, admin-template document validation, re-attach of
 * a previously removed driver's phone, on-trip vehicle-change guard,
 * re-approval reset on phone/document change, and the delete-assigned-
 * vehicle guard.
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_fleet_driver_crud.mjs
 */

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4055/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27031/gokab_fleet_test?replicaSet=rs0';

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
const rcDoc = (plate) => ({ secureUrl: `https://example.com/rc-${plate}.jpg`, identifyNumber: plate, expiryDate: '2030-01-01' });
const requiredDocs = () => ({
  drivingLicense: doc('dl'),
  aadhaarFront: doc('aadhaar-f'),
  aadhaarBack: doc('aadhaar-b'),
  panCard: doc('pan'),
});

const run = async () => {
  await mongoose.connect(DB_URI);
  const bcrypt = (await import('bcryptjs')).default;
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { Owner } = await import('../src/modules/taxi/admin/models/Owner.js');
  const { ServiceLocation } = await import('../src/modules/taxi/admin/models/ServiceLocation.js');
  const { DriverNeededDocument } = await import('../src/modules/taxi/admin/models/DriverNeededDocument.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');

  // --- Fixtures: a service location, fleet-driver document templates, and a
  // Prime driver (can_manage_fleet) plus a Lower driver (cannot) acting as
  // their own fleet owner. `account_type: 'fleet_drivers'` (not 'both') keeps
  // these templates from also becoming required at ordinary individual
  // registration in a shared test database.
  let serviceLocation = await ServiceLocation.findOne({ service_location_name: 'Indore' });
  if (!serviceLocation) {
    serviceLocation = await ServiceLocation.create({
      name: 'Indore',
      service_location_name: 'Indore',
      country: 'India',
      latitude: 22.7196,
      longitude: 75.8577,
      status: 'active',
      active: true,
    });
  }

  const requiredTemplates = [
    { name: 'Driving Licence (Fleet Smoke)', slug: 'driving-licence-fleet-smoke', key: 'drivingLicense', image_type: 'image' },
    { name: 'Aadhaar Card (Fleet Smoke)', slug: 'aadhaar-card-fleet-smoke', front_key: 'aadhaarFront', back_key: 'aadhaarBack', image_type: 'front_back' },
    { name: 'PAN Card (Fleet Smoke)', slug: 'pan-card-fleet-smoke', key: 'panCard', image_type: 'image' },
  ];
  for (const template of requiredTemplates) {
    await DriverNeededDocument.findOneAndUpdate(
      { slug: template.slug },
      {
        template_type: 'document',
        name: template.name,
        slug: template.slug,
        account_type: 'fleet_drivers',
        applies_to: 'driver',
        image_type: template.image_type,
        key: template.key || '',
        front_key: template.front_key || '',
        back_key: template.back_key || '',
        is_required: true,
        is_editable: true,
        active: true,
      },
      { upsert: true },
    );
  }

  const passwordHash = await bcrypt.hash('password', 10);
  const primeTier = await SubscriptionTier.findOne({ driver_category: 'prime' });
  if (!primeTier) {
    throw new Error('No Prime tier found — run scripts/seed_driver_network_tiers.js first');
  }

  let primeDriver = await Driver.findOne({ phone: '9111100001' });
  if (!primeDriver) {
    primeDriver = await Driver.create({
      name: 'Fleet Smoke Prime Owner',
      phone: '9111100001',
      password: passwordHash,
      vehicleType: 'car',
      service_location_id: serviceLocation._id,
      city: 'Indore',
      approve: true,
      status: 'approved',
      registerFor: 'taxi',
      location: { type: 'Point', coordinates: [75.8577, 22.7196] },
    });
  }

  await DriverSubscription.deleteMany({ driver_id: primeDriver._id });
  await DriverSubscription.create({
    driver_id: primeDriver._id,
    tier_id: primeTier._id,
    billing_cycle: 'monthly',
    status: 'active',
    start_date: new Date(),
    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  let lowerDriver = await Driver.findOne({ phone: '9111100002' });
  if (!lowerDriver) {
    lowerDriver = await Driver.create({
      name: 'Fleet Smoke Lower Driver',
      phone: '9111100002',
      password: passwordHash,
      vehicleType: 'car',
      service_location_id: serviceLocation._id,
      city: 'Indore',
      approve: true,
      status: 'approved',
      registerFor: 'taxi',
      location: { type: 'Point', coordinates: [75.8577, 22.7196] },
    });
  }

  // Fresh per-run state for this fixture's own organisation. A previous run's
  // vehicles are simply orphaned under a now-deleted Owner _id — harmless,
  // since every query below is scoped to the freshly (re)created owner.
  await Owner.deleteOne({ mobile: primeDriver.phone });
  await Driver.updateOne({ _id: primeDriver._id }, { $set: { owner_id: null, is_self_drive_owner: false } });
  await Driver.deleteMany({ phone: { $in: ['9111199901', '9111199902', '9111199903'] } });

  const primeToken = await login('9111100001');
  const lowerToken = await login('9111100002');
  check('Prime driver logs in', Boolean(primeToken));
  check('Lower driver logs in', Boolean(lowerToken));

  console.log('\n=== 1. Create: no vehicle yet -> organisation auto-created on first fleet driver ===');
  const vehicleRes = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: primeToken,
    body: {
      vehicleTypeId: new mongoose.Types.ObjectId(),
      make: 'Maruti',
      model: 'Dzire',
      number: 'MP09AB1111',
      color: 'White',
      usage_type: 'commercial',
      documents: { commercial_permit: doc('permit'), rc: rcDoc('MP09AB1111') },
    },
  });
  check('Vehicle created (201)', vehicleRes.status === 201, JSON.stringify(vehicleRes.json));
  const vehicleId = vehicleRes.json?.data?.id;

  console.log('\n=== 2. Create fleet driver: missing vehicle -> 400 VEHICLE_REQUIRED ===');
  const noVehicle = await api('/drivers/fleet/drivers', {
    method: 'POST',
    token: primeToken,
    body: { name: 'Ramesh', phone: '9111199901', documents: requiredDocs() },
  });
  check('400 VEHICLE_REQUIRED', noVehicle.status === 400 && noVehicle.json?.code === 'VEHICLE_REQUIRED', JSON.stringify(noVehicle.json));

  console.log('\n=== 3. Create fleet driver: missing a required document -> 400 DOCUMENTS_REQUIRED, nothing created ===');
  const missingDocs = await api('/drivers/fleet/drivers', {
    method: 'POST',
    token: primeToken,
    body: { name: 'Ramesh', phone: '9111199901', assignedFleetVehicleId: vehicleId, documents: { drivingLicense: doc('dl') } },
  });
  check(
    '400 DOCUMENTS_REQUIRED',
    missingDocs.status === 400 && missingDocs.json?.code === 'DOCUMENTS_REQUIRED',
    JSON.stringify(missingDocs.json),
  );
  const notCreated = await Driver.findOne({ phone: '9111199901' }).lean();
  check('Nothing was created', !notCreated);

  console.log('\n=== 4. Create fleet driver: full payload -> 201, org exists, extra fields ignored ===');
  const created = await api('/drivers/fleet/drivers', {
    method: 'POST',
    token: primeToken,
    body: {
      name: 'Ramesh Kumar',
      phone: '9111199901',
      email: 'ramesh@example.com',
      salary: 15000,
      zoneId: '000000000000000000000000',
      city: 'ShouldBeIgnored',
      assignedFleetVehicleId: vehicleId,
      documents: requiredDocs(),
    },
  });
  check('201 created', created.status === 201, JSON.stringify(created.json));
  const rameshId = created.json?.data?.id;
  const rameshDoc = await Driver.findById(rameshId).lean();
  check('email not saved', !rameshDoc?.email);
  check('salary not saved (0/undefined)', !rameshDoc?.salary);
  check('city derived, not the ignored body value', rameshDoc?.city !== 'ShouldBeIgnored');
  check('vehicle assigned', String(rameshDoc?.assignedFleetVehicleId) === String(vehicleId));
  check('status pending, not approved', rameshDoc?.status === 'pending' && rameshDoc?.approve === false);
  const ownerAfterCreate = await Owner.findOne({ mobile: primeDriver.phone }).lean();
  check('organisation now exists', Boolean(ownerAfterCreate));

  console.log('\n=== 5. Create: vehicle already assigned to another driver -> 409 ===');
  const dupVehicle = await api('/drivers/fleet/drivers', {
    method: 'POST',
    token: primeToken,
    body: { name: 'Suresh', phone: '9111199902', assignedFleetVehicleId: vehicleId, documents: requiredDocs() },
  });
  check('409 vehicle already assigned', dupVehicle.status === 409, JSON.stringify(dupVehicle.json));

  console.log('\n=== 6. Create: rejected vehicle -> 409 VEHICLE_REJECTED ===');
  const rejectedVehicle = await FleetVehicle.create({
    owner_id: ownerAfterCreate._id,
    service_location_id: ownerAfterCreate.service_location_id,
    transport_type: 'taxi',
    car_brand: 'Tata',
    car_model: 'Tigor',
    license_plate_number: 'MP09CD2222',
    car_color: 'Black',
    usage_type: 'private',
    status: 'rejected',
    active: true,
  });
  const rejected = await api('/drivers/fleet/drivers', {
    method: 'POST',
    token: primeToken,
    body: { name: 'Suresh', phone: '9111199902', assignedFleetVehicleId: String(rejectedVehicle._id), documents: requiredDocs() },
  });
  check('409 VEHICLE_REJECTED', rejected.status === 409 && rejected.json?.code === 'VEHICLE_REJECTED', JSON.stringify(rejected.json));

  console.log('\n=== 7. Create: phone of a self-registered driver -> 409 PHONE_ALREADY_REGISTERED ===');
  const secondVehicle = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: primeToken,
    body: { vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Hyundai', model: 'Aura', number: 'MP09EF3333', color: 'Red', usage_type: 'private', documents: { rc: rcDoc('MP09EF3333') } },
  });
  const secondVehicleId = secondVehicle.json?.data?.id;
  const conflictPhone = await api('/drivers/fleet/drivers', {
    method: 'POST',
    token: primeToken,
    body: { name: 'Someone', phone: lowerDriver.phone, assignedFleetVehicleId: secondVehicleId, documents: requiredDocs() },
  });
  check(
    '409 PHONE_ALREADY_REGISTERED',
    conflictPhone.status === 409 && conflictPhone.json?.code === 'PHONE_ALREADY_REGISTERED',
    JSON.stringify(conflictPhone.json),
  );

  console.log('\n=== 8. Lower-tier driver cannot add a fleet driver -> 403 CATEGORY_NOT_ALLOWED ===');
  const lowerVehicle = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: lowerToken,
    body: { vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Maruti', model: 'Alto', number: 'MP09GH4444', color: 'Grey', usage_type: 'private', documents: { rc: rcDoc('MP09GH4444') } },
  });
  const lowerVehicleId = lowerVehicle.json?.data?.id;
  const notAllowed = await api('/drivers/fleet/drivers', {
    method: 'POST',
    token: lowerToken,
    body: { name: 'X', phone: '9111199903', assignedFleetVehicleId: lowerVehicleId, documents: requiredDocs() },
  });
  check(
    '403 CATEGORY_NOT_ALLOWED',
    notAllowed.status === 403 && notAllowed.json?.code === 'CATEGORY_NOT_ALLOWED',
    JSON.stringify(notAllowed.json),
  );

  console.log('\n=== 9. List: excludes the requester, no email/salary/zone keys, documents have status ===');
  const list = await api('/drivers/fleet/drivers', { token: primeToken });
  const results = list.json?.data?.results || [];
  check('List does not include the requester (prime owner)', !results.some((r) => r.id === String(primeDriver._id)));
  check('List includes Ramesh', results.some((r) => r.id === rameshId));
  const rameshListItem = results.find((r) => r.id === rameshId);
  check('No email key on list item', !Object.prototype.hasOwnProperty.call(rameshListItem || {}, 'email'));
  check('No salary key on list item', !Object.prototype.hasOwnProperty.call(rameshListItem || {}, 'salary'));
  check('No zoneId key on list item', !Object.prototype.hasOwnProperty.call(rameshListItem || {}, 'zoneId'));
  check(
    'documents carry uploaded/status/previewUrl',
    Boolean(rameshListItem?.documents?.drivingLicense?.status),
    JSON.stringify(rameshListItem?.documents),
  );

  console.log('\n=== 10. Update: reassign to a free vehicle -> old vehicle frees up ===');
  const reassign = await api(`/drivers/fleet/drivers/${rameshId}`, {
    method: 'PATCH',
    token: primeToken,
    body: { assignedFleetVehicleId: secondVehicleId },
  });
  check('200 reassigned', reassign.status === 200, JSON.stringify(reassign.json));
  const vehiclesAfterReassign = await api('/drivers/fleet/vehicles', { token: primeToken });
  const oldVehicle = (vehiclesAfterReassign.json?.data?.results || []).find((v) => v.id === vehicleId);
  check('Old vehicle now unassigned', !oldVehicle?.assignedDriver);

  console.log('\n=== 11. Update: clear the vehicle -> 400 VEHICLE_REQUIRED ===');
  const clearVehicle = await api(`/drivers/fleet/drivers/${rameshId}`, {
    method: 'PATCH',
    token: primeToken,
    body: { assignedFleetVehicleId: null },
  });
  check('400 VEHICLE_REQUIRED on clear', clearVehicle.status === 400 && clearVehicle.json?.code === 'VEHICLE_REQUIRED');

  console.log('\n=== 12. Update: vehicle change while on a trip -> 409 DRIVER_ON_TRIP ===');
  await Driver.updateOne({ _id: rameshId }, { $set: { isOnRide: true } });
  const onTrip = await api(`/drivers/fleet/drivers/${rameshId}`, {
    method: 'PATCH',
    token: primeToken,
    body: { assignedFleetVehicleId: vehicleId },
  });
  check('409 DRIVER_ON_TRIP', onTrip.status === 409 && onTrip.json?.code === 'DRIVER_ON_TRIP', JSON.stringify(onTrip.json));
  await Driver.updateOne({ _id: rameshId }, { $set: { isOnRide: false } });

  console.log('\n=== 13. Update: re-upload a document on an approved driver -> back to pending ===');
  await Driver.updateOne({ _id: rameshId }, { $set: { approve: true, status: 'approved' } });
  const reupload = await api(`/drivers/fleet/drivers/${rameshId}`, {
    method: 'PATCH',
    token: primeToken,
    body: { documents: { panCard: doc('pan-v2') } },
  });
  check('200 re-upload accepted', reupload.status === 200, JSON.stringify(reupload.json));
  check('Driver sent back to pending', reupload.json?.data?.status === 'pending' && reupload.json?.data?.approve === false);
  const mergedDocs = (await Driver.findById(rameshId).lean())?.documents || {};
  check('Other documents kept after merge', Boolean(mergedDocs.drivingLicense));

  console.log('\n=== 14. Update: vehicle-only change on an approved driver -> stays approved ===');
  await Driver.updateOne({ _id: rameshId }, { $set: { approve: true, status: 'approved' } });
  const vehicleOnlyChange = await api(`/drivers/fleet/drivers/${rameshId}`, {
    method: 'PATCH',
    token: primeToken,
    body: { assignedFleetVehicleId: vehicleId },
  });
  check(
    'Stays approved after a vehicle-only change',
    vehicleOnlyChange.json?.data?.approve === true && vehicleOnlyChange.json?.data?.status === 'approved',
    JSON.stringify(vehicleOnlyChange.json),
  );

  console.log('\n=== 15. Delete: a vehicle assigned to a driver -> 409 VEHICLE_ASSIGNED ===');
  const deleteAssigned = await api(`/drivers/fleet/vehicles/${vehicleId}`, { method: 'DELETE', token: primeToken });
  check(
    '409 VEHICLE_ASSIGNED',
    deleteAssigned.status === 409 && deleteAssigned.json?.code === 'VEHICLE_ASSIGNED',
    JSON.stringify(deleteAssigned.json),
  );

  console.log('\n=== 16. Remove: detach from fleet -> inactive, vehicle freed ===');
  const remove = await api(`/drivers/fleet/drivers/${rameshId}`, { method: 'DELETE', token: primeToken });
  check('200 removed', remove.status === 200, JSON.stringify(remove.json));
  const removedDoc = await Driver.findById(rameshId).lean();
  check('owner_id cleared', removedDoc?.owner_id === null);
  check('status inactive', removedDoc?.status === 'inactive');
  check('vehicle denorm fields cleared', !removedDoc?.vehicleNumber && !removedDoc?.vehicleMake);

  console.log('\n=== 17. Re-add the same phone -> re-attached (same _id), not a new record ===');
  const reattach = await api('/drivers/fleet/drivers', {
    method: 'POST',
    token: primeToken,
    body: { name: 'Ramesh Again', phone: '9111199901', assignedFleetVehicleId: vehicleId, documents: requiredDocs() },
  });
  check('201 re-attached', reattach.status === 201, JSON.stringify(reattach.json));
  check('Same _id reused', reattach.json?.data?.id === rameshId);
  const totalWithThisPhone = await Driver.countDocuments({ phone: '9111199901' });
  check('Exactly one Driver record for this phone', totalWithThisPhone === 1);

  console.log('\n=== 18. Remove while on a trip -> 409 ===');
  await Driver.updateOne({ _id: rameshId }, { $set: { isOnRide: true } });
  const removeOnTrip = await api(`/drivers/fleet/drivers/${rameshId}`, { method: 'DELETE', token: primeToken });
  check('409 remove-on-trip', removeOnTrip.status === 409, JSON.stringify(removeOnTrip.json));
  await Driver.updateOne({ _id: rameshId }, { $set: { isOnRide: false } });

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
