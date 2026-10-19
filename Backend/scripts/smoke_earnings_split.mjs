/**
 * Smoke test for the earnings split (plan §7.6).
 *
 *  1  escrow settlement tags commission/payout wallet rows with metadata.kind
 *  2  GET /drivers/earnings/summary — ride vs commission earnings, daily buckets
 *  3  GET /drivers/earnings/commissions — per-ride split, platform cut, offline rows
 *  4  range validation
 *
 * Scenario (all today, IST), publisher Ramesh (Prime), acceptor Vikas:
 *   A  secure publish 5000 = 2000 commission + 3000 payout, paid online,
 *      platform takes 10% of the commission → Ramesh nets 1800
 *   B  unsecure publish, same split, cash → Ramesh nets 2000 "settled offline"
 *   C  Ramesh drives his own 5000 ride → 5000 ride earnings, no commission
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs. Only touches rides it creates itself.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *     node scripts/smoke_earnings_split.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import mongoose from 'mongoose';
import { payRideAsRider } from './smoke_pay_ride_as_rider.mjs';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const INDORE = [75.8577, 22.7196];
const BHOPAL = [77.4126, 23.2599];
const TAG = `smoke-earnings-${Date.now()}`;

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
  const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
  const { AdminBusinessSetting } = await import('../src/modules/taxi/admin/models/AdminBusinessSetting.js');
  const { updateRideLifecycle } = await import('../src/modules/taxi/services/rideService.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();
  const originalSettings = await AdminBusinessSetting.findOne({ scope: 'default' }).select('driver_network').lean();
  const originalPercent = originalSettings?.driver_network?.platform_commission_on_published_rides_percent;

  const adminToken = await loginAdmin();
  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, { method: 'PATCH', token: adminToken, body: { category: 'prime' } });
  await AdminBusinessSetting.updateOne(
    { scope: 'default' },
    { $set: { 'driver_network.platform_commission_on_published_rides_percent': 10 } },
    { upsert: true },
  );
  await Driver.updateOne({ _id: ramesh._id }, { $set: { 'wallet.balance': 10000, 'wallet.frozenBalance': 0, isOnRide: false } });
  await Driver.updateOne({ _id: vikas._id }, { $set: { 'wallet.balance': 5000, 'wallet.frozenBalance': 0, isOnRide: false } });

  const rameshToken = await login('9000000001');
  const vikasToken = await login('9000000003');

  const createRide = async (paymentMethod) =>
    (await api('/drivers/network/rides', {
      method: 'POST',
      token: rameshToken,
      body: {
        // Online rides belong to an app customer: only they can pay the platform.
        customer: { name: 'Earnings Customer', phone: paymentMethod === 'online' ? '9100000001' : '9100000066' },
        pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
        drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
        fare: 5000,
        paymentMethod,
        notes: TAG,
      },
    })).json?.data?.id;

  const complete = async (rideId, driverId, args = {}) => {
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'arriving' });
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'started' });
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'completed', ...args });
  };

  const publishAndAccept = async (rideId, isSecure) => {
    await api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST',
      token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000, is_secure: isSecure },
    });
    return api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: vikasToken });
  };

  try {
    // Baselines, so the test works on a database that already has rides today.
    const before = (await api('/drivers/earnings/summary?range=today', { token: rameshToken })).json?.data;
    const vikasBefore = (await api('/drivers/earnings/summary?range=today', { token: vikasToken })).json?.data;
    check('summary works before the scenario', typeof before?.ride_earnings === 'number', JSON.stringify(before));

    const rideA = await createRide('online');
    const acceptA = await publishAndAccept(rideA, true);
    check('A accepted with escrow', acceptA.json?.data?.escrow === 'held', JSON.stringify(acceptA.json));
    await complete(rideA, vikas._id, { paymentMethod: 'online' });
    // A platform-collected ride settles only after the rider's payment.
    const paidA = await payRideAsRider({ api, rideId: rideA });
    check('A: rider paid in the app', paidA.status === 201, JSON.stringify(paidA.json).slice(0, 200));

    const rideB = await createRide('cash');
    const acceptB = await publishAndAccept(rideB, false);
    check('B accepted without escrow', acceptB.json?.data?.escrow === 'none', JSON.stringify(acceptB.json));
    await complete(rideB, vikas._id);

    const rideC = await createRide('cash');
    await api(`/drivers/network/rides/${rideC}/assign`, { method: 'POST', token: rameshToken, body: { driverId: String(ramesh._id) } });
    await complete(rideC, ramesh._id);

    console.log('\n1  Wallet rows are tagged');
    const commissionRow = await WalletTransaction.findOne({ rideId: rideA, driverId: ramesh._id, 'metadata.kind': 'owner_commission' }).lean();
    check('publisher credit tagged owner_commission', Boolean(commissionRow));
    check('...amount is commission minus 10% platform fee', commissionRow?.amount === 1800, String(commissionRow?.amount));
    check('...platformFee recorded', commissionRow?.metadata?.platformFee === 200);
    check('acceptor credit tagged driver_payout', Boolean(await WalletTransaction.exists({ rideId: rideA, driverId: vikas._id, 'metadata.kind': 'driver_payout' })));

    console.log('\n2  Summary');
    const after = (await api('/drivers/earnings/summary?range=today', { token: rameshToken })).json?.data;
    check('publisher ride earnings +5000 (own ride C)', after.ride_earnings - before.ride_earnings === 5000, `${before.ride_earnings} → ${after.ride_earnings}`);
    check('publisher commission +3800 (1800 A + 2000 B)', after.commission_earnings - before.commission_earnings === 3800, `${before.commission_earnings} → ${after.commission_earnings}`);
    check('total = ride + commission', after.total_earnings === after.ride_earnings + after.commission_earnings);
    check('commission_rides +2', after.commission_rides - before.commission_rides === 2);
    check('today has exactly one daily bucket', after.daily.length === 1, JSON.stringify(after.daily));
    check('daily bucket matches the totals', after.daily[0].commission_earnings === after.commission_earnings && after.daily[0].ride_earnings === after.ride_earnings);
    const vikasAfter = (await api('/drivers/earnings/summary?range=today', { token: vikasToken })).json?.data;
    check('acceptor ride earnings +6000 (3000 payout × 2)', vikasAfter.ride_earnings - vikasBefore.ride_earnings === 6000, `${vikasBefore.ride_earnings} → ${vikasAfter.ride_earnings}`);
    check('acceptor commission unchanged', vikasAfter.commission_earnings === vikasBefore.commission_earnings);
    const week = (await api('/drivers/earnings/summary', { token: rameshToken })).json?.data;
    check('default range is week with 7 daily buckets', week.range === 'week' && week.daily.length === 7, `${week.range}/${week.daily?.length}`);

    console.log('\n3  Commission list');
    const list = (await api('/drivers/earnings/commissions?range=today&limit=50', { token: rameshToken })).json?.data;
    const rowA = list?.results?.find((row) => row.ride_id === rideA);
    const rowB = list?.results?.find((row) => row.ride_id === rideB);
    check('own ride C is not a commission row', !list?.results?.some((row) => row.ride_id === rideC));
    check('A: split', rowA?.total_fare === 5000 && rowA?.driver_payout === 3000 && rowA?.owner_commission === 2000, JSON.stringify(rowA));
    check('A: platform_cut 200, net 1800', rowA?.platform_cut === 200 && rowA?.net_earned === 1800);
    check('A: secure, escrow settled by platform', rowA?.is_secure === true && rowA?.settlement === 'escrow' && rowA?.collected_by === 'platform');
    check('A: acceptor is Vikas', rowA?.acceptor?.id === String(vikas._id) && rowA?.acceptor?.name === vikas.name);
    check('B: unsecure, settled offline', rowB?.is_secure === false && rowB?.settlement === 'offline' && rowB?.settlement_label === 'Settled offline', JSON.stringify(rowB));
    check('B: no platform cut, net 2000', rowB?.platform_cut === 0 && rowB?.net_earned === 2000);
    check('totals.net_earned matches summary', list?.totals?.net_earned === after.commission_earnings, `${list?.totals?.net_earned} vs ${after.commission_earnings}`);
    const paged = (await api('/drivers/earnings/commissions?range=today&limit=1', { token: rameshToken })).json?.data;
    check('pagination limit respected', paged?.results?.length === 1 && paged?.pagination?.total === list?.pagination?.total);
    const vikasList = (await api('/drivers/earnings/commissions?range=today', { token: vikasToken })).json?.data;
    check('acceptor sees none of these as commission', !vikasList?.results?.some((row) => [rideA, rideB].includes(row.ride_id)));

    console.log('\n4  Range validation');
    const badRange = await api('/drivers/earnings/summary?range=year', { token: rameshToken });
    check('unknown range → 422 INVALID_RANGE', badRange.status === 422 && badRange.json?.code === 'INVALID_RANGE', JSON.stringify(badRange.json));
    const missingTo = await api('/drivers/earnings/summary?range=custom&from=2026-10-01', { token: rameshToken });
    check('custom without to → INVALID_DATE_RANGE', missingTo.json?.code === 'INVALID_DATE_RANGE');
    const backwards = await api('/drivers/earnings/summary?range=custom&from=2026-10-10&to=2026-10-01', { token: rameshToken });
    check('custom from > to → INVALID_DATE_RANGE', backwards.json?.code === 'INVALID_DATE_RANGE');
    const custom = (await api('/drivers/earnings/summary?range=custom&from=2026-10-01&to=2026-10-03', { token: rameshToken })).json?.data;
    check('custom bare dates include the to-day (3 buckets)', custom?.daily?.length === 3, JSON.stringify(custom?.daily?.map((d) => d.date)));
  } finally {
    const mine = await Ride.find({ network_notes: TAG }).select('_id').lean();
    await WalletTransaction.deleteMany({ rideId: { $in: mine.map((ride) => ride._id) } });
    await Ride.deleteMany({ network_notes: TAG });
    await AdminBusinessSetting.updateOne(
      { scope: 'default' },
      originalPercent === undefined
        ? { $unset: { 'driver_network.platform_commission_on_published_rides_percent': '' } }
        : { $set: { 'driver_network.platform_commission_on_published_rides_percent': originalPercent } },
    );
    await Driver.updateOne({ _id: ramesh._id }, { $set: { 'wallet.balance': ramesh.wallet?.balance || 0, 'wallet.frozenBalance': 0, isOnRide: false } });
    await Driver.updateOne({ _id: vikas._id }, { $set: { 'wallet.balance': vikas.wallet?.balance || 0, 'wallet.frozenBalance': 0, isOnRide: false } });
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
