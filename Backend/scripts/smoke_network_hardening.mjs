/**
 * The remaining spec details: a support ticket on dispute, refund handling when
 * a paid-for plan cannot be granted, the commercial-permit requirement,
 * subscription expiry reminders, the minimum publish lead time, and the
 * vehicle-mismatch flag on feed items.
 *
 * Actions that emit sockets are driven through the HTTP API, since emits happen
 * in the server process.
 *
 * Runs against a local backend + local database only.
 */

import mongoose from 'mongoose';

const { io: socketClient } = await import('../../frontend/node_modules/socket.io-client/build/cjs/index.js');

const API = process.env.SMOKE_API || 'http://127.0.0.1:4000/api/v1';
const SOCKET_URL = process.env.SMOKE_SOCKET || 'http://127.0.0.1:4000';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27031/gokab?replicaSet=rs0';

const INDORE = [75.8577, 22.7196];
const BHOPAL = [77.4126, 23.2599];

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
  return { status: response.status, json: await response.json().catch(() => ({})) };
};

const loginDriver = async (phone) =>
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

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { DriverNeededDocument } = await import('../src/modules/taxi/admin/models/DriverNeededDocument.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { PrimeCitySlot } = await import('../src/modules/taxi/admin/models/PrimeCitySlot.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { SubscriptionPayment } = await import('../src/modules/taxi/driver/models/SubscriptionPayment.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  const { SupportTicket } = await import('../src/modules/taxi/support/models/SupportTicket.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');

  const reset = async () => {
    await Promise.all([
      PrimeCitySlot.deleteMany({}),
      DriverSubscription.deleteMany({}),
      Ride.deleteMany({}),
      SupportTicket.deleteMany({ title: 'Escrow settlement dispute' }),
      SubscriptionPayment.deleteMany({}),
    ]);
    await Driver.updateMany(
      {},
      {
        $set: {
          driver_category: 'lower',
          category_grace_ends_at: null,
          isOnRide: false,
          isOnline: true,
          'wallet.balance': 20000,
          'wallet.frozenBalance': 0,
          'wallet.isBlocked': false,
        },
      },
    );
    await User.updateMany({}, { $set: { currentRideId: null } });
  };

  await reset();

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();
  const rameshToken = await loginDriver('9000000001');
  const vikasToken = await loginDriver('9000000003');
  const adminToken = await loginAdmin();

  const makePrime = async () =>
    api(`/admin/driver-network/drivers/${ramesh._id}/category`, {
      method: 'PATCH',
      token: adminToken,
      body: { category: 'prime' },
    });

  console.log('\n=== 1. Commercial permit document ===');
  const permit = await DriverNeededDocument.findOne({ slug: 'commercial_permit' }).lean();
  check('Permit template is seeded', Boolean(permit), 'run seed_driver_network_tiers.js');
  check('It is a document template', permit?.template_type === 'document');
  check('It tracks an expiry date', permit?.has_expiry_date === true);

  await makePrime();
  const withoutPermit = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: rameshToken,
    body: {
      make: 'Maruti',
      model: 'Ertiga',
      number: 'MP09TEST01',
      color: 'White',
      usage_type: 'commercial',
      documents: { rc: 'https://example.test/rc.jpg' },
    },
  });
  check(
    'A commercial vehicle without the permit is refused',
    withoutPermit.json?.code === 'COMMERCIAL_PERMIT_REQUIRED',
    JSON.stringify(withoutPermit.json),
  );

  const withPermit = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: rameshToken,
    body: {
      make: 'Maruti',
      model: 'Ertiga',
      number: 'MP09TEST01',
      color: 'White',
      usage_type: 'commercial',
      documents: { rc: 'https://example.test/rc.jpg', commercial_permit: 'https://example.test/permit.jpg' },
    },
  });
  check('With the permit it is accepted', withPermit.status === 201 || withPermit.status === 200, JSON.stringify(withPermit.json).slice(0, 200));

  const privateNoPermit = await api('/drivers/fleet/vehicles', {
    method: 'POST',
    token: rameshToken,
    body: {
      make: 'Maruti',
      model: 'Alto',
      number: 'MP09TEST02',
      color: 'Red',
      usage_type: 'private',
      documents: { rc: 'https://example.test/rc.jpg' },
    },
  });
  check(
    'A private vehicle still needs no permit',
    privateNoPermit.status === 201 || privateNoPermit.status === 200,
    JSON.stringify(privateNoPermit.json).slice(0, 200),
  );

  await FleetVehicle.deleteMany({ license_plate_number: { $in: ['MP09TEST01', 'MP09TEST02'] } });

  console.log('\n=== 2. Dispute opens a support ticket ===');
  await reset();
  await makePrime();

  const disputeRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Ticket Customer', phone: '9100000101' },
      pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
      drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
      fare: 5000,
    },
  });
  const disputeRideId = disputeRide.json.data.id;
  await api(`/drivers/network/rides/${disputeRideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  await api(`/drivers/feed/rides/${disputeRideId}/accept`, { method: 'POST', token: vikasToken });

  const step = async (status, extra = {}) =>
    api(`/rides/${disputeRideId}/status`, { method: 'PATCH', token: vikasToken, body: { status, ...extra } });
  await step('arriving');
  await step('started');
  await step('completed', { collectedBy: 'driver' });

  const disputed = await api(`/drivers/network/rides/${disputeRideId}/escrow/dispute`, {
    method: 'POST',
    token: rameshToken,
    body: { reason: 'Customer paid me directly' },
  });
  check('Dispute accepted', disputed.status === 200, JSON.stringify(disputed.json));
  check('A ticket code is returned', Boolean(disputed.json?.data?.ticketCode), JSON.stringify(disputed.json?.data));

  const ticket = await SupportTicket.findOne({ ticketCode: disputed.json?.data?.ticketCode }).lean();
  check('The ticket exists', Boolean(ticket));
  check('It is pending for an admin', ticket?.status === 'pending', ticket?.status);
  check('Raised by the publisher', String(ticket?.requesterId) === String(ramesh._id));
  check(
    'It records what was claimed',
    (ticket?.messages?.[0]?.message || '').includes('collected by "driver"'),
    ticket?.messages?.[0]?.message,
  );

  console.log('\n=== 3. Paid-for plan that cannot be granted is flagged for refund ===');
  await reset();

  // Fill every Prime seat so activation cannot succeed.
  const cityId = ramesh.service_location_id;
  for (let i = 0; i < 5; i += 1) {
    await PrimeCitySlot.create({
      service_location_id: cityId,
      slot_no: i + 1,
      driver_id: new mongoose.Types.ObjectId(),
      status: 'active',
    });
  }

  const primeTier = await SubscriptionTier.findOne({ driver_category: 'prime', is_active: true }).lean();
  const payment = await SubscriptionPayment.create({
    driver_id: vikas._id,
    tier_id: primeTier._id,
    billing_cycle: 'monthly',
    amount: 1999,
    currency: 'INR',
    razorpay_order_id: `order_test_${Date.now()}`,
    status: 'created',
  });

  const { subscriptionTierService } = await import(
    '../src/modules/taxi/services/subscriptionTierService.js'
  );

  let refundError = null;
  try {
    await subscriptionTierService.activateVerifiedSubscription({
      driverId: vikas._id,
      razorpay_order_id: payment.razorpay_order_id,
      razorpay_payment_id: 'pay_test',
      razorpay_signature: 'test',
    });
  } catch (error) {
    refundError = error;
  }

  check('Activation is refused', Boolean(refundError), 'expected a refusal');
  check('...with SUBSCRIPTION_REFUND_DUE', refundError?.code === 'SUBSCRIPTION_REFUND_DUE', refundError?.code);

  const refundedPayment = await SubscriptionPayment.findById(payment._id).lean();
  const refundedSub = await DriverSubscription.findOne({ driver_id: vikas._id }).lean();
  check('Payment is marked refund_due', refundedPayment?.status === 'refund_due', refundedPayment?.status);
  check('Subscription is pending_refund', refundedSub?.status === 'pending_refund', refundedSub?.status);
  check('Driver is NOT left as prime', (await Driver.findById(vikas._id).lean()).driver_category === 'lower');

  console.log('\n=== 4. Expiry reminders ===');
  await reset();
  await makePrime();

  const activeSub = await DriverSubscription.findOne({ driver_id: ramesh._id, status: 'active' });
  check('Admin grant created an active subscription', Boolean(activeSub));

  const rameshSocket = await connectSocket(rameshToken);
  await new Promise((resolve) => setTimeout(resolve, 400));

  // Move the end date into the "3 days out" window.
  await DriverSubscription.updateOne(
    { _id: activeSub._id },
    { $set: { end_date: new Date(Date.now() + 2.5 * 864e5), renewal_reminder_sent_for: null } },
  );

  const reminderNotice = waitForEvent(rameshSocket, 'driver:subscription:expiring');
  const { sendRenewalReminders } = await import(
    '../src/modules/taxi/services/subscriptionCronService.js'
  );
  // Called in-process, but the socket emit it triggers happens server-side via
  // the shared io instance only when the server runs it — so assert on the
  // database guard, and treat the socket payload as a bonus.
  const firstPass = await sendRenewalReminders();
  check('Reminder is sent once', firstPass.sent === 1, JSON.stringify(firstPass));

  const secondPass = await sendRenewalReminders();
  check('A second pass does not resend it', secondPass.sent === 0, JSON.stringify(secondPass));
  check(
    'The guard records which reminder went out',
    (await DriverSubscription.findById(activeSub._id).lean()).renewal_reminder_sent_for === 3,
  );

  await DriverSubscription.updateOne(
    { _id: activeSub._id },
    { $set: { suppress_renewal_reminders: true, end_date: new Date(Date.now() + 0.5 * 864e5), renewal_reminder_sent_for: null } },
  );
  const optedOut = await sendRenewalReminders();
  check('An opted-out driver gets nothing', optedOut.sent === 0, JSON.stringify(optedOut));

  await reminderNotice.catch(() => null);
  rameshSocket.close();

  console.log('\n=== 5. Minimum publish lead time ===');
  await reset();
  await makePrime();

  await api('/admin/driver-network/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { publish_min_lead_minutes: 120 },
  });

  const soonRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Soon Customer', phone: '9100000102' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    },
  });
  const tooSoon = await api(`/drivers/network/rides/${soonRide.json.data.id}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  check('A ride starting too soon cannot be published', tooSoon.json?.code === 'PUBLISH_TOO_LATE', JSON.stringify(tooSoon.json));

  const laterRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Later Customer', phone: '9100000103' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
      scheduledAt: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
    },
  });
  const inTime = await api(`/drivers/network/rides/${laterRide.json.data.id}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  check('A ride with enough notice publishes', inTime.status === 201, JSON.stringify(inTime.json));

  // An immediate (unscheduled) ride has no lead time to check.
  const nowRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Now Customer', phone: '9100000104' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
    },
  });
  const immediate = await api(`/drivers/network/rides/${nowRide.json.data.id}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  check('An immediate ride is unaffected by the rule', immediate.status === 201, JSON.stringify(immediate.json));

  await api('/admin/driver-network/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { publish_min_lead_minutes: 0 },
  });

  console.log('\n=== 6. Vehicle mismatch is flagged, not hidden ===');
  const otherVehicle = await Vehicle.findOne({ name: 'GoKab Auto' }).lean();
  await Ride.updateOne({ _id: nowRide.json.data.id }, { $set: { vehicleTypeId: otherVehicle._id } });

  const feed = await api('/drivers/feed?tab=driver', { token: vikasToken });
  const items = feed.json?.data?.results || [];
  const mismatched = items.find((item) => item.id === nowRide.json.data.id);
  const matched = items.find((item) => item.id === laterRide.json.data.id);

  check('A mismatched lead is still listed', Boolean(mismatched), items.map((i) => i.id).join(','));
  check('...and flagged', mismatched?.vehicle_mismatch === true, String(mismatched?.vehicle_mismatch));
  check('A matching lead is not flagged', matched?.vehicle_mismatch === false, String(matched?.vehicle_mismatch));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
};

run()
  .catch((error) => {
    console.error('Smoke run crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
