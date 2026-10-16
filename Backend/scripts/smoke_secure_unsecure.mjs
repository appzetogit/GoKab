/**
 * Smoke test for the Secure / Unsecure publish toggle (plan §7.1, §8.1).
 *
 *  1  secure publish still refuses an underfunded publisher (INSUFFICIENT_WALLET_FOR_PUBLISH)
 *  2  unsecure publish: no wallet check, split still enforced, forced to cash
 *  3  feed + network payloads expose is_secure; no hold required to accept
 *  4  unsecure accept: no escrow hold on either side
 *  5  completion: cash only, no wallet movement, no platform commission
 *  6  report: support ticket, no money moved, one per party
 *  7  fleet direct assign: no platform commission at completion
 *  8  secure publish → accept → settle still works (regression)
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs. Only touches rides it creates itself.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *     node scripts/smoke_secure_unsecure.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const INDORE = [75.8577, 22.7196];
const BHOPAL = [77.4126, 23.2599];
const TAG = `smoke-secure-${Date.now()}`;

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
  const { SupportTicket } = await import('../src/modules/taxi/support/models/SupportTicket.js');
  const { updateRideLifecycle } = await import('../src/modules/taxi/services/rideService.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();

  const adminToken = await loginAdmin();
  const category = await api(`/admin/driver-network/drivers/${ramesh._id}/category`, {
    method: 'PATCH', token: adminToken, body: { category: 'prime' },
  });
  check('setup: Ramesh is Prime', category.status === 200, JSON.stringify(category.json));

  const setWallets = (rameshBalance, vikasBalance) =>
    Promise.all([
      Driver.updateOne({ _id: ramesh._id }, { $set: { 'wallet.balance': rameshBalance, 'wallet.frozenBalance': 0, isOnRide: false } }),
      Driver.updateOne({ _id: vikas._id }, { $set: { 'wallet.balance': vikasBalance, 'wallet.frozenBalance': 0, isOnRide: false } }),
      Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: false } }),
    ]);
  const wallet = async (id) => (await Driver.findById(id).select('wallet').lean()).wallet;

  const rameshToken = await login('9000000001');
  const sureshToken = await login('9000000002');
  const vikasToken = await login('9000000003');

  const createRide = async (paymentMethod = 'cash') => {
    const res = await api('/drivers/network/rides', {
      method: 'POST',
      token: rameshToken,
      body: {
        customer: { name: 'Walk-in Customer', phone: '9100000077' },
        pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
        drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
        fare: 5000,
        paymentMethod,
        notes: TAG,
      },
    });
    return res.json?.data?.id;
  };

  const runToCompletion = async (rideId, driverId, completeArgs = {}) => {
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'arriving' });
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'started' });
    return updateRideLifecycle({ rideId, driverId, nextStatus: 'completed', ...completeArgs });
  };

  try {
    console.log('\n1  Secure publish, underfunded');
    await setWallets(100, 50);
    const rideId = await createRide('online');
    check('ride created', Boolean(rideId));
    const securePoor = await api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST', token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
    });
    check('secure publish refused with INSUFFICIENT_WALLET_FOR_PUBLISH', securePoor.json?.code === 'INSUFFICIENT_WALLET_FOR_PUBLISH', JSON.stringify(securePoor.json));
    check('...carrying required/available', securePoor.json?.details?.required === 3000 && securePoor.json?.details?.available === 100, JSON.stringify(securePoor.json?.details));

    console.log('\n2  Unsecure publish');
    const badSplit = await api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST', token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 2500, is_secure: false },
    });
    check('unsecure publish still enforces the split', badSplit.json?.code === 'INVALID_SPLIT', JSON.stringify(badSplit.json));
    const published = await api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST', token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000, is_secure: false },
    });
    check('unsecure publish succeeds with ₹100 in the wallet', published.status === 201, JSON.stringify(published.json));
    check('response is_secure=false', published.json?.data?.is_secure === false);
    const publishedDoc = await Ride.findById(rideId).lean();
    check('stored publish.is_secure=false', publishedDoc.publish.is_secure === false);
    check('payment forced to cash (was online)', publishedDoc.paymentMethod === 'cash', publishedDoc.paymentMethod);

    console.log('\n3  Payloads');
    const feed = await api('/drivers/feed?tab=driver', { token: vikasToken });
    const item = (feed.json?.data?.results || []).find((row) => row.id === rideId);
    check('feed item present', Boolean(item), JSON.stringify(feed.json).slice(0, 300));
    check('feed item is_secure=false', item?.is_secure === false);
    check('feed item payment_method=cash', item?.payment_method === 'cash');
    check('no hold required to accept', item?.accept?.hold_required === 0);
    check('accept allowed with ₹50 in the wallet', item?.accept?.allowed === true);
    const network = await api('/drivers/network/rides?status=published', { token: rameshToken });
    const networkRow = (network.json?.data?.results || []).find((row) => row.id === rideId);
    check('network ride publish.is_secure=false', networkRow?.publish?.is_secure === false, JSON.stringify(networkRow?.publish));

    console.log('\n4  Unsecure accept');
    const accepted = await api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: vikasToken });
    check('accepted', accepted.status === 200, JSON.stringify(accepted.json));
    check('escrow none, is_secure false', accepted.json?.data?.escrow === 'none' && accepted.json?.data?.is_secure === false);
    check('ride escrow state none', (await Ride.findById(rideId).lean()).escrow.state === 'none');
    check('publisher nothing frozen', Number((await wallet(ramesh._id)).frozenBalance || 0) === 0);
    check('acceptor nothing frozen', Number((await wallet(vikas._id)).frozenBalance || 0) === 0);

    console.log('\n5  Completion');
    await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'arriving' });
    await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'started' });
    let onlineError = null;
    try {
      await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'completed', paymentMethod: 'online' });
    } catch (error) {
      onlineError = error;
    }
    check('completing as online refused (UNSECURE_RIDE_CASH_ONLY)', onlineError?.code === 'UNSECURE_RIDE_CASH_ONLY', onlineError?.message);
    await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'completed' });
    const done = await Ride.findById(rideId).lean();
    check('ride completed without collected_by', done.status === 'completed');
    check('no wallet transactions for the ride', (await WalletTransaction.countDocuments({ rideId })) === 0);
    check('balances unchanged (100 / 50)', (await wallet(ramesh._id)).balance === 100 && (await wallet(vikas._id)).balance === 50);
    check('zero platform commission', done.commissionAmount === 0);
    check('acceptor earnings = agreed payout 3000', done.driverEarnings === 3000, String(done.driverEarnings));
    check('stamped settled', Boolean(done.walletSettledAt));

    console.log('\n6  Report');
    const stranger = await api(`/drivers/network/rides/${rideId}/report`, { method: 'POST', token: sureshToken, body: { reason: 'x' } });
    check('a third driver cannot report (403)', stranger.status === 403 && stranger.json?.code === 'NOT_RIDE_PARTY', JSON.stringify(stranger.json));
    const empty = await api(`/drivers/network/rides/${rideId}/report`, { method: 'POST', token: vikasToken, body: {} });
    check('reason required (422)', empty.json?.code === 'REASON_REQUIRED', JSON.stringify(empty.json));
    const report = await api(`/drivers/network/rides/${rideId}/report`, { method: 'POST', token: vikasToken, body: { reason: 'Publisher did not pay my share' } });
    check('acceptor report filed (201)', report.status === 201, JSON.stringify(report.json));
    check('money_moved=false', report.json?.data?.money_moved === false);
    const ticket = await SupportTicket.findOne({ ticketCode: report.json?.data?.ticketCode }).lean();
    check('support ticket exists', Boolean(ticket));
    check('ticket mentions the agreed split', /driver payout ₹3000/.test(ticket?.messages?.[0]?.message || ''));
    const again = await api(`/drivers/network/rides/${rideId}/report`, { method: 'POST', token: vikasToken, body: { reason: 'again' } });
    check('second report by same driver → 409 ALREADY_REPORTED', again.json?.code === 'ALREADY_REPORTED', JSON.stringify(again.json));
    const publisherReport = await api(`/drivers/network/rides/${rideId}/report`, { method: 'POST', token: rameshToken, body: { reason: 'Driver kept the cash' } });
    check('publisher can report too', publisherReport.status === 201, JSON.stringify(publisherReport.json));
    check('still no wallet transactions', (await WalletTransaction.countDocuments({ rideId })) === 0);

    console.log('\n7  Fleet direct assign (self)');
    await setWallets(1000, 50);
    const fleetRideId = await createRide('cash');
    const assigned = await api(`/drivers/network/rides/${fleetRideId}/assign`, { method: 'POST', token: rameshToken, body: { driverId: String(ramesh._id) } });
    check('self-assigned', assigned.status === 200, JSON.stringify(assigned.json));
    await runToCompletion(fleetRideId, ramesh._id);
    const fleetDone = await Ride.findById(fleetRideId).lean();
    check('completed', fleetDone.status === 'completed');
    check('no commission deduction transaction', (await WalletTransaction.countDocuments({ rideId: fleetRideId })) === 0);
    check('wallet unchanged (1000)', (await wallet(ramesh._id)).balance === 1000);
    check('earnings = full fare', fleetDone.driverEarnings === 5000 && fleetDone.commissionAmount === 0, `${fleetDone.driverEarnings}/${fleetDone.commissionAmount}`);
    // Paid online: the platform holds the fare, so the driver must be credited it.
    const onlineRideId = await createRide('online');
    await api(`/drivers/network/rides/${onlineRideId}/assign`, { method: 'POST', token: rameshToken, body: { driverId: String(ramesh._id) } });
    await runToCompletion(onlineRideId, ramesh._id, { paymentMethod: 'online' });
    const onlineCredit = await WalletTransaction.findOne({ rideId: onlineRideId }).lean();
    check('online fleet ride: driver credited the full fare (no commission)', onlineCredit?.type === 'ride_earning' && onlineCredit?.amount === 5000, JSON.stringify(onlineCredit));
    check('...wallet 1000 → 6000', (await wallet(ramesh._id)).balance === 6000, String((await wallet(ramesh._id)).balance));
    check('...exactly one wallet row (no double settlement)', (await WalletTransaction.countDocuments({ rideId: onlineRideId })) === 1);

    const secureReport = await api(`/drivers/network/rides/${fleetRideId}/report`, { method: 'POST', token: rameshToken, body: { reason: 'x' } });
    check('report on a non-unsecure ride → 409 NOT_UNSECURE_RIDE', secureReport.json?.code === 'NOT_UNSECURE_RIDE', JSON.stringify(secureReport.json));

    console.log('\n8  Secure publish regression');
    await setWallets(10000, 2500);
    const secureRideId = await createRide('cash');
    const securePublished = await api(`/drivers/network/rides/${secureRideId}/publish`, {
      method: 'POST', token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
    });
    check('publish without is_secure defaults to secure', securePublished.json?.data?.is_secure === true, JSON.stringify(securePublished.json));
    const secureAccept = await api(`/drivers/feed/rides/${secureRideId}/accept`, { method: 'POST', token: vikasToken });
    check('secure accept holds escrow', secureAccept.json?.data?.escrow === 'held', JSON.stringify(secureAccept.json));
    check('publisher payout frozen (3000)', (await wallet(ramesh._id)).frozenBalance === 3000);
    check('acceptor commission frozen (2000)', (await wallet(vikas._id)).frozenBalance === 2000);
    await runToCompletion(secureRideId, vikas._id, { collectedBy: 'driver' });
    check('publisher +2000 after settle', (await wallet(ramesh._id)).balance === 12000, String((await wallet(ramesh._id)).balance));
    check('acceptor -2000 after settle', (await wallet(vikas._id)).balance === 500, String((await wallet(vikas._id)).balance));
    check('escrow settled', (await Ride.findById(secureRideId).lean()).escrow.state === 'settled');
  } finally {
    const mine = await Ride.find({ network_notes: TAG }).select('_id').lean();
    await WalletTransaction.deleteMany({ rideId: { $in: mine.map((ride) => ride._id) } });
    await Ride.deleteMany({ network_notes: TAG });
    await setWallets(ramesh.wallet?.balance || 0, vikas.wallet?.balance || 0);
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
