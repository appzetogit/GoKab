/**
 * Smoke test for the RC (Registration Certificate) document requirement:
 * number + photo + expiry are now captured (and required) both at driver
 * registration (onboarding vehicle) and on a fleet vehicle add, and the
 * admin panel's generic document view (which already renders
 * identify_number/expiry_date per document) surfaces them correctly.
 *
 * Requires scripts/seed_rc_document_template.js to have been run against the
 * same database first.
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_rc_document.mjs
 */

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4088/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27034/gokab_rc_test?replicaSet=rs0';
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

const login = async (phone) =>
  (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data?.token;
const loginAdmin = async () =>
  (await api('/admin/login', { method: 'POST', body: { email: 'admin@gmail.com', password: 'password' } })).json?.data?.token;

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { DriverNeededDocument } = await import('../src/modules/taxi/admin/models/DriverNeededDocument.js');
  const { DriverRegistrationSession } = await import('../src/modules/taxi/driver/models/DriverRegistrationSession.js');
  const onboardingService = await import('../src/modules/taxi/driver/services/onboardingService.js');

  const rcTemplate = await DriverNeededDocument.findOne({ slug: 'registration-certificate' }).lean();
  check('RC template is seeded', Boolean(rcTemplate), 'run scripts/seed_rc_document_template.js first');
  check('RC applies to vehicles', rcTemplate?.applies_to === 'vehicle');
  check('RC tracks an identify number', rcTemplate?.has_identify_number === true);
  check('RC tracks an expiry date', rcTemplate?.has_expiry_date === true);
  check('RC is required', rcTemplate?.is_required === true, 'if this is false, RC_REQUIRED=false was used on purpose — skip the enforcement checks below manually');

  console.log('\n=== 1. Registration: RC missing -> registration completion refused ===');
  const passwordHash = await bcrypt.hash('password', 10);
  const registrationId = 'rc-smoke-reg-1';
  await DriverRegistrationSession.deleteOne({ registrationId });
  await Driver.deleteOne({ phone: '9333300001' });
  await DriverRegistrationSession.create({
    registrationId,
    phone: '9333300001',
    role: 'driver',
    status: 'personal_saved',
    otpHash: 'x',
    otpExpiresAt: new Date(Date.now() + 3600_000),
    otpVerifiedAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
    personal: { fullName: 'RC Smoke Driver', passwordHash },
  });
  const city = await Driver.findOne({ phone: '9000000001' }).select('service_location_id').lean();
  await onboardingService.saveDriverVehicle({
    registrationId,
    phone: '9333300001',
    vehicle_usage_type: 'private',
    locationId: String(city.service_location_id),
    locationName: 'Indore',
    vehicleTypeId: new mongoose.Types.ObjectId(),
    make: 'Maruti', model: 'Alto', year: '2022', number: 'MP09RC0001', color: 'White',
  });

  let missingRcError = null;
  try {
    await onboardingService.completeDriverOnboarding({
      registrationId,
      phone: '9333300001',
      documents: { smoke_test_document: 'https://example.test/doc.jpg' },
    });
  } catch (error) {
    missingRcError = error;
  }
  check('Registration refuses to complete without RC', Boolean(missingRcError), missingRcError ? '' : 'completed without RC!');
  check('Error message names the missing document', String(missingRcError?.message || '').includes('rc'), missingRcError?.message);

  console.log('\n=== 2. Registration: RC present without expiry -> refused with a details error ===');
  let missingDetailsError = null;
  try {
    await onboardingService.completeDriverOnboarding({
      registrationId,
      phone: '9333300001',
      documents: { rc: { secureUrl: 'https://example.test/rc.jpg', identifyNumber: 'MP09RC0001' } },
    });
  } catch (error) {
    missingDetailsError = error;
  }
  check(
    'Registration refuses to complete with RC photo but no expiry date',
    Boolean(missingDetailsError) && String(missingDetailsError?.message || '').toLowerCase().includes('expiry'),
    missingDetailsError?.message,
  );

  console.log('\n=== 3. Registration: full RC (photo + number + expiry) -> completes ===');
  const completion = await onboardingService.completeDriverOnboarding({
    registrationId,
    phone: '9333300001',
    documents: {
      rc: { secureUrl: 'https://example.test/rc.jpg', identifyNumber: 'MP09RC0001', expiryDate: '2030-06-15' },
    },
  });
  check('Registration completes with full RC', Boolean(completion?.driver?.id), JSON.stringify(completion));
  const newDriver = await Driver.findById(completion.driver.id).select('documents').lean();
  check('Stored RC keeps its identify number', newDriver?.documents?.rc?.identifyNumber === 'MP09RC0001');
  check('Stored RC keeps its expiry date', newDriver?.documents?.rc?.expiryDate === '2030-06-15');
  await Driver.updateOne({ _id: completion.driver.id }, { $set: { approve: true, status: 'approved' } });

  console.log('\n=== 4. Admin panel: driver detail exposes RC number/expiry generically ===');
  const adminToken = await loginAdmin();
  const driverDetail = await api(`/admin/drivers/${completion.driver.id}`, { token: adminToken });
  const rcInAdminView = driverDetail.json?.data?.documents?.rc || driverDetail.json?.data?.driver?.documents?.rc;
  check(
    'Admin driver payload includes documents.rc with number+expiry',
    rcInAdminView?.identifyNumber === 'MP09RC0001' && rcInAdminView?.expiryDate === '2030-06-15',
    JSON.stringify(rcInAdminView),
  );

  console.log('\n=== 5. Fleet vehicle: RC required the same way ===');
  const driverToken = await login('9333300001');
  const noRc = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: driverToken,
    body: { vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Hyundai', model: 'i10', number: 'MP09RC0002', color: 'Red', usage_type: 'private', documents: {} },
  });
  check('Fleet vehicle add refused without RC', noRc.status === 400 && noRc.json?.code === 'DOCUMENTS_REQUIRED', JSON.stringify(noRc.json));

  const noExpiry = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: driverToken,
    body: {
      vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Hyundai', model: 'i10', number: 'MP09RC0002', color: 'Red', usage_type: 'private',
      documents: { rc: { secureUrl: 'https://example.test/rc2.jpg', identifyNumber: 'MP09RC0002' } },
    },
  });
  check(
    'Fleet vehicle add refused with RC photo but no expiry',
    noExpiry.status === 400 && noExpiry.json?.code === 'DOCUMENT_DETAILS_REQUIRED',
    JSON.stringify(noExpiry.json),
  );

  const withFullRc = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: driverToken,
    body: {
      vehicleTypeId: new mongoose.Types.ObjectId(), make: 'Hyundai', model: 'i10', number: 'MP09RC0002', color: 'Red', usage_type: 'private',
      documents: { rc: { secureUrl: 'https://example.test/rc2.jpg', identifyNumber: 'MP09RC0002', expiryDate: '2031-03-01' } },
    },
  });
  check('Fleet vehicle add succeeds with full RC', withFullRc.status === 201, JSON.stringify(withFullRc.json));
  const fleetVehicleId = withFullRc.json?.data?.id;

  console.log('\n=== 6. Admin panel: fleet vehicle listing exposes RC via documents_summary ===');
  const fleetVehicle = await FleetVehicle.findById(fleetVehicleId).lean();
  check(
    'Stored fleet vehicle RC keeps its identify number + expiry',
    fleetVehicle?.documents?.rc?.identifyNumber === 'MP09RC0002' && fleetVehicle?.documents?.rc?.expiryDate === '2031-03-01',
    JSON.stringify(fleetVehicle?.documents?.rc),
  );
  const vehiclesList = await api('/drivers/fleet/vehicles', { token: driverToken });
  const listedVehicle = (vehiclesList.json?.data?.results || []).find((v) => v.id === fleetVehicleId);
  const rcSummary = (listedVehicle?.documents_summary || []).find((d) => d.key === 'rc');
  check('documents_summary includes the RC entry', Boolean(rcSummary), JSON.stringify(listedVehicle?.documents_summary));

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
