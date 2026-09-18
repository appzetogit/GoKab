/**
 * IMPORTANT: every action here is driven through the HTTP API, never by calling
 * a service in this process. Socket emits happen inside the *server* process —
 * a service called locally would emit into a socket.io instance that was never
 * attached here, and every assertion would silently pass on nothing.
 *
 * Covers the spec §15 notification matrix and the response fields that were
 * previously missing: escrow settlement alerts (which is what makes the dispute
 * window discoverable), category change alerts, the vehicle-rule grace warning,
 * feed `area` fields, customer-lead earnings estimates and live-map ETA.
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
  (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data
    ?.token;

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
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { LeadContact } = await import('../src/modules/taxi/driver/models/LeadContact.js');
  const { LeadConversation } = await import('../src/modules/taxi/driver/models/LeadConversation.js');
  const { PrimeCitySlot } = await import('../src/modules/taxi/admin/models/PrimeCitySlot.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const categoryService = await import('../src/modules/taxi/services/driverCategoryService.js');
  const { updateRideLifecycle, updateRideDriverLocation, createRideRecord } = await import(
    '../src/modules/taxi/services/rideService.js'
  );
  const { getLiveMapSnapshot } = await import('../src/modules/taxi/services/liveMapService.js');

  const reset = async () => {
    await Promise.all([
      PrimeCitySlot.deleteMany({}),
      DriverSubscription.deleteMany({}),
      LeadContact.deleteMany({}),
      LeadConversation.deleteMany({}),
      Ride.deleteMany({}),
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
  const rider = await User.findOne({ phone: '9100000001' }).lean();

  const rameshToken = await loginDriver('9000000001');
  const vikasToken = await loginDriver('9000000003');
  const adminToken = await loginAdmin();
  check('Admin logs in', Boolean(adminToken));

  const primeTier = await SubscriptionTier.findOne({ driver_category: 'prime', is_active: true }).lean();

  console.log('\n=== 1. Category change reaches the driver ===');
  const rameshSocket = await connectSocket(rameshToken);
  await new Promise((resolve) => setTimeout(resolve, 400));

  const upgradeNotice = waitForEvent(rameshSocket, 'driver:category:updated');
  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, {
    method: 'PATCH',
    token: adminToken,
    body: { category: 'prime', reason: 'admin_override' },
  });

  const upgradePayload = await upgradeNotice;
  check('Driver is told about the upgrade', Boolean(upgradePayload), JSON.stringify(upgradePayload));
  check('...with the new category', upgradePayload?.category === 'prime', upgradePayload?.category);
  check('...and the previous one', upgradePayload?.previous_category === 'lower', upgradePayload?.previous_category);

  // The override has to grant the actual plan, not just the badge — otherwise
  // every permission check still resolves the driver as Lower.
  const grantedCategory = await api('/drivers/category', { token: rameshToken });
  check(
    'Override actually grants the category',
    grantedCategory.json?.data?.category === 'prime',
    grantedCategory.json?.data?.category,
  );
  check(
    '...along with its permissions',
    grantedCategory.json?.data?.permissions?.can_create_rides === true,
  );
  check('...and an expiry', Boolean(grantedCategory.json?.data?.expires_at));

  console.log('\n=== 2. Vehicle-rule grace warns the driver ===');
  const graceNotice = waitForEvent(rameshSocket, 'driver:category:grace');
  const commercial = await FleetVehicle.findOne({ license_plate_number: 'MP09CM0001' });
  await api(`/drivers/fleet/vehicles/${commercial._id}`, { method: 'DELETE', token: rameshToken });

  const gracePayload = await graceNotice;
  check('Driver is warned when the vehicle rule breaks', Boolean(gracePayload), JSON.stringify(gracePayload));
  check('...with a deadline', Boolean(gracePayload?.grace_ends_at));

  // Put the vehicle back so the rest of the run is unaffected.
  await FleetVehicle.create({
    owner_id: commercial.owner_id,
    service_location_id: commercial.service_location_id,
    transport_type: 'taxi',
    vehicle_type_id: commercial.vehicle_type_id,
    car_brand: commercial.car_brand,
    car_model: commercial.car_model,
    license_plate_number: 'MP09CM0001',
    car_color: commercial.car_color,
    usage_type: 'commercial',
    usage_type_verified: true,
    status: 'approved',
    active: true,
  });
  await categoryService.recheckCategoryVehicleRule(ramesh._id);

  console.log('\n=== 3. Downgrade is announced ===');
  const downgradeNotice = waitForEvent(rameshSocket, 'driver:category:updated');
  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, {
    method: 'PATCH',
    token: adminToken,
    body: { category: 'lower', reason: 'admin_override' },
  });
  const downgradePayload = await downgradeNotice;
  check('Driver is told about the downgrade', downgradePayload?.category === 'lower', JSON.stringify(downgradePayload));
  check('...with the reason', downgradePayload?.reason === 'admin_override', downgradePayload?.reason);

  rameshSocket.close();

  console.log('\n=== 4. Escrow settlement alerts both sides ===');
  await reset();
  const sub2 = await DriverSubscription.create({
    driver_id: ramesh._id,
    tier_id: primeTier._id,
    billing_cycle: 'monthly',
    start_date: new Date(Date.now() - 1000),
    end_date: new Date(Date.now() + 30 * 864e5),
    status: 'active',
  });
  await categoryService.applyCategoryFromSubscription({ subscription: sub2 });

  const created = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Notify Customer', phone: '9100000091' },
      pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
      drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
      fare: 5000,
    },
  });
  const rideId = created.json.data.id;
  await api(`/drivers/network/rides/${rideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  await api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: vikasToken });

  const publisherSocket = await connectSocket(rameshToken);
  const acceptorSocket = await connectSocket(vikasToken);
  await new Promise((resolve) => setTimeout(resolve, 400));

  const publisherSettled = waitForEvent(publisherSocket, 'escrow:settled');
  const acceptorSettled = waitForEvent(acceptorSocket, 'escrow:settled');
  const walletPing = waitForEvent(acceptorSocket, 'wallet:updated');

  const step = async (status, extra = {}) =>
    api(`/rides/${rideId}/status`, { method: 'PATCH', token: vikasToken, body: { status, ...extra } });
  await step('arriving');
  await step('started');
  await step('completed', { collectedBy: 'driver' });

  const pubPayload = await publisherSettled;
  const accPayload = await acceptorSettled;
  const walletPayload = await walletPing;

  check('Publisher is told the ride settled', Boolean(pubPayload), JSON.stringify(pubPayload));
  check('...with who collected the fare', pubPayload?.collected_by === 'driver', pubPayload?.collected_by);
  check('...and that they may dispute it', pubPayload?.can_dispute === true);
  check('...with the dispute deadline', Boolean(pubPayload?.dispute_until));
  check('Acceptor is told too', Boolean(accPayload), JSON.stringify(accPayload));
  check('...but cannot dispute', accPayload?.can_dispute === false);
  check('Wallet refresh is pushed', Boolean(walletPayload), JSON.stringify(walletPayload));

  console.log('\n=== 5. Dispute and resolution are announced ===');
  const disputeNotice = waitForEvent(acceptorSocket, 'escrow:disputed');
  await api(`/drivers/network/rides/${rideId}/escrow/dispute`, {
    method: 'POST',
    token: rameshToken,
    body: { reason: 'Customer paid me' },
  });
  const disputePayload = await disputeNotice;
  check('Acceptor is told about the dispute', Boolean(disputePayload), JSON.stringify(disputePayload));

  const resolvedNotice = waitForEvent(publisherSocket, 'escrow:resolved');
  await api(`/admin/driver-network/escrow/${rideId}/resolve`, {
    method: 'POST',
    token: adminToken,
    body: { collected_by: 'publisher' },
  });
  const resolvedPayload = await resolvedNotice;
  check('Both sides hear the resolution', resolvedPayload?.collected_by === 'publisher', JSON.stringify(resolvedPayload));

  publisherSocket.close();
  acceptorSocket.close();

  console.log('\n=== 6. Feed response carries area + earnings ===');
  await reset();
  const sub3 = await DriverSubscription.create({
    driver_id: ramesh._id,
    tier_id: primeTier._id,
    billing_cycle: 'monthly',
    start_date: new Date(Date.now() - 1000),
    end_date: new Date(Date.now() + 30 * 864e5),
    status: 'active',
  });
  await categoryService.applyCategoryFromSubscription({ subscription: sub3 });

  const feedRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Area Customer', phone: '9100000092' },
      pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
      drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
      fare: 5000,
    },
  });
  await api(`/drivers/network/rides/${feedRide.json.data.id}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });

  const driverFeed = await api('/drivers/feed?tab=driver', { token: vikasToken });
  const driverItem = (driverFeed.json?.data?.results || [])[0];
  check('Pickup area extracted', driverItem?.pickup?.area === 'Vijay Nagar', driverItem?.pickup?.area);
  check('Drop area extracted', driverItem?.drop?.area === 'MP Nagar', driverItem?.drop?.area);

  await createRideRecord({
    userId: rider._id,
    pickupCoords: INDORE,
    dropCoords: [75.9, 22.75],
    pickupAddress: 'Palasia, Indore',
    dropAddress: 'Rau, Indore',
    fare: 400,
    vehicleTypeId: ramesh.vehicleTypeId,
    paymentMethod: 'cash',
    service_location_id: ramesh.service_location_id,
  });

  const customerFeed = await api('/drivers/feed?tab=customer', { token: vikasToken });
  const customerItem = (customerFeed.json?.data?.results || [])[0];
  check('Customer lead is listed', Boolean(customerItem), JSON.stringify(customerFeed.json?.data?.results?.length));
  check(
    'Customer lead shows estimated earnings',
    typeof customerItem?.amount_for_you === 'number' && customerItem.amount_for_you > 0,
    String(customerItem?.amount_for_you),
  );
  check(
    'Earnings are net of commission (less than the fare)',
    customerItem?.amount_for_you < 400,
    `${customerItem?.amount_for_you} vs 400`,
  );

  console.log('\n=== 7. Live map reports an ETA ===');
  await reset();
  const sub4 = await DriverSubscription.create({
    driver_id: ramesh._id,
    tier_id: primeTier._id,
    billing_cycle: 'monthly',
    start_date: new Date(Date.now() - 1000),
    end_date: new Date(Date.now() + 30 * 864e5),
    status: 'active',
  });
  await categoryService.applyCategoryFromSubscription({ subscription: sub4 });

  const mapRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Map Customer', phone: '9100000093' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 4000,
    },
  });
  const mapRideId = mapRide.json.data.id;
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();
  await api(`/drivers/network/rides/${mapRideId}/assign`, {
    method: 'POST',
    token: rameshToken,
    body: { driverId: String(suresh._id) },
  });

  const beforeStart = await getLiveMapSnapshot(ramesh._id);
  check('No ETA before the trip starts', beforeStart.drivers[0]?.eta_minutes === null);

  await updateRideLifecycle({ rideId: mapRideId, driverId: suresh._id, nextStatus: 'arriving' });
  await updateRideLifecycle({ rideId: mapRideId, driverId: suresh._id, nextStatus: 'started' });
  await updateRideDriverLocation({
    rideId: mapRideId,
    driverId: suresh._id,
    coordinates: [76.5, 23.0],
  });

  const afterStart = await getLiveMapSnapshot(ramesh._id);
  const entry = afterStart.drivers.find((item) => item.rideId === mapRideId);
  check('ETA appears once running', typeof entry?.eta_minutes === 'number', String(entry?.eta_minutes));
  check('ETA is a sane number of minutes', entry?.eta_minutes > 0 && entry?.eta_minutes < 600, String(entry?.eta_minutes));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
};

run()
  .catch((error) => {
    console.error('Smoke run crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
