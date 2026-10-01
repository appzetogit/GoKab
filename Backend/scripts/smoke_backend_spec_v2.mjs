/**
 * Smoke test for "GoKab Driver: Backend Spec V2" (2026-10-01).
 *
 *  §1  driver:location:update socket event (idle position heartbeat)
 *  §2  daily selfie: SELFIE_REQUIRED code + data URL hosted on upload
 *  §3  PATCH /drivers/me returns the full GET /me payload; QR data URL hosted
 *  §4  GET /rides?from=&to= history range (+ INVALID_DATE_RANGE)
 *  §5  assignment.acknowledged_at + POST /network/rides/:id/acknowledge
 *  §6  reminder cron (pickup, owner, unacknowledged, document expiry)
 *  §7  scheduled-ride start window (TOO_EARLY_TO_START, /rides/active/me)
 *  §8  GET /drivers/referrals
 *  §9  GET /drivers/ratings
 *  §10 rider feedback comment + tags
 *  §11 feed item `notes`
 *
 * Runs against a local backend + local database only. Start the server with
 * STORAGE_BASE_DIR pointing at a throwaway folder (the selfie/QR checks write
 * real image files) and STORAGE_BASE_URL set to the server's own origin.
 *
 * Usage: node scripts/smoke_backend_spec_v2.mjs
 */

// Read once by config/env.js — must be set before anything imports it. Only
// affects this test process (the stale-position check calls matchDrivers
// in-process); the server under test runs without it, i.e. the default "off".
process.env.DRIVER_LOCATION_STALE_SECONDS = '180';

import mongoose from 'mongoose';

const { io: socketClient } = await import('../../frontend/node_modules/socket.io-client/build/cjs/index.js');

const API = process.env.SMOKE_API || 'http://127.0.0.1:4097/api/v1';
const SOCKET_URL = process.env.SMOKE_SOCKET || API.replace(/\/api\/v1$/, '');
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27037/gokab_spec_v2?replicaSet=rs0';
const INDORE = [75.8577, 22.7196];
const BHOPAL = [77.4126, 23.2599];

// 1x1 transparent PNG — a real image, since the media service re-encodes it.
const TINY_PNG =
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const minutes = (count) => count * 60 * 1000;
const days = (count) => count * 24 * 60 * 60 * 1000;

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

const connectSocket = (token) =>
  new Promise((resolve, reject) => {
    const socket = socketClient(SOCKET_URL, { auth: { token }, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

const waitForEvent = (socket, event, timeoutMs = 3000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

let customerCounter = 0;
const nextCustomer = () => {
  customerCounter += 1;
  return { name: `Spec V2 Customer ${customerCounter}`, phone: `920000${String(7000 + customerCounter)}` };
};

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { AdminBusinessSetting } = await import('../src/modules/taxi/admin/models/AdminBusinessSetting.js');
  const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
  const cron = await import('../src/modules/taxi/services/networkCronService.js');
  const { serializeFeedItem } = await import('../src/modules/taxi/driver/services/feedService.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();
  const rider = await User.findOne({ phone: '9100000001' }).lean();

  const rameshToken = await login('9000000001');
  const sureshToken = await login('9000000002');
  const vikasToken = await login('9000000003');
  const adminToken = await loginAdmin();

  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, {
    method: 'PATCH', token: adminToken, body: { category: 'prime' },
  });

  const freeDrivers = () =>
    Driver.updateMany({ _id: { $in: [ramesh._id, suresh._id] } }, { $set: { isOnRide: false } });

  // Creates a network ride (optionally assigned). Scheduled rides are created
  // far in the future to dodge the clash check, then moved with `moveRide`.
  const createRide = async ({ assignTo = null, scheduledAt = null } = {}) => {
    const res = await api('/drivers/network/rides', {
      method: 'POST',
      token: rameshToken,
      body: {
        customer: nextCustomer(),
        pickup: { address: 'Indore Palasia', coordinates: INDORE },
        drop: { address: 'Bhopal MP Nagar', coordinates: BHOPAL },
        fare: 5000,
        paymentMethod: 'cash',
        serviceType: 'ride',
        notes: 'Persons: 2 • Luggage: 1 • Vehicle: SUV',
        ...(assignTo ? { assign_to_driver_id: String(assignTo) } : {}),
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
      },
    });
    await freeDrivers();
    return res;
  };

  let farOffsetDays = 10;
  const createFarScheduledRide = async (assignTo) => {
    farOffsetDays += 2;
    return createRide({ assignTo, scheduledAt: Date.now() + days(farOffsetDays) });
  };

  const resetRides = async () => {
    await Ride.deleteMany({});
    await freeDrivers();
  };

  await resetRides();

  // =========================================================================
  console.log('\n=== §1. driver:location:update (idle position heartbeat) ===');
  const driverSocket = await connectSocket(vikasToken);

  await Driver.updateOne(
    { _id: vikas._id },
    { $set: { isOnline: false, location: { type: 'Point', coordinates: [0, 0] }, locationUpdatedAt: null } },
  );
  driverSocket.emit('driver:location:update', { coordinates: [75.9, 22.75], heading: 87.5, speed: 6.2 });
  await sleep(700);
  let vikasNow = await Driver.findById(vikas._id).lean();
  check('Offline driver: update is ignored', vikasNow.location.coordinates[0] === 0 && !vikasNow.locationUpdatedAt);

  await Driver.updateOne({ _id: vikas._id }, { $set: { isOnline: true } });
  driverSocket.emit('driver:location:update', { coordinates: [75.9, 22.75], heading: 87.5, speed: 6.2 });
  await sleep(900);
  vikasNow = await Driver.findById(vikas._id).lean();
  check('Online driver: location updated', vikasNow.location.coordinates[0] === 75.9 && vikasNow.location.coordinates[1] === 22.75, JSON.stringify(vikasNow.location));
  check('locationUpdatedAt stamped', Boolean(vikasNow.locationUpdatedAt) && Date.now() - new Date(vikasNow.locationUpdatedAt).getTime() < 15000);
  check('zoneId resolved from the point', Boolean(vikasNow.zoneId));

  driverSocket.emit('driver:location:update', { coordinates: [75.95, 22.8] });
  await sleep(700);
  vikasNow = await Driver.findById(vikas._id).lean();
  check('A second beat within 10 s is rate-limited', vikasNow.location.coordinates[0] === 75.9, JSON.stringify(vikasNow.location));

  await sleep(10300);
  driverSocket.emit('driver:location:update', { coordinates: [75.95, 22.8] });
  await sleep(900);
  vikasNow = await Driver.findById(vikas._id).lean();
  check('A beat after the interval is accepted', vikasNow.location.coordinates[0] === 75.95, JSON.stringify(vikasNow.location));

  await sleep(10300);
  driverSocket.emit('driver:location:update', { coordinates: 'not-a-point' });
  await sleep(700);
  check('A malformed payload does not crash or drop the connection', driverSocket.connected);

  const stillWorks = await api('/drivers/me', { token: vikasToken });
  check('Server still healthy after the malformed beat', stillWorks.status === 200);
  driverSocket.disconnect();
  await Driver.updateOne({ _id: vikas._id }, { $set: { isOnline: false } });

  console.log('\n=== §1b. Dispatch skips a stale position (opt-in via DRIVER_LOCATION_STALE_SECONDS) ===');
  const { env } = await import('../src/config/env.js');
  const { matchDrivers } = await import('../src/modules/taxi/services/matchingService.js');
  const matchedIds = async () =>
    (await matchDrivers(INDORE, { maxDistance: 8000, limit: 20 })).drivers.map((driver) => String(driver._id));
  await Driver.updateOne(
    { _id: vikas._id },
    { $set: { isOnline: true, isOnRide: false, location: { type: 'Point', coordinates: INDORE }, locationUpdatedAt: new Date() } },
  );
  check('Fresh position: driver is matched', (await matchedIds()).includes(String(vikas._id)));
  await Driver.updateOne({ _id: vikas._id }, { $set: { locationUpdatedAt: new Date(Date.now() - minutes(10)) } });
  check('Position older than the threshold: driver is skipped', !(await matchedIds()).includes(String(vikas._id)));
  await Driver.updateOne({ _id: vikas._id }, { $set: { locationUpdatedAt: null } });
  check('No timestamp at all (pre-existing data): driver is kept', (await matchedIds()).includes(String(vikas._id)));
  await Driver.updateOne({ _id: vikas._id }, { $set: { locationUpdatedAt: new Date(Date.now() - minutes(10)) } });
  env.driverLocationStaleSeconds = 0;
  check('Threshold off (the default): a stale driver is still matched', (await matchedIds()).includes(String(vikas._id)));
  env.driverLocationStaleSeconds = 180;
  await Driver.updateOne({ _id: vikas._id }, { $set: { isOnline: false } });

  // =========================================================================
  console.log('\n=== §2. Daily selfie upload ===');
  await AdminBusinessSetting.updateOne({ scope: 'default' }, { $set: { 'customization.enable_daily_driver_selfie': '1' } });
  await Driver.updateOne({ _id: vikas._id }, { $set: { isOnline: false, onlineSelfie: { imageUrl: '', forDate: '' } } });

  const noSelfie = await api('/drivers/online', { method: 'PATCH', token: vikasToken, body: { location: INDORE } });
  check('Refused without a selfie: 400', noSelfie.status === 400, JSON.stringify(noSelfie.json));
  check('code: SELFIE_REQUIRED', noSelfie.json?.code === 'SELFIE_REQUIRED', JSON.stringify(noSelfie.json));
  check('message still contains "selfie"', /selfie/i.test(noSelfie.json?.message || ''));

  const withSelfie = await api('/drivers/online', {
    method: 'PATCH', token: vikasToken, body: { location: INDORE, selfieImageUrl: TINY_PNG },
  });
  check('Retry with a data-URL selfie succeeds', withSelfie.status === 200, JSON.stringify(withSelfie.json));
  const storedSelfie = (await Driver.findById(vikas._id).lean()).onlineSelfie?.imageUrl || '';
  check('Stored selfie is a hosted URL, not base64', storedSelfie.startsWith('http') && !storedSelfie.startsWith('data:'), storedSelfie.slice(0, 80));

  await api('/drivers/offline', { method: 'PATCH', token: vikasToken });
  const sameDay = await api('/drivers/online', { method: 'PATCH', token: vikasToken, body: { location: INDORE } });
  check('Going online again the same day needs no new selfie', sameDay.status === 200, JSON.stringify(sameDay.json));

  await AdminBusinessSetting.updateOne({ scope: 'default' }, { $set: { 'customization.enable_daily_driver_selfie': '0' } });
  await Driver.updateOne({ _id: vikas._id }, { $set: { isOnline: false } });

  // =========================================================================
  console.log('\n=== §3. PATCH /drivers/me returns the full profile ===');
  const meBefore = await api('/drivers/me', { token: rameshToken });
  const patched = await api('/drivers/me', {
    method: 'PATCH',
    token: rameshToken,
    body: {
      bankDetails: {
        accountHolderName: 'Ramesh Verma',
        upiId: 'ramesh@okbank',
        qrCodeImage: TINY_PNG,
        branchName: 'Vijay Nagar',
        ifsc: 'HDFC0001234',
      },
    },
  });
  check('200 OK', patched.status === 200, JSON.stringify(patched.json));

  const getKeys = Object.keys(meBefore.json?.data || {}).sort();
  const patchKeys = Object.keys(patched.json?.data || {}).sort();
  check('PATCH /me payload has exactly the keys of GET /me', JSON.stringify(getKeys) === JSON.stringify(patchKeys),
    `missing: ${getKeys.filter((key) => !patchKeys.includes(key)).join(',')}`);
  check('Includes account_type / driver_category / createdAt / wallet / vehicleMake',
    ['account_type', 'driver_category', 'createdAt', 'wallet', 'vehicleMake'].every((key) => key in (patched.json?.data || {})));
  const qr = patched.json?.data?.bankDetails?.qrCodeImage || '';
  check('QR data URL became a hosted URL', qr.startsWith('http') && !qr.startsWith('data:'), qr.slice(0, 80));
  check('bankDetails.branchName saved', patched.json?.data?.bankDetails?.branchName === 'Vijay Nagar');

  const meAfter = await api('/drivers/me', { token: rameshToken });
  check('GET /me now shows the same QR + branch', meAfter.json?.data?.bankDetails?.qrCodeImage === qr && meAfter.json?.data?.bankDetails?.branchName === 'Vijay Nagar');

  const unchanged = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { bankDetails: { upiId: 'ramesh@okbank' } } });
  check('Omitting qrCodeImage leaves the stored QR untouched', unchanged.json?.data?.bankDetails?.qrCodeImage === qr);

  const hugeQr = `data:image/png;base64,${'A'.repeat(Math.ceil((3 * 1024 * 1024 * 4) / 3))}`;
  const tooBig = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { bankDetails: { qrCodeImage: hugeQr } } });
  check('QR over 2 MB -> 400 IMAGE_TOO_LARGE', tooBig.status === 400 && tooBig.json?.code === 'IMAGE_TOO_LARGE', JSON.stringify(tooBig.json).slice(0, 200));

  // =========================================================================
  console.log('\n=== §4. Ride history date range ===');
  await resetRides();
  const histOld = await createRide({ assignTo: ramesh._id });
  const histRecent = await createRide({ assignTo: ramesh._id });
  const histCancelled = await createRide({ assignTo: ramesh._id });
  const idOld = histOld.json?.data?.id;
  const idRecent = histRecent.json?.data?.id;
  const idCancelled = histCancelled.json?.data?.id;
  check('Three history rides created', Boolean(idOld && idRecent && idCancelled), JSON.stringify([histOld.status, histRecent.status, histCancelled.status]));

  const stamp = (id, fields) => Ride.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: fields });
  await stamp(idOld, { status: 'completed', liveStatus: 'completed', createdAt: new Date(Date.now() - days(100)), completedAt: new Date(Date.now() - days(99)) });
  await stamp(idRecent, { status: 'completed', liveStatus: 'completed', createdAt: new Date(Date.now() - days(12)), completedAt: new Date(Date.now() - days(10)) });
  await stamp(idCancelled, { status: 'cancelled', liveStatus: 'cancelled', createdAt: new Date(Date.now() - days(5)), completedAt: null });

  const ids = (res) => (res.json?.data?.results || []).map((item) => item.rideId);

  const lastMonth = await api(`/rides?from=${encodeURIComponent(new Date(Date.now() - days(30)).toISOString())}&limit=100`, { token: rameshToken });
  check('from=30d ago keeps the recent + cancelled rides', ids(lastMonth).includes(idRecent) && ids(lastMonth).includes(idCancelled), JSON.stringify(ids(lastMonth)));
  check('...and drops the 100-day-old one', !ids(lastMonth).includes(idOld));
  check('pagination.total matches the filtered set', lastMonth.json?.data?.pagination?.total === 2 && lastMonth.json?.data?.total === 2, JSON.stringify(lastMonth.json?.data?.pagination));

  const all = await api('/rides?limit=100', { token: rameshToken });
  check('No range: all three rides (unchanged behaviour)', ids(all).length === 3, JSON.stringify(ids(all)));

  const window = await api(
    `/rides?from=${encodeURIComponent(new Date(Date.now() - days(200)).toISOString())}&to=${encodeURIComponent(new Date(Date.now() - days(50)).toISOString())}`,
    { token: rameshToken },
  );
  check('from + to selects only the old ride', ids(window).length === 1 && ids(window)[0] === idOld, JSON.stringify(ids(window)));

  const exclusiveTo = await api(`/rides?to=${encodeURIComponent(new Date(Date.now() - days(1)).toISOString())}`, { token: rameshToken });
  check('to-only is exclusive of later rides and keeps all earlier ones', ids(exclusiveTo).length === 3);

  const badDate = await api('/rides?from=not-a-date', { token: rameshToken });
  check('Invalid date -> 422 INVALID_DATE_RANGE', badDate.status === 422 && badDate.json?.code === 'INVALID_DATE_RANGE', JSON.stringify(badDate.json));
  const reversed = await api(
    `/rides?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() - days(1)).toISOString())}`,
    { token: rameshToken },
  );
  check('from after to -> 422 INVALID_DATE_RANGE', reversed.status === 422 && reversed.json?.code === 'INVALID_DATE_RANGE');

  const withCategory = await api(`/rides?category=rides&from=${encodeURIComponent(new Date(Date.now() - days(30)).toISOString())}`, { token: rameshToken });
  check('Composes with the category filter without a 500', withCategory.status === 200);
  const outstation = await api(`/rides?category=outstation&from=${encodeURIComponent(new Date(Date.now() - days(30)).toISOString())}`, { token: rameshToken });
  check('Composes with the $or-based outstation category', outstation.status === 200);

  // =========================================================================
  console.log('\n=== §5. Fleet assignment confirmation ===');
  await resetRides();
  const rameshSocket = await connectSocket(rameshToken);
  await sleep(500);

  const assigned = await createRide({ assignTo: suresh._id });
  const rideId = assigned.json?.data?.id;
  check('Ride created and assigned to Suresh', assigned.status === 201 && Boolean(rideId), JSON.stringify(assigned.json));
  check('Create response carries assignment.acknowledged_at as a null key',
    Object.prototype.hasOwnProperty.call(assigned.json?.data?.assignment || {}, 'acknowledged_at') && assigned.json.data.assignment.acknowledged_at === null);

  const listed = await api('/drivers/network/rides?scope=assigned_to_me', { token: sureshToken });
  const listedRide = (listed.json?.data?.results || []).find((item) => item.id === rideId);
  check('assigned_to_me list has the key (null)', listedRide && Object.prototype.hasOwnProperty.call(listedRide.assignment, 'acknowledged_at') && listedRide.assignment.acknowledged_at === null);
  const createdScope = await api('/drivers/network/rides?scope=created', { token: rameshToken });
  const createdRide = (createdScope.json?.data?.results || []).find((item) => item.id === rideId);
  check('created list has the key too', createdRide && Object.prototype.hasOwnProperty.call(createdRide.assignment, 'acknowledged_at'));

  const strangerAck = await api(`/drivers/network/rides/${rideId}/acknowledge`, { method: 'POST', token: rameshToken });
  check('Someone other than the assigned driver -> 403 NOT_RIDE_DRIVER', strangerAck.status === 403 && strangerAck.json?.code === 'NOT_RIDE_DRIVER', JSON.stringify(strangerAck.json));

  const ackEvent = waitForEvent(rameshSocket, 'org:ride:acknowledged', 4000);
  const ack = await api(`/drivers/network/rides/${rideId}/acknowledge`, { method: 'POST', token: sureshToken });
  check('Assigned driver confirms: 200', ack.status === 200, JSON.stringify(ack.json));
  check('acknowledged_at is now set', Boolean(ack.json?.data?.assignment?.acknowledged_at));
  const ackPayload = await ackEvent;
  check('org:ride:acknowledged emitted to the org room', ackPayload?.rideId === rideId && ackPayload?.driverId === String(suresh._id) && Boolean(ackPayload?.driverName), JSON.stringify(ackPayload));

  const ackAgain = await api(`/drivers/network/rides/${rideId}/acknowledge`, { method: 'POST', token: sureshToken });
  check('Repeat confirm is idempotent: 200, timestamp unchanged', ackAgain.status === 200 && ackAgain.json?.data?.assignment?.acknowledged_at === ack.json?.data?.assignment?.acknowledged_at);
  const noSecondEvent = await waitForEvent(rameshSocket, 'org:ride:acknowledged', 1200);
  check('...and does not notify the owner a second time', noSecondEvent === null);

  const reassigned = await api(`/drivers/network/rides/${rideId}/reassign`, {
    method: 'POST', token: rameshToken, body: { driverId: String(ramesh._id) },
  });
  await freeDrivers();
  check('Reassign works', reassigned.status === 200, JSON.stringify(reassigned.json));
  check('Reassign resets acknowledged_at to null', reassigned.json?.data?.assignment?.acknowledged_at === null);
  const oldDriverAck = await api(`/drivers/network/rides/${rideId}/acknowledge`, { method: 'POST', token: sureshToken });
  check('The previous driver can no longer confirm', oldDriverAck.status === 403);

  const forUnassign = await createRide({ assignTo: suresh._id });
  await api(`/drivers/network/rides/${forUnassign.json?.data?.id}/acknowledge`, { method: 'POST', token: sureshToken });
  const unassigned = await api(`/drivers/network/rides/${forUnassign.json?.data?.id}/unassign`, { method: 'POST', token: rameshToken, body: {} });
  await freeDrivers();
  check('Unassign resets acknowledged_at to null', unassigned.status === 200 && unassigned.json?.data?.assignment?.acknowledged_at === null, JSON.stringify(unassigned.json?.data?.assignment));

  const startedRide = await createRide({ assignTo: suresh._id });
  await Ride.updateOne({ _id: startedRide.json?.data?.id }, { $set: { status: 'ongoing', liveStatus: 'started' } });
  const lateAck = await api(`/drivers/network/rides/${startedRide.json?.data?.id}/acknowledge`, { method: 'POST', token: sureshToken });
  check('Trip already started -> 409 RIDE_NOT_OPEN', lateAck.status === 409 && lateAck.json?.code === 'RIDE_NOT_OPEN', JSON.stringify(lateAck.json));

  const cancelledRide = await createRide({ assignTo: suresh._id });
  await Ride.updateOne({ _id: cancelledRide.json?.data?.id }, { $set: { status: 'cancelled', liveStatus: 'cancelled' } });
  const cancelledAck = await api(`/drivers/network/rides/${cancelledRide.json?.data?.id}/acknowledge`, { method: 'POST', token: sureshToken });
  check('Cancelled ride -> 409 RIDE_NOT_OPEN', cancelledAck.status === 409 && cancelledAck.json?.code === 'RIDE_NOT_OPEN');

  const missing = await api(`/drivers/network/rides/${new mongoose.Types.ObjectId()}/acknowledge`, { method: 'POST', token: sureshToken });
  check('Unknown ride -> 404', missing.status === 404);
  rameshSocket.disconnect();

  // =========================================================================
  console.log('\n=== §6. Reminder cron ===');
  await resetRides();
  const moveRide = (id, fields) => Ride.updateOne({ _id: id }, { $set: fields });

  const s1 = (await createFarScheduledRide(suresh._id)).json?.data?.id;
  const s2 = (await createFarScheduledRide(suresh._id)).json?.data?.id;
  const s3 = (await createFarScheduledRide(suresh._id)).json?.data?.id;
  await api(`/drivers/network/rides/${s2}/acknowledge`, { method: 'POST', token: sureshToken });
  await moveRide(s1, { scheduledAt: new Date(Date.now() + minutes(37)) });
  await moveRide(s2, { scheduledAt: new Date(Date.now() + minutes(40)) });
  await moveRide(s3, { scheduledAt: new Date(Date.now() + days(2)) });

  const firstPass = await cron.sendScheduledRideReminders();
  check('Pickup reminders: 2 drivers (s1 + s2), 1 owner (s1 only, s2 acknowledged)', firstPass.driverReminders === 2 && firstPass.ownerReminders === 1, JSON.stringify(firstPass));
  const s1Doc = await Ride.findById(s1).lean();
  const s2Doc = await Ride.findById(s2).lean();
  const s3Doc = await Ride.findById(s3).lean();
  check('s1: both reminder flags set', Boolean(s1Doc.reminders?.pickup_sent_at) && Boolean(s1Doc.reminders?.owner_pickup_sent_at));
  check('s2 (acknowledged): driver flag set, owner flag not', Boolean(s2Doc.reminders?.pickup_sent_at) && !s2Doc.reminders?.owner_pickup_sent_at);
  check('s3 (2 days out): nothing sent', !s3Doc.reminders?.pickup_sent_at && !s3Doc.reminders?.owner_pickup_sent_at);
  const secondPass = await cron.sendScheduledRideReminders();
  check('Second pass sends nothing (exactly once)', secondPass.driverReminders === 0 && secondPass.ownerReminders === 0, JSON.stringify(secondPass));

  const reassignS1 = await api(`/drivers/network/rides/${s1}/reassign`, { method: 'POST', token: rameshToken, body: { driverId: String(ramesh._id) } });
  await freeDrivers();
  const s1AfterReassign = await Ride.findById(s1).lean();
  check('Reassign re-arms the reminders for the new driver', reassignS1.status === 200 && !s1AfterReassign.reminders?.pickup_sent_at && !s1AfterReassign.reminders?.owner_pickup_sent_at, JSON.stringify(s1AfterReassign.reminders));

  await resetRides();
  const nudgeNow = Date.now();
  const u1 = (await createRide({ assignTo: suresh._id })).json?.data?.id;
  const u2 = (await createRide({ assignTo: suresh._id })).json?.data?.id;
  const u3 = (await createFarScheduledRide(suresh._id)).json?.data?.id;
  const u4 = (await createFarScheduledRide(suresh._id)).json?.data?.id;
  const u5 = (await createRide({ assignTo: suresh._id })).json?.data?.id;
  await api(`/drivers/network/rides/${u5}/acknowledge`, { method: 'POST', token: sureshToken });
  await moveRide(u1, { 'assignment.assigned_at': new Date(nudgeNow - minutes(11)) });
  await moveRide(u2, { 'assignment.assigned_at': new Date(nudgeNow - minutes(3)) });
  await moveRide(u3, { scheduledAt: new Date(nudgeNow + minutes(90)), 'assignment.assigned_at': new Date(nudgeNow - minutes(15)) });
  await moveRide(u4, { scheduledAt: new Date(nudgeNow + minutes(300)), 'assignment.assigned_at': new Date(nudgeNow - minutes(15)) });
  await moveRide(u5, { 'assignment.assigned_at': new Date(nudgeNow - minutes(20)) });

  const nudges = await cron.sendUnacknowledgedAssignmentNudges();
  check('Nudges: u1 (immediate, 11 min) + u3 (scheduled, inside 2 h) only', nudges.nudged === 2, JSON.stringify(nudges));
  const nudgeFlags = await Promise.all([u1, u2, u3, u4, u5].map(async (id) => Boolean((await Ride.findById(id).lean()).reminders?.unacknowledged_sent_at)));
  check('Flags: u1 + u3 set; u2 (too recent), u4 (5 h out), u5 (acknowledged) not', JSON.stringify(nudgeFlags) === JSON.stringify([true, false, true, false, false]), JSON.stringify(nudgeFlags));
  const nudgesAgain = await cron.sendUnacknowledgedAssignmentNudges();
  check('Second nudge pass sends nothing', nudgesAgain.nudged === 0, JSON.stringify(nudgesAgain));

  await FleetVehicle.deleteMany({ license_plate_number: { $in: ['MP09EX0001', 'MP09EX0002', 'MP09EX0003'] } });
  const makeVehicle = (plate, expiresAt) =>
    FleetVehicle.create({
      owner_id: ramesh.owner_id,
      service_location_id: ramesh.service_location_id,
      transport_type: 'taxi',
      car_brand: 'Tata', car_model: 'Nexon', car_color: 'White',
      license_plate_number: plate,
      usage_type: 'private',
      status: 'approved',
      active: true,
      documents: { rc: { secureUrl: 'https://example.test/rc.jpg', identifyNumber: plate, expiryDate: 'x', expiresAt: expiresAt.toISOString() } },
    });
  const vSoon = await makeVehicle('MP09EX0001', new Date(Date.now() + days(10)));
  const vFar = await makeVehicle('MP09EX0002', new Date(Date.now() + days(60)));
  const vLongGone = await makeVehicle('MP09EX0003', new Date(Date.now() - days(5)));

  const docs = await cron.sendVehicleDocumentExpiryReminders();
  check('Document reminder sent for the vehicle expiring in 10 days', docs.documentReminders >= 1, JSON.stringify(docs));
  const soonAfter = await FleetVehicle.findById(vSoon._id).lean();
  const farAfter = await FleetVehicle.findById(vFar._id).lean();
  const goneAfter = await FleetVehicle.findById(vLongGone._id).lean();
  check('Marked as notified for that expiry', soonAfter.document_expiry_notified?.rc === new Date(vSoon.documents.rc.expiresAt).toISOString());
  check('60 days out: not notified', !farAfter.document_expiry_notified?.rc);
  check('Expired 5 days ago: not notified', !goneAfter.document_expiry_notified?.rc);
  const docsAgain = await cron.sendVehicleDocumentExpiryReminders();
  check('Second pass: once per document + expiry', docsAgain.documentReminders === 0, JSON.stringify(docsAgain));
  const renewedExpiry = new Date(Date.now() + days(12));
  await FleetVehicle.updateOne({ _id: vSoon._id }, { $set: { 'documents.rc.expiresAt': renewedExpiry.toISOString() } });
  const docsRenewed = await cron.sendVehicleDocumentExpiryReminders();
  check('A changed expiry re-arms the reminder', docsRenewed.documentReminders === 1, JSON.stringify(docsRenewed));

  const maintenance = await cron.runNetworkMaintenance();
  check('runNetworkMaintenance runs the new jobs without error', !maintenance.error && !maintenance.pickupRemindersError && !maintenance.unacknowledgedNudgesError, JSON.stringify(maintenance));

  // =========================================================================
  console.log('\n=== §7. Scheduled-ride start window ===');
  await resetRides();
  const t1 = (await createFarScheduledRide(ramesh._id)).json?.data?.id;
  await moveRide(t1, { scheduledAt: new Date(Date.now() + minutes(180)) });

  const tooEarlyArriving = await api(`/rides/${t1}/status`, { method: 'PATCH', token: rameshToken, body: { status: 'arriving' } });
  check('arriving 3 h early -> 409 TOO_EARLY_TO_START', tooEarlyArriving.status === 409 && tooEarlyArriving.json?.code === 'TOO_EARLY_TO_START', JSON.stringify(tooEarlyArriving.json));
  check('...with a readable message', /scheduled for later/i.test(tooEarlyArriving.json?.message || ''), tooEarlyArriving.json?.message);
  const t1Doc = await Ride.findById(t1).lean();
  const expectedOpens = new Date(t1Doc.scheduledAt).getTime() - minutes(30);
  check('...and details.starts_at = scheduledAt - 30 min', Math.abs(new Date(tooEarlyArriving.json?.details?.starts_at).getTime() - expectedOpens) < 2000, JSON.stringify(tooEarlyArriving.json?.details));
  const tooEarlyStarted = await api(`/rides/${t1}/status`, { method: 'PATCH', token: rameshToken, body: { status: 'started' } });
  check('started 3 h early -> 409 TOO_EARLY_TO_START', tooEarlyStarted.status === 409 && tooEarlyStarted.json?.code === 'TOO_EARLY_TO_START');
  check('The ride was not moved', (await Ride.findById(t1).lean()).liveStatus === 'accepted');

  const activeBefore = await api('/rides/active/me', { token: rameshToken });
  check('/rides/active/me does not return it before its window opens', activeBefore.status === 200 && activeBefore.json?.data === null, JSON.stringify(activeBefore.json?.data && activeBefore.json.data.rideId));

  await moveRide(t1, { scheduledAt: new Date(Date.now() + minutes(20)) });
  const activeInWindow = await api('/rides/active/me', { token: rameshToken });
  check('Inside the window it IS the active trip', String(activeInWindow.json?.data?.rideId || activeInWindow.json?.data?.id || activeInWindow.json?.data?._id) === t1, JSON.stringify(Object.keys(activeInWindow.json?.data || {})).slice(0, 120));
  const arrivingOk = await api(`/rides/${t1}/status`, { method: 'PATCH', token: rameshToken, body: { status: 'arriving' } });
  check('arriving inside the window: 200', arrivingOk.status === 200, JSON.stringify(arrivingOk.json));
  const arrivingRepeat = await api(`/rides/${t1}/status`, { method: 'PATCH', token: rameshToken, body: { status: 'arriving' } });
  check('Re-sending the same status is not refused', arrivingRepeat.status === 200);
  const startedOk = await api(`/rides/${t1}/status`, { method: 'PATCH', token: rameshToken, body: { status: 'started' } });
  check('started inside the window: 200', startedOk.status === 200, JSON.stringify(startedOk.json));

  await resetRides();
  const t2 = (await createFarScheduledRide(ramesh._id)).json?.data?.id;
  await moveRide(t2, { scheduledAt: new Date(Date.now() + minutes(100)) });
  const defaultWindow = await api(`/rides/${t2}/status`, { method: 'PATCH', token: rameshToken, body: { status: 'arriving' } });
  check('100 min out is too early with the default 30 min window', defaultWindow.status === 409 && defaultWindow.json?.code === 'TOO_EARLY_TO_START');
  await AdminBusinessSetting.updateOne({ scope: 'default' }, { $set: { 'transport_ride.scheduled_start_window_minutes': '120' } });
  const widened = await api(`/rides/${t2}/status`, { method: 'PATCH', token: rameshToken, body: { status: 'arriving' } });
  check('...but allowed once scheduled_start_window_minutes = 120', widened.status === 200, JSON.stringify(widened.json));
  await AdminBusinessSetting.updateOne({ scope: 'default' }, { $unset: { 'transport_ride.scheduled_start_window_minutes': '' } });

  await resetRides();
  const immediate = await createRide({ assignTo: ramesh._id });
  const immediateArriving = await api(`/rides/${immediate.json?.data?.id}/status`, { method: 'PATCH', token: rameshToken, body: { status: 'arriving' } });
  check('A non-scheduled ride is never blocked', immediateArriving.status === 200, JSON.stringify(immediateArriving.json));

  // =========================================================================
  console.log('\n=== §8. GET /drivers/referrals ===');
  await resetRides();
  await WalletTransaction.deleteMany({ driverId: ramesh._id, 'metadata.source': 'driver_referral' });
  await Driver.updateOne({ _id: suresh._id }, { $set: { referredBy: ramesh._id } });
  await Driver.updateOne({ _id: vikas._id }, { $set: { referredBy: ramesh._id } });
  const referralRide = (await createRide({ assignTo: suresh._id })).json?.data?.id;
  await Ride.updateOne({ _id: referralRide }, { $set: { status: 'completed', liveStatus: 'completed', completedAt: new Date() } });
  const txBase = { driverId: ramesh._id, type: 'adjustment', balanceBefore: 0, balanceAfter: 100, cashLimit: 0, isBlockedAfter: false };
  await WalletTransaction.create({ ...txBase, amount: 100, description: 'Referral reward', metadata: { source: 'driver_referral', referenceKey: 'driver-referral:signup:aaa:referrer' } });
  await WalletTransaction.create({ ...txBase, amount: 50, description: 'Welcome reward', metadata: { source: 'driver_referral', referenceKey: 'driver-referral:signup:bbb:new-driver' } });

  const referrals = await api('/drivers/referrals', { token: rameshToken });
  check('200 OK', referrals.status === 200, JSON.stringify(referrals.json));
  check('stats.total_referrals = 2', referrals.json?.data?.stats?.total_referrals === 2, JSON.stringify(referrals.json?.data?.stats));
  check('stats.rides_completed counts the referred drivers\' completed rides', referrals.json?.data?.stats?.rides_completed === 1);
  check('stats.total_earned = referrer-side credits only (100, not 150)', referrals.json?.data?.stats?.total_earned === 100);
  const referralResults = referrals.json?.data?.results || [];
  check('results: one row per referred driver', referralResults.length === 2);
  check('Row shape: name, joined_at, active, rides_completed', referralResults.every((row) => 'name' in row && 'joined_at' in row && typeof row.active === 'boolean' && typeof row.rides_completed === 'number'));
  check('Newest first', referralResults.length === 2 && new Date(referralResults[0].joined_at) >= new Date(referralResults[1].joined_at));
  const sureshRow = referralResults.find((row) => row.name === suresh.name);
  check('Suresh row: 1 completed ride, active', sureshRow?.rides_completed === 1 && sureshRow?.active === true, JSON.stringify(sureshRow));
  const nobody = await api('/drivers/referrals', { token: vikasToken });
  check('A driver with no referrals gets empty stats, not an error', nobody.status === 200 && nobody.json?.data?.stats?.total_referrals === 0 && nobody.json?.data?.results?.length === 0, JSON.stringify(nobody.json));
  await Driver.updateMany({ _id: { $in: [suresh._id, vikas._id] } }, { $set: { referredBy: null } });
  await WalletTransaction.deleteMany({ driverId: ramesh._id, 'metadata.source': 'driver_referral' });

  // =========================================================================
  console.log('\n=== §9. GET /drivers/ratings ===');
  await resetRides();
  const rated = [];
  for (let i = 0; i < 5; i += 1) rated.push((await createRide({ assignTo: ramesh._id })).json?.data?.id);
  const ratingPlan = [
    { rating: 5, comment: 'Very polite', ageMin: 50, user: rider._id },
    { rating: 5, comment: 'On time', ageMin: 40, user: rider._id },
    { rating: 4, comment: '', ageMin: 30, user: rider._id },
    { rating: 1, comment: 'Late', ageMin: 20, user: null },
    { rating: null, comment: '', ageMin: 10, user: rider._id },
  ];
  for (const [index, plan] of ratingPlan.entries()) {
    await Ride.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(rated[index]) },
      {
        $set: {
          status: 'completed',
          liveStatus: 'completed',
          userId: plan.user,
          feedback: plan.rating
            ? { rating: plan.rating, comment: plan.comment, tipAmount: 0, submittedAt: new Date(Date.now() - minutes(plan.ageMin)) }
            : { rating: null, comment: '', tipAmount: 0, submittedAt: null },
        },
      },
    );
  }

  const ratings = await api('/drivers/ratings', { token: rameshToken });
  check('200 OK', ratings.status === 200, JSON.stringify(ratings.json));
  check('total counts only rated rides (4 of 5)', ratings.json?.data?.total === 4, JSON.stringify(ratings.json?.data?.total));
  check('distribution = {5:2, 4:1, 3:0, 2:0, 1:1}', JSON.stringify(ratings.json?.data?.distribution) === JSON.stringify({ 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 }), JSON.stringify(ratings.json?.data?.distribution));
  const ratingResults = ratings.json?.data?.results || [];
  check('results newest first (Late -> 4 -> On time -> Very polite)', ratingResults.map((item) => item.comment).join('|') === 'Late||On time|Very polite', ratingResults.map((item) => item.comment).join('|'));
  check('Rider surname is masked ("Amit S.")', ratingResults.some((item) => item.rider_name === `${rider.name.split(' ')[0]} ${rider.name.split(' ').pop()[0]}.`), JSON.stringify(ratingResults.map((item) => item.rider_name)));
  check('No full surname leaks', !ratingResults.some((item) => item.rider_name.includes(rider.name.split(' ').pop())));
  check('A ride without a rider account falls back to "Rider"', ratingResults.some((item) => item.rider_name === 'Rider'));
  check('Row shape: rider_name, rating, comment, createdAt, service_type', ratingResults.every((item) => ['rider_name', 'rating', 'comment', 'createdAt', 'service_type'].every((key) => key in item)));
  const noRatings = await api('/drivers/ratings', { token: vikasToken });
  check('A driver with no reviews gets zeros', noRatings.status === 200 && noRatings.json?.data?.total === 0 && noRatings.json?.data?.distribution?.[5] === 0 && noRatings.json?.data?.results?.length === 0);

  // =========================================================================
  console.log('\n=== §10. Driver feedback on the rider: comment + tags ===');
  const feedbackRide = rated[0];
  const riderRated = await api(`/rides/${feedbackRide}/rider-rating`, {
    method: 'PATCH', token: rameshToken,
    body: { rating: 4, comment: '  Kept me waiting 10 min  ', tags: ['Polite', 'On time', 'Polite', '  '] },
  });
  check('200 OK', riderRated.status === 200, JSON.stringify(riderRated.json));
  const feedbackDoc = (await Ride.findById(feedbackRide).lean()).riderFeedback;
  check('rating stored', feedbackDoc.rating === 4);
  check('comment stored (trimmed)', feedbackDoc.comment === 'Kept me waiting 10 min', JSON.stringify(feedbackDoc));
  check('tags stored (deduped, blanks dropped)', JSON.stringify(feedbackDoc.tags) === JSON.stringify(['Polite', 'On time']), JSON.stringify(feedbackDoc.tags));
  const rerated = await api(`/rides/${feedbackRide}/rider-rating`, { method: 'PATCH', token: rameshToken, body: { rating: 5 } });
  check('A second rating is still refused (409)', rerated.status === 409);

  const plainRated = await api(`/rides/${rated[1]}/rider-rating`, { method: 'PATCH', token: rameshToken, body: { rating: 5 } });
  const plainDoc = (await Ride.findById(rated[1]).lean()).riderFeedback;
  check('rating alone still works (comment/tags optional)', plainRated.status === 200 && plainDoc.rating === 5 && plainDoc.comment === '' && plainDoc.tags.length === 0, JSON.stringify(plainDoc));

  const badTags = await api(`/rides/${rated[2]}/rider-rating`, { method: 'PATCH', token: rameshToken, body: { rating: 3, tags: 'Polite' } });
  check('tags that is not an array -> 400 INVALID_TAGS', badTags.status === 400 && badTags.json?.code === 'INVALID_TAGS', JSON.stringify(badTags.json));
  const longComment = await api(`/rides/${rated[3]}/rider-rating`, { method: 'PATCH', token: rameshToken, body: { rating: 3, comment: 'x'.repeat(900) } });
  check('An over-long comment is truncated, not refused', longComment.status === 200 && (await Ride.findById(rated[3]).lean()).riderFeedback.comment.length === 500);

  // =========================================================================
  console.log('\n=== §11. Feed item notes ===');
  const feedItem = serializeFeedItem(
    { _id: new mongoose.Types.ObjectId(), pickupAddress: 'Indore', dropAddress: 'Bhopal', network_notes: 'Persons: 2 • Luggage: 1 • Vehicle: SUV', publish: {}, offline_customer: { name: 'Raj Kumar' } },
    { lead_type: 'driver' },
  );
  check('serializeFeedItem exposes `notes`', feedItem.notes === 'Persons: 2 • Luggage: 1 • Vehicle: SUV', JSON.stringify(feedItem.notes));
  const noNotes = serializeFeedItem({ _id: new mongoose.Types.ObjectId(), publish: {}, offline_customer: {} }, { lead_type: 'driver' });
  check('`notes` is an empty string (not missing) when none were posted', noNotes.notes === '');

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
