/**
 * Smoke test for "Fleet Vehicle Document Number / Expiry (Edit Flow)"
 * (backend spec, 2026-10-01):
 *
 *  Gap 1: PATCH /drivers/fleet/vehicles/:vehicleId now runs the same
 *         DOCUMENTS_REQUIRED / DOCUMENT_DETAILS_REQUIRED checks addOwnerVehicle
 *         already runs, scoped to the usage type *after* the edit.
 *  Gap 2: a number/expiry-only edit (no new photo) on a document that already
 *         has a photo on file is accepted and merged in, instead of being
 *         silently dropped. It counts as a material change (re-verification).
 *  Gap 3: admin can no longer approve a vehicle whose required document has a
 *         photo but no number/expiry.
 *  Gap 4: an invalid or already-past expiry date is refused on both add and
 *         edit, and a valid one gets a normalised `expiresAt` stamped on it.
 *
 * Requires scripts/seed_rc_document_template.js to have been run against the
 * same database first (RC must be `is_required: true`).
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_fleet_vehicle_document_edit.mjs
 */

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4099/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27035/gokab_ride_test?replicaSet=rs0';

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
const loginAdmin = async () =>
  (await api('/admin/login', { method: 'POST', body: { email: 'admin@gmail.com', password: 'password' } })).json?.data?.token;

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { DriverNeededDocument } = await import('../src/modules/taxi/admin/models/DriverNeededDocument.js');

  const rcTemplate = await DriverNeededDocument.findOne({ slug: 'registration-certificate' }).lean();
  check('RC template is seeded and required', rcTemplate?.is_required === true, 'run scripts/seed_rc_document_template.js first (RC_REQUIRED=true)');

  // A throwaway required-for-commercial-only template, isolated from the
  // real commercial_permit key (which is checked separately and would
  // otherwise mask Gap 1's own check).
  await DriverNeededDocument.deleteMany({ slug: 'smoke-test-commercial-doc' });
  await DriverNeededDocument.create({
    template_type: 'document',
    name: 'Smoke Test Commercial Doc',
    slug: 'smoke-test-commercial-doc',
    key: 'smoke_test_commercial_doc',
    account_type: 'both',
    applies_to: 'vehicle',
    applies_when_usage_type: 'commercial',
    image_type: 'image',
    has_identify_number: false,
    has_expiry_date: false,
    is_required: true,
    is_editable: true,
    active: true,
    sort_order: 90,
  });

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const rameshToken = await login('9000000001');
  const adminToken = await loginAdmin();

  // Prime has no vehicle-count cap (Lower is capped at 2) — this test adds
  // several fixture vehicles and isn't exercising the vehicle-limit rule.
  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, {
    method: 'PATCH', token: adminToken, body: { category: 'prime' },
  });

  await FleetVehicle.deleteMany({ license_plate_number: { $in: ['MP09DT0001', 'MP09DT0002', 'MP09DT0003', 'MP09DT0004', 'MP09DT0099'] } });

  const makeVehicle = (overrides = {}) =>
    FleetVehicle.create({
      owner_id: ramesh.owner_id,
      service_location_id: ramesh.service_location_id,
      transport_type: 'taxi',
      car_brand: 'Tata',
      car_model: 'Nexon',
      car_color: 'White',
      usage_type: 'private',
      status: 'pending',
      active: true,
      documents: {},
      ...overrides,
    });

  // Kept identical across every PATCH on vehicle A below (and set as its
  // *initial* vehicle_type_id) — a changing id would itself count as a
  // material change and defeat the "colour only" test, since the controller
  // compares it against whatever was saved by the previous request.
  const vehicleATypeId = new mongoose.Types.ObjectId();

  console.log('\n=== Setup: vehicle A — RC photo on file, no number/expiry (pre-dates the rule), approved ===');
  const vehicleA = await makeVehicle({
    license_plate_number: 'MP09DT0001',
    status: 'approved',
    vehicle_type_id: vehicleATypeId,
    documents: { rc: { secureUrl: 'https://example.test/old-rc.jpg', uploaded: true } },
  });

  console.log('\n=== 1. PATCH with a new RC photo and no number -> 400 DOCUMENT_DETAILS_REQUIRED, nothing uploaded ===');
  const newPhotoNoNumber = await api(`/drivers/fleet/vehicles/${vehicleA._id}`, {
    method: 'PATCH', token: rameshToken,
    body: {
      vehicleTypeId: vehicleATypeId, make: 'Tata', model: 'Nexon', number: 'MP09DT0001', color: 'White',
      documents: { rc: { secureUrl: 'https://example.test/new-rc.jpg' } },
    },
  });
  check('400 DOCUMENT_DETAILS_REQUIRED', newPhotoNoNumber.status === 400 && newPhotoNoNumber.json?.code === 'DOCUMENT_DETAILS_REQUIRED', JSON.stringify(newPhotoNoNumber.json));
  const afterTest1 = await FleetVehicle.findById(vehicleA._id).lean();
  check('RC photo unchanged (nothing uploaded)', afterTest1.documents?.rc?.secureUrl === 'https://example.test/old-rc.jpg');
  check('Status still approved', afterTest1.status === 'approved');

  console.log('\n=== 2. PATCH changing only colour -> 200 (old RC without a number does not block an unrelated edit) ===');
  const colourOnly = await api(`/drivers/fleet/vehicles/${vehicleA._id}`, {
    method: 'PATCH', token: rameshToken,
    body: { vehicleTypeId: vehicleATypeId, make: 'Tata', model: 'Nexon', number: 'MP09DT0001', color: 'Red' },
  });
  check('200 OK', colourOnly.status === 200, JSON.stringify(colourOnly.json));
  check('Colour updated', colourOnly.json?.data?.car_color === 'Red');
  check('Status still approved (colour is cosmetic)', colourOnly.json?.data?.status === 'approved');

  console.log('\n=== 4. PATCH { documents: { rc: { identifyNumber, expiryDate } } } with no photo ===');
  const beforeTest4 = await FleetVehicle.findById(vehicleA._id).lean();
  const numberOnly = await api(`/drivers/fleet/vehicles/${vehicleA._id}`, {
    method: 'PATCH', token: rameshToken,
    body: {
      vehicleTypeId: vehicleATypeId, make: 'Tata', model: 'Nexon', number: 'MP09DT0001', color: 'Red',
      documents: { rc: { identifyNumber: 'MP09DT0001', expiryDate: '12 Mar 2031' } },
    },
  });
  check('200 OK', numberOnly.status === 200, JSON.stringify(numberOnly.json));
  check('RC photo unchanged', numberOnly.json?.data?.documents?.rc?.secureUrl === beforeTest4.documents?.rc?.secureUrl);
  check('RC number saved', numberOnly.json?.data?.documents?.rc?.identifyNumber === 'MP09DT0001');
  check('RC expiry saved', numberOnly.json?.data?.documents?.rc?.expiryDate === '12 Mar 2031');
  check('RC expiresAt stamped (Gap 4)', Boolean(numberOnly.json?.data?.documents?.rc?.expiresAt));
  check('Approved vehicle went back to pending (material change)', numberOnly.json?.data?.status === 'pending');

  console.log('\n=== 5. Same body for a vehicle with no rc key stored yet -> 400 DOCUMENTS_REQUIRED ===');
  const vehicleB = await makeVehicle({ license_plate_number: 'MP09DT0002', documents: {} });
  const noExistingDoc = await api(`/drivers/fleet/vehicles/${vehicleB._id}`, {
    method: 'PATCH', token: rameshToken,
    body: {
      vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Tata', model: 'Nexon', number: 'MP09DT0002', color: 'Blue',
      documents: { rc: { identifyNumber: 'MP09DT0002' } },
    },
  });
  check('400 DOCUMENTS_REQUIRED', noExistingDoc.status === 400 && noExistingDoc.json?.code === 'DOCUMENTS_REQUIRED', JSON.stringify(noExistingDoc.json));

  console.log('\n=== 3. PATCH private -> commercial without a newly required template doc -> 400 DOCUMENTS_REQUIRED ===');
  const vehicleC = await makeVehicle({
    license_plate_number: 'MP09DT0003',
    usage_type: 'private',
    documents: { rc: { secureUrl: 'https://example.test/rc-c.jpg', identifyNumber: 'MP09DT0003', expiryDate: '12 Mar 2031' } },
  });
  const usageSwitch = await api(`/drivers/fleet/vehicles/${vehicleC._id}`, {
    method: 'PATCH', token: rameshToken,
    body: {
      vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Tata', model: 'Nexon', number: 'MP09DT0003', color: 'White',
      usage_type: 'commercial',
      // Satisfies the separate, pre-existing commercial_permit gate so this
      // request isolates Gap 1's own template-based check.
      documents: { commercial_permit: { secureUrl: 'https://example.test/permit.jpg' } },
    },
  });
  check(
    '400 DOCUMENTS_REQUIRED (missing the newly-required commercial-only template)',
    usageSwitch.status === 400 && usageSwitch.json?.code === 'DOCUMENTS_REQUIRED' &&
      (usageSwitch.json?.details?.missing || []).includes('smoke_test_commercial_doc'),
    JSON.stringify(usageSwitch.json),
  );

  console.log('\n=== 6. Admin approve with RC photo but no number -> 400 VEHICLE_DOCUMENT_DETAILS_REQUIRED ===');
  const vehicleD = await makeVehicle({
    license_plate_number: 'MP09DT0004',
    documents: { rc: { secureUrl: 'https://example.test/rc-d.jpg' } },
  });
  const approveNoDetails = await api(`/admin/owner-management/manage-fleet/${vehicleD._id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'approved' },
  });
  check(
    '400 VEHICLE_DOCUMENT_DETAILS_REQUIRED',
    approveNoDetails.status === 400 && approveNoDetails.json?.code === 'VEHICLE_DOCUMENT_DETAILS_REQUIRED',
    JSON.stringify(approveNoDetails.json),
  );

  console.log('\n=== 6b. Admin approve after the number/expiry are added -> succeeds ===');
  await FleetVehicle.updateOne(
    { _id: vehicleD._id },
    { $set: { 'documents.rc.identifyNumber': 'MP09DT0004', 'documents.rc.expiryDate': '12 Mar 2031' } },
  );
  const approveWithDetails = await api(`/admin/owner-management/manage-fleet/${vehicleD._id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'approved' },
  });
  check('200 approved', approveWithDetails.status === 200 && approveWithDetails.json?.data?.status === 'approved', JSON.stringify(approveWithDetails.json));

  console.log('\n=== 7 (Gap 4). Past expiry date -> 400 DOCUMENT_EXPIRED ===');
  const pastExpiryEdit = await api(`/drivers/fleet/vehicles/${vehicleC._id}`, {
    method: 'PATCH', token: rameshToken,
    body: {
      vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Tata', model: 'Nexon', number: 'MP09DT0003', color: 'White',
      documents: { rc: { identifyNumber: 'MP09DT0003', expiryDate: '01 Jan 2020' } },
    },
  });
  check('400 DOCUMENT_EXPIRED', pastExpiryEdit.status === 400 && pastExpiryEdit.json?.code === 'DOCUMENT_EXPIRED', JSON.stringify(pastExpiryEdit.json));

  console.log('\n=== 7b (Gap 4). Past expiry date on add -> 400 DOCUMENT_EXPIRED ===');
  const pastExpiryAdd = await api('/drivers/fleet/vehicles', {
    method: 'POST', token: rameshToken,
    body: {
      vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Tata', model: 'Nexon', number: 'MP09DT0099', color: 'White',
      usage_type: 'private',
      documents: { rc: { secureUrl: 'https://example.test/rc-new.jpg', identifyNumber: 'MP09DT0099', expiryDate: '01 Jan 2020' } },
    },
  });
  check('400 DOCUMENT_EXPIRED', pastExpiryAdd.status === 400 && pastExpiryAdd.json?.code === 'DOCUMENT_EXPIRED', JSON.stringify(pastExpiryAdd.json));

  // Teardown: this template is global (not scoped to this test's vehicles) —
  // leaving it behind would make every *other* commercial-vehicle test in the
  // suite start failing with an unrelated DOCUMENTS_REQUIRED.
  await DriverNeededDocument.deleteMany({ slug: 'smoke-test-commercial-doc' });

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
