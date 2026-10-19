/**
 * Smoke test for the driver-app backend gaps (P1–P6).
 *
 *  P1  network:ride:taken carries the acceptor's details
 *  P2  network:ride:expired reaches the publisher when the cron expires a lead
 *  P3  per-driver read state on GET /drivers/notifications, :id/read, read-all
 *  P4  GET /rides/active/me carries is_secure + escrow for driver-created rides
 *  P5  onboarding personal step hosts an optional profileImage
 *  P6  lead conversation list fields, sender names on lead:interest / lead:message:new
 *
 * Push delivery itself needs Firebase, so pushes are only exercised for not
 * throwing; their payloads are covered by reading the code.
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs and scripts/seed_driver_network_tiers.js.
 * Only touches rides, notifications and sessions it creates itself.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_SOCKET=http://127.0.0.1:4101 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *     node scripts/smoke_driver_app_gaps.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { payRideAsRider } from './smoke_pay_ride_as_rider.mjs';

const { io: socketClient } = await import('../../frontend/node_modules/socket.io-client/build/cjs/index.js');

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const SOCKET_URL = process.env.SMOKE_SOCKET || 'http://127.0.0.1:4101';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const INDORE = [75.8577, 22.7196];
const BHOPAL = [77.4126, 23.2599];
const TAG = `smoke-app-gaps-${Date.now()}`;
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

const waitForEvent = (socket, event, timeoutMs = 6000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const connectSocket = (token) =>
  new Promise((resolve, reject) => {
    const socket = socketClient(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
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

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { Notification } = await import('../src/modules/taxi/admin/promotions/models/Notification.js');
  const { NotificationRead } = await import('../src/modules/taxi/driver/models/NotificationRead.js');
  const { DriverRegistrationSession } = await import(
    '../src/modules/taxi/driver/models/DriverRegistrationSession.js'
  );
  const { updateRideLifecycle } = await import('../src/modules/taxi/services/rideService.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();

  const adminToken = await loginAdmin();
  for (const driver of [ramesh, vikas]) {
    const category = await api(`/admin/driver-network/drivers/${driver._id}/category`, {
      method: 'PATCH', token: adminToken, body: { category: 'prime' },
    });
    check(`setup: ${driver.name} is Prime`, category.status === 200, JSON.stringify(category.json));
  }
  await Driver.updateMany(
    { _id: { $in: [ramesh._id, vikas._id] } },
    { $set: { 'wallet.balance': 20000, 'wallet.frozenBalance': 0, isOnRide: false } },
  );

  const rameshToken = await login('9000000001');
  const vikasToken = await login('9000000003');
  const rameshSocket = await connectSocket(rameshToken);
  const vikasSocket = await connectSocket(vikasToken);

  const createAndPublish = async ({ phone = '9100000077', paymentMethod = 'cash' } = {}) => {
    const created = await api('/drivers/network/rides', {
      method: 'POST',
      token: rameshToken,
      body: {
        customer: { name: 'Walk-in Customer', phone },
        pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
        drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
        fare: 5000,
        paymentMethod,
        notes: TAG,
      },
    });
    const rideId = created.json?.data?.id;
    const published = await api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST', token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
    });
    check('setup: secure ride published', published.status === 201, JSON.stringify(published.json));
    return rideId;
  };

  try {
    console.log('\nP6  Lead conversations');
    const rideId = await createAndPublish();
    const interest = waitForEvent(rameshSocket, 'lead:interest');
    const contact = await api(`/drivers/feed/rides/${rideId}/contact`, {
      method: 'POST', token: vikasToken, body: { channel: 'chat' },
    });
    check('contact opened', contact.status === 200 || contact.status === 201, JSON.stringify(contact.json));
    const conversationId = contact.json?.data?.conversation_id;
    const interestPayload = await interest;
    check('lead:interest has conversationId + rideId', interestPayload?.conversationId === conversationId
      && interestPayload?.rideId === rideId, JSON.stringify(interestPayload));
    check('lead:interest has requester name', interestPayload?.name === vikas.name, JSON.stringify(interestPayload));
    check('lead:interest has sender object', interestPayload?.sender?.id === String(vikas._id)
      && interestPayload?.sender?.role === 'driver' && interestPayload?.sender?.name === vikas.name);

    const messageEvent = waitForEvent(rameshSocket, 'lead:message:new');
    const posted = await api(`/drivers/lead-conversations/${conversationId}/messages`, {
      method: 'POST', token: vikasToken, body: { message: 'Kitna time lagega?' },
    });
    check('message posted', posted.status === 200 || posted.status === 201, JSON.stringify(posted.json));
    const messagePayload = await messageEvent;
    check('lead:message:new has sender name', messagePayload?.sender?.name === vikas.name
      && messagePayload?.sender?.role === 'driver' && messagePayload?.sender?.id === String(vikas._id),
    JSON.stringify(messagePayload));

    const inbox = await api('/drivers/lead-conversations', { token: rameshToken });
    const row = (inbox.json?.data?.results || []).find((item) => item.id === conversationId);
    check('conversation listed', Boolean(row), JSON.stringify(inbox.json).slice(0, 300));
    check('ride_id present', row?.ride_id === rideId);
    check('unread_count = 1', row?.unread_count === 1, String(row?.unread_count));
    check('my_last_read_at present (null before opening)', row && 'my_last_read_at' in row && row.my_last_read_at === null);
    check('other_party is Vikas', row?.other_party?.role === 'driver' && row?.other_party?.id === String(vikas._id)
      && row?.other_party?.name === vikas.name, JSON.stringify(row?.other_party));
    check('other_party.profile_image is a string', typeof row?.other_party?.profile_image === 'string');
    check('ride.fare present', row?.ride?.fare === 5000, JSON.stringify(row?.ride));
    check('last_message', row?.last_message === 'Kitna time lagega?');

    await api(`/drivers/lead-conversations/${conversationId}/messages`, { token: rameshToken });
    const inboxAfter = await api('/drivers/lead-conversations', { token: rameshToken });
    const rowAfter = (inboxAfter.json?.data?.results || []).find((item) => item.id === conversationId);
    check('unread_count = 0 after opening the thread', rowAfter?.unread_count === 0, String(rowAfter?.unread_count));
    check('my_last_read_at set after opening', Boolean(rowAfter?.my_last_read_at));
    const vikasInbox = await api('/drivers/lead-conversations', { token: vikasToken });
    const vikasRow = (vikasInbox.json?.data?.results || []).find((item) => item.id === conversationId);
    check('sender does not count own message as unread', vikasRow?.unread_count === 0, String(vikasRow?.unread_count));
    check('sender sees the publisher as other_party', vikasRow?.other_party?.id === String(ramesh._id));

    console.log('\nP1  Publisher told when the ride is taken');
    const taken = waitForEvent(rameshSocket, 'network:ride:taken');
    const accepted = await api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: vikasToken });
    check('accepted', accepted.status === 200, JSON.stringify(accepted.json));
    const takenPayload = await taken;
    check('network:ride:taken keeps existing fields', takenPayload?.rideId === rideId
      && takenPayload?.driverId === String(vikas._id) && takenPayload?.held === 3000
      && takenPayload?.is_secure === true, JSON.stringify(takenPayload));
    check('network:ride:taken has acceptor', takenPayload?.acceptor?.id === String(vikas._id)
      && takenPayload?.acceptor?.name === vikas.name && takenPayload?.acceptor?.phone === vikas.phone
      && takenPayload?.acceptor?.vehicleNumber === (vikas.vehicleNumber || ''), JSON.stringify(takenPayload?.acceptor));

    console.log('\nP4  Escrow on the active ride');
    const active = await api('/rides/active/me', { token: vikasToken });
    const activeRide = active.json?.data;
    check('active ride is this ride', String(activeRide?.rideId || activeRide?.id || activeRide?._id) === rideId,
      JSON.stringify(activeRide).slice(0, 200));
    check('origin driver_created', activeRide?.origin === 'driver_created');
    check('is_secure true', activeRide?.is_secure === true);
    check('escrow held 3000 / 2000', activeRide?.escrow?.state === 'held'
      && activeRide?.escrow?.publisher_hold === 3000 && activeRide?.escrow?.acceptor_hold === 2000,
    JSON.stringify(activeRide?.escrow));
    const detail = await api(`/rides/${rideId}`, { token: vikasToken });
    check('GET /rides/:id carries escrow too', detail.json?.data?.escrow?.state === 'held'
      && detail.json?.data?.is_secure === true);
    let midTripRelabel = null;
    try {
      await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'arriving', paymentMethod: 'online' });
    } catch (error) {
      midTripRelabel = error;
    }
    check('payment method locked mid-trip: cash → online refused (PAYMENT_METHOD_LOCKED)',
      midTripRelabel?.code === 'PAYMENT_METHOD_LOCKED', midTripRelabel?.message);
    check('...and the ride stays cash', (await Ride.findById(rideId).lean()).paymentMethod === 'cash');
    await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'arriving' });
    await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'started' });
    let completeError = null;
    try {
      await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'completed' });
    } catch (error) {
      completeError = error;
    }
    check('completion without collectedBy still refused', completeError?.code === 'COLLECTED_BY_REQUIRED');
    check('...offering only publisher/driver for a cash offline-customer ride',
      JSON.stringify(completeError?.details?.options) === JSON.stringify(['publisher', 'driver']),
      JSON.stringify(completeError?.details));
    const completeWith = async (args) => {
      try {
        await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'completed', ...args });
        return null;
      } catch (error) {
        return error;
      }
    };
    const platformOnCash = await completeWith({ collectedBy: 'platform' });
    check('platform refused on a cash ride (PLATFORM_COLLECTION_NOT_ALLOWED)',
      platformOnCash?.code === 'PLATFORM_COLLECTION_NOT_ALLOWED', platformOnCash?.message);
    const platformRelabelled = await completeWith({ collectedBy: 'platform', paymentMethod: 'online' });
    check('relabelling the cash ride as online at completion refused (PAYMENT_METHOD_LOCKED)',
      platformRelabelled?.code === 'PAYMENT_METHOD_LOCKED', platformRelabelled?.message);
    const stillHeld = await Ride.findById(rideId).lean();
    check('refusals left the ride uncompleted with escrow held',
      stillHeld.status !== 'completed' && stillHeld.escrow.state === 'held');
    await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'completed', collectedBy: 'driver' });
    check('completes with collectedBy', (await Ride.findById(rideId).lean()).status === 'completed');

    console.log('\nPlatform payout waits for a verified payment');
    const { settlePaidPlatformEscrows, releaseOrphanedEscrow } = await import(
      '../src/modules/taxi/services/networkCronService.js'
    );
    const { settleAwaitingPlatformEscrow, releasePublishedRide } = await import(
      '../src/modules/taxi/driver/services/escrowService.js'
    );
    const wallet = async (id) => (await Driver.findById(id).select('wallet').lean()).wallet;
    const runOnlineRideToCompletion = async () => {
      const onlineRideId = await createAndPublish({ phone: '9100000001', paymentMethod: 'online' });
      const take = await api(`/drivers/feed/rides/${onlineRideId}/accept`, { method: 'POST', token: vikasToken });
      check('setup: online ride accepted with escrow', take.json?.data?.escrow === 'held', JSON.stringify(take.json));
      await updateRideLifecycle({ rideId: onlineRideId, driverId: vikas._id, nextStatus: 'arriving' });
      await updateRideLifecycle({ rideId: onlineRideId, driverId: vikas._id, nextStatus: 'started' });
      return onlineRideId;
    };

    const platformRideId = await runOnlineRideToCompletion();
    const beforeRamesh = await wallet(ramesh._id);
    const beforeVikas = await wallet(vikas._id);
    await updateRideLifecycle({ rideId: platformRideId, driverId: vikas._id, nextStatus: 'completed', collectedBy: 'platform' });
    const waiting = await Ride.findById(platformRideId).lean();
    check('ride completed, escrow still held', waiting.status === 'completed' && waiting.escrow.state === 'held');
    check('marked as waiting for the payment', Boolean(waiting.escrow.awaiting_platform_payment_since)
      && waiting.escrow.collected_by === 'platform');
    const afterCompleteRamesh = await wallet(ramesh._id);
    const afterCompleteVikas = await wallet(vikas._id);
    check('no money moved at completion', afterCompleteRamesh.balance === beforeRamesh.balance
      && afterCompleteVikas.balance === beforeVikas.balance
      && afterCompleteRamesh.frozenBalance === beforeRamesh.frozenBalance
      && afterCompleteVikas.frozenBalance === beforeVikas.frozenBalance);
    const listed = await api('/drivers/network/rides?status=completed&limit=50', { token: rameshToken });
    const listedRow = (listed.json?.data?.results || []).find((item) => item.id === platformRideId);
    check('network rides list shows awaiting_payment', listedRow?.escrow?.awaiting_payment === true,
      JSON.stringify(listedRow?.escrow));
    check('cron does not settle an unpaid ride', (await settlePaidPlatformEscrows()).platformSettled === 0);
    await Ride.updateOne(
      { _id: platformRideId },
      { $set: { 'driverPaymentCollection.status': 'paid', 'driverPaymentCollection.amount': 4999 } },
    );
    check('a payment short of the fare does not settle', (await settleAwaitingPlatformEscrow(platformRideId)) === null);
    await Ride.updateOne({ _id: platformRideId }, { $unset: { driverPaymentCollection: '' } });

    const riderPaid = await payRideAsRider({ api, rideId: platformRideId });
    check('rider pays in the app', riderPaid.status === 201, JSON.stringify(riderPaid.json).slice(0, 200));
    const settledRide = await Ride.findById(platformRideId).lean();
    check('escrow settled by the payment', settledRide.escrow.state === 'settled'
      && settledRide.escrow.awaiting_platform_payment_since === null && settledRide.escrow.collected_confirmed_by === 'system');
    const paidRamesh = await wallet(ramesh._id);
    const paidVikas = await wallet(vikas._id);
    check('acceptor credited the 3000 payout', paidVikas.balance - beforeVikas.balance === 3000,
      String(paidVikas.balance - beforeVikas.balance));
    check('publisher credited the commission', paidRamesh.balance > beforeRamesh.balance,
      String(paidRamesh.balance - beforeRamesh.balance));
    check('both holds released', paidRamesh.frozenBalance === beforeRamesh.frozenBalance - 3000
      && paidVikas.frozenBalance === beforeVikas.frozenBalance - 2000);
    check('settling again moves nothing', (await settleAwaitingPlatformEscrow(platformRideId)) === null);

    const sweptRideId = await runOnlineRideToCompletion();
    await updateRideLifecycle({ rideId: sweptRideId, driverId: vikas._id, nextStatus: 'completed', collectedBy: 'platform' });
    await Ride.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(sweptRideId) },
      { $set: { updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
    );
    await releaseOrphanedEscrow();
    check('orphan sweep leaves a ride waiting for payment alone',
      (await Ride.findById(sweptRideId).lean()).escrow.state === 'held');
    // The payment was saved but the settlement never ran (say, a restart).
    await Ride.updateOne(
      { _id: sweptRideId },
      { $set: { 'driverPaymentCollection.status': 'paid', 'driverPaymentCollection.amount': 5000, 'driverPaymentCollection.paidAt': new Date() } },
    );
    check('cron settles a paid ride it missed', (await settlePaidPlatformEscrows()).platformSettled === 1);
    check('...and it is settled', (await Ride.findById(sweptRideId).lean()).escrow.state === 'settled');

    const releasedRideId = await runOnlineRideToCompletion();
    await updateRideLifecycle({ rideId: releasedRideId, driverId: vikas._id, nextStatus: 'completed', collectedBy: 'platform' });
    await releasePublishedRide({ rideId: releasedRideId, reason: 'admin force release' });
    const releasedRide = await Ride.findById(releasedRideId).lean();
    check('a released escrow is no longer waiting', releasedRide.escrow.state === 'released'
      && releasedRide.escrow.awaiting_platform_payment_since === null);

    console.log('\nP2  Publisher told when the lead expires (waits for the 1-minute cron)');
    const expiringId = await createAndPublish();
    await Ride.updateOne({ _id: expiringId }, { $set: { 'publish.expires_at': new Date(Date.now() - 1000) } });
    const expired = await waitForEvent(rameshSocket, 'network:ride:expired', 75_000);
    check('network:ride:expired received', expired?.rideId === expiringId, JSON.stringify(expired));
    check('ride marked expired', (await Ride.findById(expiringId).lean()).publish.status === 'expired');

    console.log('\nP3  Notification read state');
    const [first, second] = await Notification.create([
      { service_location_id: ramesh.service_location_id, send_to: 'drivers', push_title: `${TAG} one`, message: 'one' },
      { service_location_id: ramesh.service_location_id, send_to: 'drivers', push_title: `${TAG} two`, message: 'two' },
    ]);
    const mine = (list) => (list.json?.data?.results || []).filter((item) => item.title.startsWith(TAG));
    const before = mine(await api('/drivers/notifications', { token: rameshToken }));
    check('both listed unread', before.length === 2 && before.every((item) => item.isRead === false && item.readAt === null),
      JSON.stringify(before));
    const read = await api(`/drivers/notifications/${first._id}/read`, { method: 'PATCH', token: rameshToken });
    check('mark one read', read.status === 200 && read.json?.data?.id === String(first._id) && Boolean(read.json?.data?.readAt),
      JSON.stringify(read.json));
    const readAgain = await api(`/drivers/notifications/${first._id}/read`, { method: 'PATCH', token: rameshToken });
    check('marking again keeps the first readAt', readAgain.json?.data?.readAt === read.json?.data?.readAt);
    const afterOne = mine(await api('/drivers/notifications', { token: rameshToken }));
    check('list shows one read, one unread',
      afterOne.find((item) => item.id === String(first._id))?.isRead === true
      && afterOne.find((item) => item.id === String(second._id))?.isRead === false);
    const vikasView = mine(await api('/drivers/notifications', { token: vikasToken }));
    check('read state is per driver', vikasView.every((item) => item.isRead === false), JSON.stringify(vikasView));
    const readAll = await api('/drivers/notifications/read-all', { method: 'PATCH', token: rameshToken });
    check('read-all reports newly read count >= 1', readAll.status === 200 && readAll.json?.data?.updated >= 1,
      JSON.stringify(readAll.json));
    const readAllAgain = await api('/drivers/notifications/read-all', { method: 'PATCH', token: rameshToken });
    check('read-all again updates 0', readAllAgain.json?.data?.updated === 0, JSON.stringify(readAllAgain.json));
    check('all read now', mine(await api('/drivers/notifications', { token: rameshToken })).every((item) => item.isRead));
    const badId = await api('/drivers/notifications/not-an-id/read', { method: 'PATCH', token: rameshToken });
    check('bad id → 404 NOTIFICATION_NOT_FOUND', badId.status === 404 && badId.json?.code === 'NOTIFICATION_NOT_FOUND',
      JSON.stringify(badId.json));
    const unknown = await api(`/drivers/notifications/${new mongoose.Types.ObjectId()}/read`, {
      method: 'PATCH', token: rameshToken,
    });
    check('unknown id → 404', unknown.status === 404);
    await NotificationRead.deleteMany({ notification_id: { $in: [first._id, second._id] } });
    await Notification.deleteMany({ _id: { $in: [first._id, second._id] } });

    console.log('\nP5  Profile photo at registration');
    const registrationId = `${TAG}-reg`;
    const newPhone = `98${String(Date.now()).slice(-8)}`;
    await DriverRegistrationSession.create({
      registrationId,
      phone: newPhone,
      role: 'driver',
      otpHash: crypto.createHash('sha256').update('0000').digest('hex'),
      otpExpiresAt: new Date(Date.now() + 600_000),
      otpVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const personalBody = { registrationId, phone: newPhone, fullName: 'Smoke Photo', email: 'smoke@example.com', gender: 'male' };
    const personalMethod = 'PATCH';
    const bad = await api('/drivers/onboarding/personal', {
      method: personalMethod, body: { ...personalBody, profileImage: 'https://example.com/x.png' },
    });
    check('plain URL refused (INVALID_PROFILE_IMAGE)', bad.json?.code === 'INVALID_PROFILE_IMAGE', JSON.stringify(bad.json));
    const saved = await api('/drivers/onboarding/personal', {
      method: personalMethod, body: { ...personalBody, profileImage: PNG_DATA_URL },
    });
    const storedUrl = saved.json?.data?.personal?.profileImage || '';
    check('data URL accepted and hosted', saved.status === 200 && /\/images\/drivers\/.+\.webp$/.test(storedUrl),
      JSON.stringify(saved.json).slice(0, 300));
    const sessionDoc = await DriverRegistrationSession.findOne({ registrationId }).lean();
    check('session keeps the hosted URL', sessionDoc?.personal?.profileImage === storedUrl);
    const echoed = await api('/drivers/onboarding/personal', {
      method: personalMethod, body: { ...personalBody, profileImage: storedUrl },
    });
    check('echoing the stored URL keeps it', echoed.json?.data?.personal?.profileImage === storedUrl);
    const omitted = await api('/drivers/onboarding/personal', { method: personalMethod, body: personalBody });
    check('omitting profileImage keeps it', omitted.json?.data?.personal?.profileImage === storedUrl);
    await DriverRegistrationSession.deleteOne({ registrationId });
  } finally {
    rameshSocket.close();
    vikasSocket.close();
    await Ride.deleteMany({ network_notes: TAG });
    await Driver.updateMany(
      { _id: { $in: [ramesh._id, vikas._id] } },
      { $set: { 'wallet.frozenBalance': 0, isOnRide: false } },
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
