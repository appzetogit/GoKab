/**
 * Smoke test: the publisher of a driver-created ride can open it with
 * GET /rides/:rideId (read-only), and nothing more.
 *
 *  1  published, not taken yet, offline customer: publisher 200, unrelated driver 403
 *  2  after another driver takes it: publisher still 200 but without the
 *     rider–driver chat; the acceptor still 200 with it
 *  3  the publisher still cannot join the ride's socket room or post in its chat
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs and scripts/seed_driver_network_tiers.js.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 SMOKE_SOCKET=http://127.0.0.1:4101 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *     node scripts/smoke_publisher_ride_access.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import mongoose from 'mongoose';

const { io: socketClient } = await import('../../frontend/node_modules/socket.io-client/build/cjs/index.js');

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const SOCKET_URL = process.env.SMOKE_SOCKET || 'http://127.0.0.1:4101';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const TAG = `smoke-publisher-access-${Date.now()}`;

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

const api = async (urlPath, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
};

const login = async (phone) =>
  (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data?.token;

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

// Resolves with whichever of the two events arrives first (or 'timeout').
const firstOf = (socket, okEvent, timeoutMs = 4000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ event: 'timeout' }), timeoutMs);
    socket.once(okEvent, (payload) => {
      clearTimeout(timer);
      resolve({ event: okEvent, payload });
    });
    socket.once('errorMessage', (payload) => {
      clearTimeout(timer);
      resolve({ event: 'errorMessage', payload });
    });
  });

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();
  const adminToken = (await api('/admin/login', {
    method: 'POST', body: { email: 'admin@gmail.com', password: 'password' },
  })).json?.data?.token;
  for (const driver of [ramesh, vikas]) {
    await api(`/admin/driver-network/drivers/${driver._id}/category`, {
      method: 'PATCH', token: adminToken, body: { category: 'prime' },
    });
  }
  await Driver.updateMany(
    { _id: { $in: [ramesh._id, vikas._id] } },
    { $set: { 'wallet.balance': 20000, 'wallet.frozenBalance': 0, isOnRide: false } },
  );

  const rameshToken = await login('9000000001');
  const sureshToken = await login('9000000002');
  const vikasToken = await login('9000000003');
  let rameshSocket = null;

  try {
    const created = await api('/drivers/network/rides', {
      method: 'POST',
      token: rameshToken,
      body: {
        customer: { name: 'Walk-in Customer', phone: '9100000077' },
        pickup: { coordinates: [75.8577, 22.7196], address: 'Vijay Nagar, Indore' },
        drop: { coordinates: [77.4126, 23.2599], address: 'MP Nagar, Bhopal' },
        fare: 5000,
        paymentMethod: 'cash',
        notes: TAG,
      },
    });
    const rideId = created.json?.data?.id;
    const published = await api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST', token: rameshToken, body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
    });
    check('setup: ride published', published.status === 201, JSON.stringify(published.json));

    console.log('\n1  Published, not taken yet (offline customer)');
    const own = await api(`/rides/${rideId}`, { token: rameshToken });
    check('publisher gets 200', own.status === 200, JSON.stringify(own.json).slice(0, 200));
    check('...with the ride', own.json?.data?._id === rideId || own.json?.data?.id === rideId);
    check('...and no chat field', own.json?.data && !('messages' in own.json.data));
    const stranger = await api(`/rides/${rideId}`, { token: sureshToken });
    check('unrelated driver still gets 403', stranger.status === 403, JSON.stringify(stranger.json));
    const notTakenYet = await api(`/rides/${rideId}`, { token: vikasToken });
    check('a driver who has not taken it gets 403', notTakenYet.status === 403);

    console.log('\n2  After another driver takes it');
    const accepted = await api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: vikasToken });
    check('setup: accepted', accepted.status === 200, JSON.stringify(accepted.json));
    await Ride.updateOne(
      { _id: rideId },
      { $push: { messages: { senderRole: 'driver', senderId: vikas._id, message: 'On my way', sentAt: new Date() } } },
    );
    const ownAfter = await api(`/rides/${rideId}`, { token: rameshToken });
    check('publisher still gets 200', ownAfter.status === 200);
    check('publisher does not see the rider–driver chat', ownAfter.json?.data && !('messages' in ownAfter.json.data));
    const acceptorView = await api(`/rides/${rideId}`, { token: vikasToken });
    check('acceptor gets 200 with the chat', acceptorView.status === 200
      && Array.isArray(acceptorView.json?.data?.messages) && acceptorView.json.data.messages.length === 1);
    check('unrelated driver still 403', (await api(`/rides/${rideId}`, { token: sureshToken })).status === 403);

    console.log('\n3  Publisher stays out of the socket room and chat');
    rameshSocket = await connectSocket(rameshToken);
    const joinPromise = firstOf(rameshSocket, 'ride:joined');
    rameshSocket.emit('ride:join', { rideId });
    const join = await joinPromise;
    check('ride:join refused for the publisher', join.event === 'errorMessage', JSON.stringify(join));
    const sendPromise = firstOf(rameshSocket, 'ride:message:new');
    rameshSocket.emit('ride:message:send', { rideId, message: 'hello from the publisher' });
    const sent = await sendPromise;
    check('ride:message:send refused for the publisher', sent.event === 'errorMessage', JSON.stringify(sent));
    const messages = (await Ride.findById(rideId).lean()).messages || [];
    check('nothing was added to the chat', messages.length === 1, String(messages.length));
  } finally {
    rameshSocket?.close();
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
