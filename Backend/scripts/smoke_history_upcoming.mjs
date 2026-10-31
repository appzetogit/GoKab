/**
 * Smoke test for ride history filters and the upcoming-rides list.
 *
 *  1  GET /rides?status=completed|cancelled|all&role=driven|published|all (driver)
 *  2  published rows carry ride_role, driven_by, split, is_secure
 *  3  validation: INVALID_STATUS / INVALID_ROLE
 *  4  GET /drivers/rides/upcoming: accepted scheduled + network rides assigned to me
 *
 * Rides (all created by Ramesh, Prime; Suresh is in his fleet; Vikas is not):
 *   R1 unsecure publish → Vikas accepts → completed
 *   R2 cancelled before anyone took it
 *   R3 Ramesh drives it himself → completed
 *   R4 scheduled +2 days, assigned to Suresh
 *   R5 immediate, assigned to Suresh
 *   R6 scheduled +1 day, unsecure publish → Vikas accepts
 *   R7 emulated customer-app booking, scheduled +3 days, accepted by Vikas
 *   R8 emulated customer-app booking, immediate, accepted by Vikas (active, not upcoming)
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs. Only touches rides it creates itself.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *     node scripts/smoke_history_upcoming.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const INDORE = [75.8577, 22.7196];
const BHOPAL = [77.4126, 23.2599];
const TAG = `smoke-history-${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;

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
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
  const { updateRideLifecycle } = await import('../src/modules/taxi/services/rideService.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();
  const rider = await User.findOne({ phone: '9100000001' }).lean();

  const adminToken = await loginAdmin();
  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, { method: 'PATCH', token: adminToken, body: { category: 'prime' } });
  await Driver.updateMany({ _id: { $in: [ramesh._id, suresh._id, vikas._id] } }, { $set: { isOnRide: false, 'wallet.frozenBalance': 0 } });

  const rameshToken = await login('9000000001');
  const sureshToken = await login('9000000002');
  const vikasToken = await login('9000000003');

  const createRide = async ({ scheduledAt = null } = {}) => {
    const res = await api('/drivers/network/rides', {
      method: 'POST',
      token: rameshToken,
      body: {
        customer: { name: 'History Customer', phone: '9100000055' },
        pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
        drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
        fare: 5000,
        paymentMethod: 'cash',
        notes: TAG,
        ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString(), estimatedDurationMinutes: 60 } : {}),
      },
    });
    if (!res.json?.data?.id) throw new Error(`create failed: ${JSON.stringify(res.json)}`);
    return res.json.data.id;
  };
  const publishUnsecure = (rideId) =>
    api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST', token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000, is_secure: false },
    });
  const assign = (rideId, driverId) =>
    api(`/drivers/network/rides/${rideId}/assign`, { method: 'POST', token: rameshToken, body: { driverId: String(driverId) } });
  const complete = async (rideId, driverId) => {
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'arriving' });
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'started' });
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'completed' });
  };
  const history = async (token, query = '') => {
    const res = await api(`/rides?limit=100${query}`, { token });
    return { status: res.status, json: res.json, rows: res.json?.data?.results || [] };
  };
  const ids = (rows) => new Set(rows.map((row) => row.rideId));

  try {
    const r1 = await createRide();
    await publishUnsecure(r1);
    await api(`/drivers/feed/rides/${r1}/accept`, { method: 'POST', token: vikasToken });
    await complete(r1, vikas._id);

    const r2 = await createRide();
    await api(`/drivers/network/rides/${r2}/cancel`, { method: 'POST', token: rameshToken, body: { reason: 'Customer cancelled' } });

    const r3 = await createRide();
    await assign(r3, ramesh._id);
    await complete(r3, ramesh._id);

    const r4 = await createRide({ scheduledAt: new Date(Date.now() + 2 * DAY) });
    const a4 = await assign(r4, suresh._id);
    check('setup: R4 assigned to Suresh', a4.status === 200, JSON.stringify(a4.json));
    const r5 = await createRide();
    const a5 = await assign(r5, suresh._id);
    check('setup: R5 assigned to Suresh', a5.status === 200, JSON.stringify(a5.json));

    const r6 = await createRide({ scheduledAt: new Date(Date.now() + DAY) });
    await publishUnsecure(r6);
    const a6 = await api(`/drivers/feed/rides/${r6}/accept`, { method: 'POST', token: vikasToken });
    check('setup: R6 taken by Vikas', a6.status === 200, JSON.stringify(a6.json));

    // Customer-app bookings are emulated by rewriting fresh rides in place.
    const r7 = await createRide();
    const r8 = await createRide();
    const asCustomerBooking = (scheduledAt) => ({
      $set: {
        origin: 'customer_app', userId: rider._id, created_by_driver_id: null, driverId: vikas._id,
        status: 'accepted', liveStatus: 'accepted', acceptedAt: new Date(), scheduledAt,
      },
    });
    await Ride.updateOne({ _id: r7 }, asCustomerBooking(new Date(Date.now() + 3 * DAY)));
    await Ride.updateOne({ _id: r8 }, asCustomerBooking(null));

    console.log('\n1  History filters (publisher Ramesh)');
    const defaults = await history(rameshToken);
    check('default (= driven, all statuses) includes own ride R3', ids(defaults.rows).has(r3));
    check('default excludes rides others drove (R1)', !ids(defaults.rows).has(r1));
    const published = await history(rameshToken, '&role=published');
    const pub = ids(published.rows);
    check('role=published has R1, R2, R4, R5, R6', [r1, r2, r4, r5, r6].every((id) => pub.has(id)), [...pub].length);
    check('role=published excludes self-driven R3', !pub.has(r3));
    const pubCompleted = ids((await history(rameshToken, '&role=published&status=completed')).rows);
    check('published + completed = R1 only (of these)', pubCompleted.has(r1) && ![r2, r3, r4, r5, r6].some((id) => pubCompleted.has(id)));
    const pubCancelled = ids((await history(rameshToken, '&role=published&status=cancelled')).rows);
    check('published + cancelled = R2', pubCancelled.has(r2) && !pubCancelled.has(r1));
    const drivenCompleted = ids((await history(rameshToken, '&role=driven&status=completed')).rows);
    check('driven + completed = R3, not R1', drivenCompleted.has(r3) && !drivenCompleted.has(r1));
    const allCompleted = ids((await history(rameshToken, '&role=all&status=completed')).rows);
    check('all + completed = R1 and R3', allCompleted.has(r1) && allCompleted.has(r3) && !allCompleted.has(r2));
    const statusOnly = ids((await history(rameshToken, '&status=cancelled')).rows);
    check('status filter composes with default role (no R2: Ramesh did not drive it)', !statusOnly.has(r2));

    console.log('\n2  Row fields');
    const rowR1 = published.rows.find((row) => row.rideId === r1);
    check('R1 ride_role=published', rowR1?.ride_role === 'published', JSON.stringify(rowR1 && { ride_role: rowR1.ride_role }));
    check('R1 driven_by = Vikas', rowR1?.driven_by?.id === String(vikas._id) && rowR1?.driven_by?.name === vikas.name);
    check('R1 split 3000 / 2000', rowR1?.split?.driver_payout === 3000 && rowR1?.split?.owner_commission === 2000);
    check('R1 is_secure=false, origin driver_created', rowR1?.is_secure === false && rowR1?.origin === 'driver_created');
    const rowR3 = defaults.rows.find((row) => row.rideId === r3);
    check('R3 ride_role=driven, no driven_by', rowR3?.ride_role === 'driven' && rowR3?.driven_by === null);
    const vikasRows = (await history(vikasToken, '&status=completed')).rows;
    const vikasR1 = vikasRows.find((row) => row.rideId === r1);
    check('acceptor sees R1 as driven', vikasR1?.ride_role === 'driven');

    console.log('\n3  Validation');
    const badStatus = await history(rameshToken, '&status=finished');
    check('status=finished → 422 INVALID_STATUS', badStatus.status === 422 && badStatus.json?.code === 'INVALID_STATUS', JSON.stringify(badStatus.json));
    const badRole = await history(rameshToken, '&role=boss');
    check('role=boss → 422 INVALID_ROLE', badRole.status === 422 && badRole.json?.code === 'INVALID_ROLE', JSON.stringify(badRole.json));

    console.log('\n4  Upcoming');
    const sureshUp = await api('/drivers/rides/upcoming', { token: sureshToken });
    const sureshIds = (sureshUp.json?.data?.results || []).map((row) => row.id);
    check('Suresh: 200', sureshUp.status === 200, JSON.stringify(sureshUp.json).slice(0, 200));
    check('Suresh: has R4 (scheduled) and R5 (immediate)', sureshIds.includes(r4) && sureshIds.includes(r5));
    check('Suresh: immediate R5 listed before scheduled R4', sureshIds.indexOf(r5) < sureshIds.indexOf(r4));
    const rowR4 = sureshUp.json.data.results.find((row) => row.id === r4);
    check('R4 source=network, assigned_by Ramesh org', rowR4?.source === 'network' && rowR4?.assignment?.assigned_by?.driver_id === String(ramesh._id), JSON.stringify(rowR4?.assignment));
    check('R4 customer phone visible to the assigned driver', rowR4?.customer?.phone === '9100000055');
    check('R4 not overdue', rowR4?.is_overdue === false);

    const vikasUp = await api('/drivers/rides/upcoming', { token: vikasToken });
    const vikasUpRows = vikasUp.json?.data?.results || [];
    const vikasUpIds = vikasUpRows.map((row) => row.id);
    check('Vikas: has R6 (taken from feed) and R7 (scheduled booking)', vikasUpIds.includes(r6) && vikasUpIds.includes(r7));
    check('Vikas: excludes immediate customer booking R8', !vikasUpIds.includes(r8));
    check('Vikas: excludes completed R1', !vikasUpIds.includes(r1));
    const rowR6 = vikasUpRows.find((row) => row.id === r6);
    check('R6 amount_for_you = payout 3000, is_secure false', rowR6?.amount_for_you === 3000 && rowR6?.is_secure === false);
    const rowR7 = vikasUpRows.find((row) => row.id === r7);
    check('R7 source=scheduled, customer = app rider', rowR7?.source === 'scheduled' && rowR7?.customer?.name === rider.name && rowR7?.is_secure === null);
    check('R6 (+1d) before R7 (+3d)', vikasUpIds.indexOf(r6) < vikasUpIds.indexOf(r7));

    const rameshUp = await api('/drivers/rides/upcoming', { token: rameshToken });
    check('publisher does not see rides assigned to others', !(rameshUp.json?.data?.results || []).some((row) => [r4, r5, r6].includes(row.id)));

    await Ride.updateOne({ _id: r4 }, { $set: { scheduledAt: new Date(Date.now() - 60 * 1000) } });
    const overdue = (await api('/drivers/rides/upcoming', { token: sureshToken })).json?.data?.results?.find((row) => row.id === r4);
    check('past-due scheduled ride stays listed with is_overdue=true', overdue?.is_overdue === true);
  } finally {
    const mine = await Ride.find({ network_notes: TAG }).select('_id').lean();
    await WalletTransaction.deleteMany({ rideId: { $in: mine.map((ride) => ride._id) } });
    await Ride.deleteMany({ network_notes: TAG });
    await Driver.updateMany({ _id: { $in: [ramesh._id, suresh._id, vikas._id] } }, { $set: { isOnRide: false } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
