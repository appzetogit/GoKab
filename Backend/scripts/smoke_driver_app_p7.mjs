/**
 * Smoke test for the driver-app P7 fields.
 *
 *  1  GET /drivers/me carries total_rides; PATCH /drivers/me saves gender
 *  2  PATCH /drivers/documents/:key takes a data URL, hosts it, ignores
 *     client-sent review state, refuses outside URLs
 *  3  GET /drivers/fleet/vehicles carries fuel_type, model_year,
 *     fitness_valid_till and max_vehicles_allowed; PATCH saves them without
 *     re-opening verification
 *  4  GET /drivers/earnings/summary carries online_minutes (per day and total)
 *     and weekly_goal; PUT /drivers/earnings/goal sets and clears it
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs and scripts/seed_driver_network_tiers.js.
 * Restores every field it changes.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *     node scripts/smoke_driver_app_p7.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
// 1x1 transparent PNG.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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
  (await api('/admin/login', { method: 'POST', body: { email: 'admin@gmail.com', password: 'password' } }))
    .json?.data?.token;

const istDayKey = (date) => new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const mohan = await Driver.findOne({ phone: '9000000004' }).lean();

  const adminToken = await loginAdmin();
  for (const [driver, category] of [[ramesh, 'prime'], [mohan, 'lower']]) {
    const res = await api(`/admin/driver-network/drivers/${driver._id}/category`, {
      method: 'PATCH', token: adminToken, body: { category },
    });
    check(`setup: ${driver.name} is ${category}`, res.status === 200, JSON.stringify(res.json));
  }

  const rameshToken = await login('9000000001');
  const mohanToken = await login('9000000004');

  try {
    console.log('\n1  Profile');
    const me = await api('/drivers/me', { token: rameshToken });
    const expectedRides = await Ride.countDocuments({ driverId: ramesh._id, status: 'completed' });
    check('total_rides is the completed-trip count', me.json?.data?.total_rides === expectedRides,
      `${me.json?.data?.total_rides} vs ${expectedRides}`);
    const female = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { gender: 'female' } });
    check('gender saved, normalised to "Female"', female.status === 200 && female.json?.data?.gender === 'Female',
      JSON.stringify(female.json).slice(0, 200));
    const badGender = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { gender: 'robot' } });
    check('unknown gender refused (INVALID_GENDER)', badGender.status === 422 && badGender.json?.code === 'INVALID_GENDER',
      JSON.stringify(badGender.json));
    const nameOnly = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { name: ramesh.name } });
    check('a PATCH without gender leaves it alone', nameOnly.json?.data?.gender === 'Female');

    console.log('\n2  Document re-upload');
    const docPath = '/drivers/documents/smoke_p7_doc';
    const uploaded = await api(docPath, {
      method: 'PATCH',
      token: rameshToken,
      body: {
        document: {
          dataUrl: PNG_DATA_URL,
          fileName: 'licence-front.png',
          identifyNumber: 'MP09 20240001',
          expiryDate: '2030-01-31',
          status: 'approved',
          reviewStatus: 'approved',
          injected: 'nope',
        },
      },
    });
    const doc = uploaded.json?.data?.document;
    check('data URL accepted', uploaded.status === 200, JSON.stringify(uploaded.json).slice(0, 200));
    check('hosted as a re-encoded image', /\/images\/documents\/.+\.webp$/.test(doc?.previewUrl || ''), doc?.previewUrl);
    check('client review state ignored: pending', doc?.status === 'pending' && doc?.reviewStatus === 'pending');
    check('unknown client keys not stored', doc && !('injected' in doc));
    check('number, expiry and file name kept', doc?.identifyNumber === 'MP09 20240001'
      && doc?.expiryDate === '2030-01-31' && doc?.fileName === 'licence-front.png');
    const reuse = await api(docPath, { method: 'PATCH', token: rameshToken, body: { document: { url: doc?.previewUrl } } });
    check('an image this server hosts can be sent as url', reuse.status === 200, JSON.stringify(reuse.json).slice(0, 200));
    const outside = await api(docPath, {
      method: 'PATCH', token: rameshToken, body: { document: { url: 'https://evil.example.com/images/x.png' } },
    });
    check('an outside URL is refused', outside.status === 422 && outside.json?.code === 'INVALID_DOCUMENT_IMAGE',
      JSON.stringify(outside.json));
    const gif = await api(docPath, {
      method: 'PATCH', token: rameshToken, body: { document: { dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } },
    });
    check('a GIF is refused', gif.status === 422 && gif.json?.code === 'INVALID_DOCUMENT_IMAGE', JSON.stringify(gif.json));
    const badExpiry = await api(docPath, {
      method: 'PATCH', token: rameshToken, body: { document: { dataUrl: PNG_DATA_URL, expiryDate: 'soon' } },
    });
    check('a bad expiry date is refused', badExpiry.status === 422 && badExpiry.json?.code === 'INVALID_DATE');
    const empty = await api(docPath, { method: 'PATCH', token: rameshToken, body: { document: {} } });
    check('an empty document is refused', empty.status === 400 && empty.json?.code === 'FIELD_REQUIRED');
    const badKey = await api('/drivers/documents/bad.key', {
      method: 'PATCH', token: rameshToken, body: { document: { dataUrl: PNG_DATA_URL } },
    });
    check('a malformed document key is refused', badKey.status === 422 && badKey.json?.code === 'INVALID_DOCUMENT_KEY',
      JSON.stringify(badKey.json));

    console.log('\n3  Vehicles');
    const list = await api('/drivers/fleet/vehicles', { token: rameshToken });
    const vehicles = list.json?.data?.results || [];
    check('vehicles listed', vehicles.length > 0, JSON.stringify(list.json).slice(0, 200));
    check('Prime (max_vehicles 0) → max_vehicles_allowed null', list.json?.data?.max_vehicles_allowed === null,
      String(list.json?.data?.max_vehicles_allowed));
    check('vehicles_count matches', list.json?.data?.vehicles_count === vehicles.length);
    check('spec fields present on each vehicle', vehicles.every((item) => 'fuel_type' in item && 'model_year' in item
      && 'fitness_valid_till' in item));
    const mohanList = await api('/drivers/fleet/vehicles', { token: mohanToken });
    check('Lower (max_vehicles 2) → max_vehicles_allowed 2', mohanList.json?.data?.max_vehicles_allowed === 2,
      JSON.stringify(mohanList.json?.data).slice(0, 200));

    const target = vehicles[0];
    const before = await FleetVehicle.findById(target.id).lean();
    const baseBody = {
      vehicle_type_id: target.vehicle_type_id,
      car_brand: target.car_brand,
      car_model: target.car_model,
      license_plate_number: target.license_plate_number,
      car_color: target.car_color,
    };
    const edited = await api(`/drivers/fleet/vehicles/${target.id}`, {
      method: 'PATCH',
      token: rameshToken,
      body: { ...baseBody, fuel_type: 'CNG', model_year: 2021, fitness_valid_till: '2027-03-31' },
    });
    check('specs saved', edited.status === 200 && edited.json?.data?.fuel_type === 'cng'
      && edited.json?.data?.model_year === 2021
      && String(edited.json?.data?.fitness_valid_till || '').startsWith('2027-03-31'),
    JSON.stringify(edited.json).slice(0, 300));
    check('editing specs does not re-open verification', edited.json?.data?.status === before.status,
      `${before.status} -> ${edited.json?.data?.status}`);
    const keep = await api(`/drivers/fleet/vehicles/${target.id}`, { method: 'PATCH', token: rameshToken, body: baseBody });
    check('an edit without specs keeps them', keep.json?.data?.fuel_type === 'cng' && keep.json?.data?.model_year === 2021);
    const badFuel = await api(`/drivers/fleet/vehicles/${target.id}`, {
      method: 'PATCH', token: rameshToken, body: { ...baseBody, fuel_type: 'steam' },
    });
    check('unknown fuel refused (INVALID_FUEL_TYPE)', badFuel.status === 422 && badFuel.json?.code === 'INVALID_FUEL_TYPE');
    const badYear = await api(`/drivers/fleet/vehicles/${target.id}`, {
      method: 'PATCH', token: rameshToken, body: { ...baseBody, model_year: 1890 },
    });
    check('impossible model year refused (INVALID_MODEL_YEAR)', badYear.status === 422
      && badYear.json?.code === 'INVALID_MODEL_YEAR');
    await FleetVehicle.updateOne(
      { _id: target.id },
      { $set: { 'documents.fitness_certificate': { previewUrl: 'x', expiryDate: '2028-06-30' } } },
    );
    const withDoc = (await api('/drivers/fleet/vehicles', { token: rameshToken })).json?.data?.results
      ?.find((item) => item.id === target.id);
    check('a fitness document expiry wins over the typed date',
      String(withDoc?.fitness_valid_till || '').startsWith('2028-06-30'), String(withDoc?.fitness_valid_till));
    await FleetVehicle.updateOne(
      { _id: target.id },
      {
        $unset: { 'documents.fitness_certificate': '', fuel_type: '', model_year: '', fitness_valid_till: '' },
        $set: { status: before.status },
      },
    );

    console.log('\n4  Earnings');
    const todayKey = istDayKey(new Date());
    const originalTracking = (await Driver.findById(ramesh._id).select('incentiveTracking earningsGoal').lean());
    await Driver.updateOne(
      { _id: ramesh._id },
      {
        $set: {
          'incentiveTracking.dailyActivity': [
            ...(originalTracking.incentiveTracking?.dailyActivity || []).filter((item) => item.date !== todayKey),
            { date: todayKey, activeMinutes: 90 },
          ],
          'incentiveTracking.currentOnlineStartedAt': new Date(Date.now() - 30 * 60 * 1000),
        },
      },
    );
    const summary = await api('/drivers/earnings/summary?range=today', { token: rameshToken });
    const today = (summary.json?.data?.daily || []).find((day) => day.date === todayKey);
    // 90 recorded + the 30-minute live session (may straddle IST midnight only at ~00:15).
    check('today online_minutes = recorded + live session (~120)', Math.abs((today?.online_minutes ?? -1) - 120) <= 1,
      String(today?.online_minutes));
    check('total online_minutes matches the days', summary.json?.data?.online_minutes === today?.online_minutes);
    check('no goal set → weekly_goal null', summary.json?.data?.weekly_goal === null,
      JSON.stringify(summary.json?.data?.weekly_goal));

    const goal = await api('/drivers/earnings/goal', { method: 'PUT', token: rameshToken, body: { target_amount: 10000 } });
    const weekly = goal.json?.data?.weekly_goal;
    check('goal set', goal.status === 200 && weekly?.target_amount === 10000, JSON.stringify(goal.json));
    check('goal progress fields', typeof weekly?.achieved_amount === 'number'
      && weekly.remaining_amount === Math.max(0, 10000 - weekly.achieved_amount)
      && weekly.progress_percent >= 0 && weekly.progress_percent <= 100
      && new Date(weekly.week_end) - new Date(weekly.week_start) === 7 * 24 * 60 * 60 * 1000);
    check('week starts on an IST Monday',
      new Date(new Date(weekly?.week_start).getTime() + IST_OFFSET_MS).getUTCDay() === 1, String(weekly?.week_start));
    const summaryWithGoal = await api('/drivers/earnings/summary?range=month', { token: rameshToken });
    check('summary carries the goal', summaryWithGoal.json?.data?.weekly_goal?.target_amount === 10000);
    const badGoal = await api('/drivers/earnings/goal', { method: 'PUT', token: rameshToken, body: { target_amount: -5 } });
    check('negative goal refused (INVALID_TARGET_AMOUNT)', badGoal.status === 422
      && badGoal.json?.code === 'INVALID_TARGET_AMOUNT');
    const cleared = await api('/drivers/earnings/goal', { method: 'PUT', token: rameshToken, body: { target_amount: 0 } });
    check('goal cleared with 0', cleared.json?.data?.weekly_goal === null, JSON.stringify(cleared.json));

    await Driver.updateOne(
      { _id: ramesh._id },
      {
        $set: {
          'incentiveTracking.dailyActivity': originalTracking.incentiveTracking?.dailyActivity || [],
          'incentiveTracking.currentOnlineStartedAt': originalTracking.incentiveTracking?.currentOnlineStartedAt || null,
          earningsGoal: originalTracking.earningsGoal || { weeklyTarget: 0, updatedAt: null },
        },
      },
    );
  } finally {
    await Driver.updateOne(
      { _id: ramesh._id },
      { $set: { gender: ramesh.gender || '' }, $unset: { 'documents.smoke_p7_doc': '' } },
    );
    await mongoose.disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
