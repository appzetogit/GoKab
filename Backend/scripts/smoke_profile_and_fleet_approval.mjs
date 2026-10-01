/**
 * Smoke test for "Profile Account Info + Fleet Vehicle Approval" (backend
 * spec, 2026-10-01):
 *
 *  1. GET /drivers/me exposes account_type, driver_category, createdAt
 *     (read-only — PATCH /me must not accept them back).
 *  2. Admin can no longer approve a fleet vehicle that's missing a required
 *     document (e.g. RC) — reproduces the exact reported scenario
 *     (documents: {}) and proves the full admin-approve -> DB -> driver-app
 *     pipeline actually works end to end once the vehicle has what it needs.
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_profile_and_fleet_approval.mjs
 */

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4120/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27037/gokab_approval_test?replicaSet=rs0';

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

  const ramesh = await Driver.findOne({ phone: '9000000001' });
  const rameshToken = await login('9000000001');
  const adminToken = await loginAdmin();

  console.log('\n=== 1. GET /drivers/me exposes account_type, driver_category, createdAt ===');
  await Driver.updateOne({ _id: ramesh._id }, { $set: { account_type: 'vendor', driver_category: 'prime' } });
  const me = await api('/drivers/me', { token: rameshToken });
  check('200 OK', me.status === 200, JSON.stringify(me.json));
  check('account_type present', me.json?.data?.account_type === 'vendor', JSON.stringify(me.json?.data?.account_type));
  check('driver_category present', me.json?.data?.driver_category === 'prime', JSON.stringify(me.json?.data?.driver_category));
  check('createdAt present', Boolean(me.json?.data?.createdAt), JSON.stringify(me.json?.data?.createdAt));
  check('Existing field (name) unchanged', me.json?.data?.name === 'Ramesh Verma');
  check('Existing field (phone) unchanged', me.json?.data?.phone === '9000000001');

  console.log('\n=== 2. PATCH /me cannot edit account_type/driver_category (read-only) ===');
  const patchAttempt = await api('/drivers/me', {
    method: 'PATCH', token: rameshToken,
    body: { account_type: 'individual', driver_category: 'lower' },
  });
  check('200 OK (extra fields silently ignored, not an error)', patchAttempt.status === 200, JSON.stringify(patchAttempt.json));
  const meAfterPatch = await api('/drivers/me', { token: rameshToken });
  check('account_type unchanged after the attempt', meAfterPatch.json?.data?.account_type === 'vendor', JSON.stringify(meAfterPatch.json?.data?.account_type));
  check('driver_category unchanged after the attempt', meAfterPatch.json?.data?.driver_category === 'prime', JSON.stringify(meAfterPatch.json?.data?.driver_category));

  console.log('\n=== 3. Reproduce the exact reported scenario: a pending fleet vehicle with empty documents ===');
  await FleetVehicle.deleteMany({ license_plate_number: 'HT55GT5565' });
  const vehicle = await FleetVehicle.create({
    owner_id: ramesh.owner_id,
    service_location_id: ramesh.service_location_id,
    transport_type: 'taxi',
    car_brand: 'Tata', car_model: 'Nexon', license_plate_number: 'HT55GT5565', car_color: 'White',
    usage_type: 'private',
    status: 'pending',
    active: true,
    documents: {},
  });
  check('Reproduction vehicle created matching the bug report (documents: {})', Object.keys(vehicle.documents || {}).length === 0);

  console.log('\n=== 4. Admin → Manage Fleet list includes this vehicle ===');
  const fleetList = await api('/admin/owner-management/manage-fleet', { token: adminToken });
  const inList = (fleetList.json?.data?.results || []).some((item) => String(item._id || item.id) === String(vehicle._id));
  check('HT55GT5565 appears in GET /admin/owner-management/manage-fleet', inList, 'no owner-type filter hides it — confirmed');

  console.log('\n=== 5. Admin tries to approve it as-is -> now REFUSED (new rule), DB stays pending ===');
  const approveNoDocs = await api(`/admin/owner-management/manage-fleet/${vehicle._id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'approved' },
  });
  check(
    '400 VEHICLE_DOCUMENTS_REQUIRED',
    approveNoDocs.status === 400 && approveNoDocs.json?.code === 'VEHICLE_DOCUMENTS_REQUIRED',
    JSON.stringify(approveNoDocs.json),
  );
  const stillPending = await FleetVehicle.findById(vehicle._id).lean();
  check('DB status is still pending (nothing silently changed)', stillPending.status === 'pending');
  check('updatedAt did not move for the refused attempt', stillPending.updatedAt.getTime() === vehicle.updatedAt.getTime());

  console.log('\n=== 6. Driver uploads the RC document ===');
  const uploadRc = await api(`/drivers/fleet/vehicles/${vehicle._id}`, {
    method: 'PATCH', token: rameshToken,
    body: {
      vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Tata', model: 'Nexon', number: 'HT55GT5565', color: 'White', usage_type: 'private',
      documents: { rc: { secureUrl: 'https://example.test/rc.jpg', identifyNumber: 'HT55GT5565', expiryDate: '2030-01-01' } },
    },
  });
  check('200 RC uploaded', uploadRc.status === 200, JSON.stringify(uploadRc.json));

  console.log('\n=== 7. Admin approves it now -> succeeds end to end ===');
  const beforeApprove = await FleetVehicle.findById(vehicle._id).lean();
  const approveWithDocs = await api(`/admin/owner-management/manage-fleet/${vehicle._id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'approved' },
  });
  check('200 approved', approveWithDocs.status === 200 && approveWithDocs.json?.data?.status === 'approved', JSON.stringify(approveWithDocs.json));
  const afterApprove = await FleetVehicle.findById(vehicle._id).lean();
  check('DB status is now approved', afterApprove.status === 'approved');
  check('updatedAt actually moved', afterApprove.updatedAt.getTime() > beforeApprove.updatedAt.getTime(), `${beforeApprove.updatedAt.toISOString()} -> ${afterApprove.updatedAt.toISOString()}`);

  console.log('\n=== 8. Driver app sees the approval ===');
  const driverVehicles = await api('/drivers/fleet/vehicles', { token: rameshToken });
  const driverSideVehicle = (driverVehicles.json?.data?.results || []).find((item) => String(item.id) === String(vehicle._id));
  check('GET /drivers/fleet/vehicles shows status: approved', driverSideVehicle?.status === 'approved', JSON.stringify(driverSideVehicle));

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
