/**
 * Spec §23 QA checklist — the cases the phase suites did not already cover.
 *
 * Every assertion here maps to a checklist line, including the ones that are
 * easy to get wrong: per-city independence of the Prime cap, rollback when only
 * one side of an escrow can fund its hold, the publisher-collected settlement
 * direction, and the live map with a whole fleet out on rides.
 *
 * Runs against a local backend + local database only.
 */

import mongoose from 'mongoose';
// The backend does not depend on the client library, so borrow the copy the
// frontend already has rather than adding a dependency just for tests.
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

const loginDriver = async (phone) => {
  const { json } = await api('/drivers/login', {
    method: 'POST',
    body: { phone, password: 'password' },
  });
  return json?.data?.token;
};

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
  const { DriverRoute } = await import('../src/modules/taxi/driver/models/DriverRoute.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { LeadContact } = await import('../src/modules/taxi/driver/models/LeadContact.js');
  const { LeadConversation } = await import('../src/modules/taxi/driver/models/LeadConversation.js');
  const { PrimeCitySlot } = await import('../src/modules/taxi/admin/models/PrimeCitySlot.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { ServiceLocation } = await import('../src/modules/taxi/admin/models/ServiceLocation.js');
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
      DriverRoute.deleteMany({}),
      LeadContact.deleteMany({}),
      LeadConversation.deleteMany({}),
      Ride.deleteMany({}),
    ]);
    await Driver.updateMany(
      {},
      {
        $set: {
          driver_category: 'lower',
          route_mode: 'all_locations',
          active_route_id: null,
          max_routes_override: null,
          category_grace_ends_at: null,
          isOnRide: false,
          isOnline: true,
          'wallet.balance': 10000,
          'wallet.frozenBalance': 0,
          'wallet.isBlocked': false,
        },
      },
    );
    await User.updateMany({}, { $set: { currentRideId: null } });
  };

  const makePrime = async (driverId) => {
    const tier = await SubscriptionTier.findOne({ driver_category: 'prime', is_active: true }).lean();
    const subscription = await DriverSubscription.create({
      driver_id: driverId,
      tier_id: tier._id,
      billing_cycle: 'monthly',
      start_date: new Date(Date.now() - 1000),
      end_date: new Date(Date.now() + 30 * 864e5),
      status: 'active',
    });
    await categoryService.applyCategoryFromSubscription({ subscription });
    return subscription;
  };

  await reset();

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();
  const mohan = await Driver.findOne({ phone: '9000000004' }).lean();
  const rider = await User.findOne({ phone: '9100000001' }).lean();
  const indoreId = ramesh.service_location_id;
  const bhopal = await ServiceLocation.findOne({ name: 'Bhopal' }).lean();

  const rameshToken = await loginDriver('9000000001');
  const sureshToken = await loginDriver('9000000002');
  const vikasToken = await loginDriver('9000000003');

  // =====================================================================
  console.log('\n=== A. Prime cap is per city, not global ===');
  // =====================================================================
  for (let i = 0; i < 5; i += 1) {
    await categoryService.reservePrimeSlot({
      driverId: new mongoose.Types.ObjectId(),
      serviceLocationId: indoreId,
    });
  }
  const indoreUsage = await categoryService.getPrimeSlotUsage(indoreId);
  const bhopalUsage = await categoryService.getPrimeSlotUsage(bhopal._id);
  check('Indore is full', indoreUsage.left === 0, JSON.stringify(indoreUsage));
  check('Bhopal is untouched', bhopalUsage.left === 5, JSON.stringify(bhopalUsage));

  const bhopalClaim = await categoryService.reservePrimeSlot({
    driverId: new mongoose.Types.ObjectId(),
    serviceLocationId: bhopal._id,
  });
  check('A driver in Bhopal can still take Prime', Boolean(bhopalClaim));

  let indoreRefused = false;
  try {
    await categoryService.reservePrimeSlot({
      driverId: new mongoose.Types.ObjectId(),
      serviceLocationId: indoreId,
    });
  } catch (error) {
    indoreRefused = error.code === 'PRIME_SLOTS_FULL';
  }
  check('A sixth Indore applicant is still refused', indoreRefused);

  // =====================================================================
  console.log('\n=== B. Expiry keeps an in-flight ride alive ===');
  // =====================================================================
  await reset();
  const expiringSub = await makePrime(ramesh._id);

  const liveRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Ongoing Customer', phone: '9100000077' },
      pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
      drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
      fare: 4000,
    },
  });
  const liveRideId = liveRide.json.data.id;
  await api(`/drivers/network/rides/${liveRideId}/assign`, {
    method: 'POST',
    token: rameshToken,
    body: { driverId: String(suresh._id) },
  });

  await DriverSubscription.updateOne(
    { _id: expiringSub._id },
    { $set: { end_date: new Date(Date.now() - 1000) } },
  );
  const { processSubscriptionExpirations } = await import(
    '../src/modules/taxi/services/subscriptionCronService.js'
  );
  await processSubscriptionExpirations();

  const afterExpiry = await api('/drivers/category', { token: rameshToken });
  check('Owner drops to lower', afterExpiry.json?.data?.category === 'lower');
  check('Prime seat freed', (await PrimeCitySlot.countDocuments({ driver_id: ramesh._id })) === 0);

  const blockedCreate = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Nope', phone: '9100000078' },
      pickup: { coordinates: INDORE, address: 'a' },
      drop: { coordinates: BHOPAL, address: 'b' },
      fare: 100,
    },
  });
  check('Downgraded owner cannot create new rides', blockedCreate.json?.code === 'CATEGORY_NOT_ALLOWED');

  // The already-assigned ride must still run to completion.
  await updateRideLifecycle({ rideId: liveRideId, driverId: suresh._id, nextStatus: 'arriving' });
  await updateRideLifecycle({ rideId: liveRideId, driverId: suresh._id, nextStatus: 'started' });
  const completedAfterExpiry = await updateRideLifecycle({
    rideId: liveRideId,
    driverId: suresh._id,
    nextStatus: 'completed',
  });
  check(
    'The ride assigned before expiry still completes',
    completedAfterExpiry.status === 'completed',
    completedAfterExpiry.status,
  );

  // =====================================================================
  console.log('\n=== C. Breaking the vehicle rule starts a grace, then downgrades ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const beforeBreak = await api('/drivers/category', { token: rameshToken });
  check('Vehicle rule satisfied to begin with', beforeBreak.json?.data?.vehicle_rule?.ok === true);
  check('No grace running', beforeBreak.json?.data?.grace?.active === false);

  const commercial = await FleetVehicle.findOne({ license_plate_number: 'MP09CM0001' });
  await FleetVehicle.deleteOne({ _id: commercial._id });
  await categoryService.recheckCategoryVehicleRule(ramesh._id);

  const duringGrace = await api('/drivers/category', { token: rameshToken });
  check('Grace period starts', duringGrace.json?.data?.grace?.active === true, JSON.stringify(duringGrace.json?.data?.grace));
  check('Still Prime during grace', duringGrace.json?.data?.category === 'prime', duringGrace.json?.data?.category);

  await Driver.updateOne(
    { _id: ramesh._id },
    { $set: { category_grace_ends_at: new Date(Date.now() - 1000) } },
  );
  await categoryService.enforceCategoryGrace();

  const afterGrace = await Driver.findById(ramesh._id).lean();
  check('Downgraded after grace expires', afterGrace.driver_category === 'lower', afterGrace.driver_category);
  check('Prime seat released', (await PrimeCitySlot.countDocuments({ driver_id: ramesh._id })) === 0);

  // Restore the vehicle for the rest of the run.
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

  // =====================================================================
  console.log('\n=== D. Unassign is blocked once the trip is running ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const startedRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Started Customer', phone: '9100000079' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 3000,
    },
  });
  const startedRideId = startedRide.json.data.id;
  await api(`/drivers/network/rides/${startedRideId}/assign`, {
    method: 'POST',
    token: rameshToken,
    body: { driverId: String(suresh._id) },
  });

  const unassignBefore = await api(`/drivers/network/rides/${startedRideId}/unassign`, {
    method: 'POST',
    token: rameshToken,
    body: { reason: 'changed my mind' },
  });
  check('Unassign works before the trip starts', unassignBefore.status === 200, JSON.stringify(unassignBefore.json));

  await api(`/drivers/network/rides/${startedRideId}/assign`, {
    method: 'POST',
    token: rameshToken,
    body: { driverId: String(suresh._id) },
  });
  await updateRideLifecycle({ rideId: startedRideId, driverId: suresh._id, nextStatus: 'arriving' });
  await updateRideLifecycle({ rideId: startedRideId, driverId: suresh._id, nextStatus: 'started' });

  const unassignAfter = await api(`/drivers/network/rides/${startedRideId}/unassign`, {
    method: 'POST',
    token: rameshToken,
    body: { reason: 'too late' },
  });
  check('Unassign after OTP is refused', unassignAfter.status === 409, String(unassignAfter.status));
  check('...with RIDE_ALREADY_STARTED', unassignAfter.json?.code === 'RIDE_ALREADY_STARTED', JSON.stringify(unassignAfter.json));

  // =====================================================================
  console.log('\n=== E. Assignment notification payload ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const notifyRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Amit Sharma', phone: String(rider.phone) },
      pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
      drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
      fare: 4500,
    },
  });
  const notifyRideId = notifyRide.json.data.id;
  check('An app user is linked when the phone matches', notifyRide.json?.data?.customer?.is_app_user === true);

  const sureshSocket = await connectSocket(sureshToken);
  const driverNotice = waitForEvent(sureshSocket, 'network:ride:assigned');

  await api(`/drivers/network/rides/${notifyRideId}/assign`, {
    method: 'POST',
    token: rameshToken,
    body: { driverId: String(suresh._id) },
  });

  const driverPayload = await driverNotice;
  check('Assigned driver is notified over socket', Boolean(driverPayload), JSON.stringify(driverPayload));
  check('...with who assigned it', driverPayload?.assignedBy?.name === 'Ramesh Verma', JSON.stringify(driverPayload?.assignedBy));
  check('...with the organisation name', driverPayload?.assignedBy?.org_name === 'Ram Travels', driverPayload?.assignedBy?.org_name);
  check('...with the pickup address', driverPayload?.pickup?.address === 'Vijay Nagar, Indore', driverPayload?.pickup?.address);
  check('...with pickup coordinates', Array.isArray(driverPayload?.pickup?.coordinates) && driverPayload.pickup.coordinates.length === 2);
  check('...with the customer details', driverPayload?.customer?.name === 'Amit Sharma', JSON.stringify(driverPayload?.customer));
  check('...and the OTP', /^\d{4}$/.test(driverPayload?.otp || ''), driverPayload?.otp);

  const { buildNetworkRideContext } = await import(
    '../src/modules/taxi/services/networkNotificationService.js'
  );
  const context = await buildNetworkRideContext(await Ride.findById(notifyRideId));
  check('Customer-facing org name resolves', context.orgName === 'Ram Travels', context.orgName);
  check('Customer-facing owner name resolves', context.ownerName === 'Ramesh Verma', context.ownerName);
  check('Customer-facing driver name resolves', context.driverName === 'Suresh Kumar', context.driverName);
  check('Vehicle number present for the customer', Boolean(context.vehicleNumber), context.vehicleNumber);

  sureshSocket.close();

  // =====================================================================
  console.log('\n=== F. Customer tab lifecycle ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const customerRide = await createRideRecord({
    userId: rider._id,
    pickupCoords: INDORE,
    dropCoords: [75.9, 22.75],
    pickupAddress: 'Palasia, Indore',
    dropAddress: 'Rau, Indore',
    fare: 350,
    vehicleTypeId: ramesh.vehicleTypeId,
    paymentMethod: 'cash',
    service_location_id: indoreId,
  });

  const feedWithCustomer = await api('/drivers/feed?tab=customer', { token: vikasToken });
  const customerIds = (feedWithCustomer.json?.data?.results || []).map((item) => item.id);
  check('Customer booking appears in the Customer tab', customerIds.includes(String(customerRide._id)), customerIds.join(','));

  const customerItem = (feedWithCustomer.json?.data?.results || []).find(
    (item) => item.id === String(customerRide._id),
  );
  check('Customer phone is hidden before contact', !JSON.stringify(customerItem).includes(String(rider.phone)));
  check('Lead type is customer', customerItem?.lead_type === 'customer');

  const { acceptRideAssignment } = await import('../src/modules/taxi/services/rideService.js');
  await acceptRideAssignment({ rideId: customerRide._id, driverId: mohan._id });

  const feedAfterTaken = await api('/drivers/feed?tab=customer', { token: vikasToken });
  check(
    'It disappears once a driver takes it',
    !(feedAfterTaken.json?.data?.results || []).map((item) => item.id).includes(String(customerRide._id)),
  );

  // =====================================================================
  console.log('\n=== G. Escrow rolls back when one side cannot fund ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);
  await Driver.updateOne({ _id: vikas._id }, { $set: { 'wallet.balance': 1500 } });

  const rollbackRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Rollback Customer', phone: '9100000081' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
    },
  });
  const rollbackRideId = rollbackRide.json.data.id;
  await api(`/drivers/network/rides/${rollbackRideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });

  const poorAccept = await api(`/drivers/feed/rides/${rollbackRideId}/accept`, {
    method: 'POST',
    token: vikasToken,
  });
  check('Acceptor with ₹1500 is refused a ₹2000 hold', poorAccept.status === 402, String(poorAccept.status));
  check('...with INSUFFICIENT_WALLET', poorAccept.json?.code === 'INSUFFICIENT_WALLET', JSON.stringify(poorAccept.json));

  const rameshAfterRollback = await Driver.findById(ramesh._id).lean();
  const vikasAfterRollback = await Driver.findById(vikas._id).lean();
  const rideAfterRollback = await Ride.findById(rollbackRideId).lean();
  check('Nothing frozen for the publisher (rollback)', rameshAfterRollback.wallet.frozenBalance === 0, String(rameshAfterRollback.wallet.frozenBalance));
  check('Nothing frozen for the acceptor', vikasAfterRollback.wallet.frozenBalance === 0, String(vikasAfterRollback.wallet.frozenBalance));
  check('Ride stays unassigned', rideAfterRollback.driverId === null);
  check('Lead stays open on the feed', rideAfterRollback.publish.status === 'open', rideAfterRollback.publish.status);
  check('Escrow never opened', rideAfterRollback.escrow.state === 'none', rideAfterRollback.escrow.state);

  // =====================================================================
  console.log('\n=== H. Settlement when the publisher collected the cash ===');
  // =====================================================================
  await Driver.updateOne({ _id: vikas._id }, { $set: { 'wallet.balance': 5000 } });
  const takeIt = await api(`/drivers/feed/rides/${rollbackRideId}/accept`, {
    method: 'POST',
    token: vikasToken,
  });
  check('Acceptor with enough balance succeeds', takeIt.status === 200, JSON.stringify(takeIt.json));

  await updateRideLifecycle({ rideId: rollbackRideId, driverId: vikas._id, nextStatus: 'arriving' });
  await updateRideLifecycle({ rideId: rollbackRideId, driverId: vikas._id, nextStatus: 'started' });
  await updateRideLifecycle({
    rideId: rollbackRideId,
    driverId: vikas._id,
    nextStatus: 'completed',
    collectedBy: 'publisher',
  });

  const pubFinal = await Driver.findById(ramesh._id).lean();
  const accFinal = await Driver.findById(vikas._id).lean();
  check('Publisher pays out the driver share (-3000)', pubFinal.wallet.balance === 7000, String(pubFinal.wallet.balance));
  check('Acceptor receives it (+3000)', accFinal.wallet.balance === 8000, String(accFinal.wallet.balance));
  check('Publisher hold cleared', pubFinal.wallet.frozenBalance === 0);
  check('Acceptor hold cleared', accFinal.wallet.frozenBalance === 0);

  // =====================================================================
  console.log('\n=== I. Settlement when the fare was paid in the app ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const onlineRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Online Customer', phone: '9100000082' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
      paymentMethod: 'online',
    },
  });
  const onlineRideId = onlineRide.json.data.id;
  await api(`/drivers/network/rides/${onlineRideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  await api(`/drivers/feed/rides/${onlineRideId}/accept`, { method: 'POST', token: vikasToken });

  await updateRideLifecycle({ rideId: onlineRideId, driverId: vikas._id, nextStatus: 'arriving' });
  await updateRideLifecycle({ rideId: onlineRideId, driverId: vikas._id, nextStatus: 'started' });
  await updateRideLifecycle({ rideId: onlineRideId, driverId: vikas._id, nextStatus: 'completed' });

  const pubOnline = await Driver.findById(ramesh._id).lean();
  const accOnline = await Driver.findById(vikas._id).lean();
  const onlineSettled = await Ride.findById(onlineRideId).lean();
  check('Platform is recorded as the collector', onlineSettled.escrow.collected_by === 'platform', onlineSettled.escrow.collected_by);
  check('Publisher is credited the commission (+2000)', pubOnline.wallet.balance === 12000, String(pubOnline.wallet.balance));
  check('Acceptor is credited the payout (+3000)', accOnline.wallet.balance === 13000, String(accOnline.wallet.balance));
  check('Both holds cleared', pubOnline.wallet.frozenBalance === 0 && accOnline.wallet.frozenBalance === 0);

  // =====================================================================
  console.log('\n=== J. Completing an escrow ride needs a collector ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const needsChoice = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Choice Customer', phone: '9100000083' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
      paymentMethod: 'cash',
    },
  });
  const needsChoiceId = needsChoice.json.data.id;
  await api(`/drivers/network/rides/${needsChoiceId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  await api(`/drivers/feed/rides/${needsChoiceId}/accept`, { method: 'POST', token: vikasToken });
  await updateRideLifecycle({ rideId: needsChoiceId, driverId: vikas._id, nextStatus: 'arriving' });
  await updateRideLifecycle({ rideId: needsChoiceId, driverId: vikas._id, nextStatus: 'started' });

  let missingCollector = null;
  try {
    await updateRideLifecycle({ rideId: needsChoiceId, driverId: vikas._id, nextStatus: 'completed' });
  } catch (error) {
    missingCollector = error;
  }
  check('Completing a cash escrow ride without a collector is refused', missingCollector?.code === 'COLLECTED_BY_REQUIRED', missingCollector?.message);

  const stillRunning = await Ride.findById(needsChoiceId).lean();
  check('The ride is NOT marked completed by the refused attempt', stillRunning.status !== 'completed', stillRunning.status);
  check('Escrow is still held', stillRunning.escrow.state === 'held', stillRunning.escrow.state);

  // =====================================================================
  console.log('\n=== K. Live map with a whole fleet out ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const fleetDrivers = [];
  for (let i = 0; i < 4; i += 1) {
    const extra = await Driver.create({
      name: `Fleet Driver ${i + 1}`,
      phone: `9200${String(100000 + i).slice(-6)}`,
      password: '$2b$10$abcdefghijklmnopqrstuv',
      service_location_id: indoreId,
      zoneId: ramesh.zoneId,
      vehicleType: 'car',
      vehicleTypeId: ramesh.vehicleTypeId,
      vehicleNumber: `MP09FL${1000 + i}`,
      owner_id: ramesh.owner_id,
      approve: true,
      status: 'approved',
      isOnline: true,
      location: { type: 'Point', coordinates: INDORE },
      wallet: { balance: 5000, cashLimit: 500, isBlocked: false, frozenBalance: 0 },
    });
    fleetDrivers.push(extra);
  }
  const allFleet = [suresh, ...fleetDrivers];

  const fleetRideIds = [];
  for (const driver of allFleet) {
    const made = await api('/drivers/network/rides', {
      method: 'POST',
      token: rameshToken,
      body: {
        customer: { name: `Customer ${driver.name}`, phone: '9100000090' },
        pickup: { coordinates: INDORE, address: 'Indore' },
        drop: { coordinates: BHOPAL, address: 'Bhopal' },
        fare: 2000,
      },
    });
    const id = made.json.data.id;
    await api(`/drivers/network/rides/${id}/assign`, {
      method: 'POST',
      token: rameshToken,
      body: { driverId: String(driver._id) },
    });
    fleetRideIds.push({ id, driverId: driver._id });
  }

  const beforeAnyStart = await getLiveMapSnapshot(ramesh._id);
  check('All 5 fleet rides are on the map', beforeAnyStart.drivers.length === 5, String(beforeAnyStart.drivers.length));
  check('None expose a location yet', beforeAnyStart.drivers.every((item) => item.location === null));
  check('All are labelled as fleet', beforeAnyStart.drivers.every((item) => item.relation === 'fleet'));

  for (const entry of fleetRideIds) {
    await updateRideLifecycle({ rideId: entry.id, driverId: entry.driverId, nextStatus: 'arriving' });
    await updateRideLifecycle({ rideId: entry.id, driverId: entry.driverId, nextStatus: 'started' });
    await updateRideDriverLocation({
      rideId: entry.id,
      driverId: entry.driverId,
      coordinates: [75.86, 22.72],
    });
  }

  const afterAllStart = await getLiveMapSnapshot(ramesh._id);
  check('All 5 drivers now report a location', afterAllStart.drivers.every((item) => Array.isArray(item.location)), JSON.stringify(afterAllStart.drivers.map((d) => d.location)));
  check('Vehicle numbers included', afterAllStart.drivers.every((item) => Boolean(item.vehicleNumber)));

  // =====================================================================
  console.log('\n=== L. Live location throttling ===');
  // =====================================================================
  const rameshSocket = await connectSocket(rameshToken);
  await new Promise((resolve) => setTimeout(resolve, 400));

  const received = [];
  rameshSocket.on('org:live-location', (payload) => received.push(payload));

  // Driven through the driver's own socket, not by calling the service here:
  // an in-process call emits into a socket.io instance this script never
  // attached, so the assertion would pass on zero emits and prove nothing.
  const throttleEntry = fleetRideIds[0];
  const throttleDriver = await Driver.findById(throttleEntry.driverId).select('phone').lean();
  const movingSocket = await connectSocket(await loginDriver(throttleDriver.phone));
  await new Promise((resolve) => setTimeout(resolve, 400));
  movingSocket.emit('ride:join', { rideId: throttleEntry.id });
  await new Promise((resolve) => setTimeout(resolve, 400));

  // One update first, to prove the emit path works at all before asserting that
  // the rest of the burst is suppressed.
  movingSocket.emit('ride:driver-location:update', {
    rideId: throttleEntry.id,
    coordinates: [75.86, 22.72],
  });
  const firstEmit = await waitForEvent(rameshSocket, 'org:live-location', 5000);
  check('A location update does reach the owner map', Boolean(firstEmit), JSON.stringify(firstEmit));

  received.length = 0;
  for (let i = 1; i <= 6; i += 1) {
    movingSocket.emit('ride:driver-location:update', {
      rideId: throttleEntry.id,
      coordinates: [75.86 + i * 0.001, 22.72],
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));

  check(
    'A burst that follows within the interval is suppressed',
    received.length === 0,
    `${received.length} emits`,
  );
  movingSocket.close();
  rameshSocket.close();

  // =====================================================================
  console.log('\n=== M. Lead chat over sockets ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const chatRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Chat Customer', phone: '9100000084' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
    },
  });
  const chatRideId = chatRide.json.data.id;
  await api(`/drivers/network/rides/${chatRideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });

  const contact = await api(`/drivers/feed/rides/${chatRideId}/contact`, {
    method: 'POST',
    token: vikasToken,
    body: { channel: 'chat' },
  });
  const chatConversationId = contact.json.data.conversation_id;

  const publisherSocket = await connectSocket(rameshToken);
  const acceptorSocket = await connectSocket(vikasToken);

  const joined = new Promise((resolve) => publisherSocket.once('lead:joined', resolve));
  publisherSocket.emit('lead:join', { conversationId: chatConversationId });
  const joinAck = await Promise.race([joined, new Promise((r) => setTimeout(() => r(null), 4000))]);
  check('Publisher can join the lead room', Boolean(joinAck), JSON.stringify(joinAck));

  const incoming = waitForEvent(publisherSocket, 'lead:message:new');
  acceptorSocket.emit('lead:message:send', {
    conversationId: chatConversationId,
    message: 'Sending over socket',
    clientMessageId: 'c-1',
  });
  const socketMessage = await incoming;
  check('Message arrives over socket', socketMessage?.message === 'Sending over socket', JSON.stringify(socketMessage));
  check('Client message id echoed back', socketMessage?.clientMessageId === 'c-1');
  check('Sender role tagged', socketMessage?.senderRole === 'driver');

  const persisted = await api(`/drivers/lead-conversations/${chatConversationId}/messages`, {
    token: rameshToken,
  });
  check('Socket message is persisted', persisted.json?.data?.results?.length === 1, String(persisted.json?.data?.results?.length));

  const closeNotice = waitForEvent(publisherSocket, 'lead:closed');
  await api(`/drivers/feed/rides/${chatRideId}/accept`, { method: 'POST', token: vikasToken });
  const closePayload = await closeNotice;
  check('Room is told the conversation closed', closePayload?.reason === 'RIDE_TAKEN', JSON.stringify(closePayload));

  publisherSocket.close();
  acceptorSocket.close();

  // =====================================================================
  console.log('\n=== N. Feed socket events ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const watcherSocket = await connectSocket(vikasToken);
  await new Promise((resolve) => setTimeout(resolve, 400));

  const newLead = waitForEvent(watcherSocket, 'feed:driver:new');
  const socketRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Socket Customer', phone: '9100000085' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
    },
  });
  const socketRideId = socketRide.json.data.id;
  await api(`/drivers/network/rides/${socketRideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });

  const leadEvent = await newLead;
  check('Drivers in the city are told about a new lead', leadEvent?.rideId === socketRideId, JSON.stringify(leadEvent));
  check('Lead event carries the payout', leadEvent?.amount_for_you === 3000, String(leadEvent?.amount_for_you));

  const removedLead = waitForEvent(watcherSocket, 'feed:driver:removed');
  await api(`/drivers/network/rides/${socketRideId}/publish`, { method: 'DELETE', token: rameshToken });
  const removedEvent = await removedLead;
  check('Unpublishing removes it from the feed', removedEvent?.rideId === socketRideId, JSON.stringify(removedEvent));

  watcherSocket.close();

  // =====================================================================
  console.log('\n=== O. Dispute window closes ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const windowRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Window Customer', phone: '9100000086' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
    },
  });
  const windowRideId = windowRide.json.data.id;
  await api(`/drivers/network/rides/${windowRideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  await api(`/drivers/feed/rides/${windowRideId}/accept`, { method: 'POST', token: vikasToken });
  await updateRideLifecycle({ rideId: windowRideId, driverId: vikas._id, nextStatus: 'arriving' });
  await updateRideLifecycle({ rideId: windowRideId, driverId: vikas._id, nextStatus: 'started' });
  await updateRideLifecycle({
    rideId: windowRideId,
    driverId: vikas._id,
    nextStatus: 'completed',
    collectedBy: 'driver',
  });

  await Ride.updateOne(
    { _id: windowRideId },
    { $set: { 'escrow.dispute_until': new Date(Date.now() - 1000) } },
  );

  const lateDispute = await api(`/drivers/network/rides/${windowRideId}/escrow/dispute`, {
    method: 'POST',
    token: rameshToken,
    body: { reason: 'too late' },
  });
  check('A dispute after the window is refused', lateDispute.json?.code === 'DISPUTE_WINDOW_CLOSED', JSON.stringify(lateDispute.json));

  const { finalizeDisputeWindows } = await import(
    '../src/modules/taxi/services/networkCronService.js'
  );
  const finalized = await finalizeDisputeWindows();
  check('Cron finalises the settled record', finalized.finalized >= 1, JSON.stringify(finalized));
  check(
    'Dispute deadline cleared',
    (await Ride.findById(windowRideId).lean()).escrow.dispute_until === null,
  );

  // =====================================================================
  console.log('\n=== P. Orphaned escrow sweep ===');
  // =====================================================================
  await reset();
  await makePrime(ramesh._id);

  const orphanRide = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Orphan Customer', phone: '9100000087' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
    },
  });
  const orphanRideId = orphanRide.json.data.id;
  await api(`/drivers/network/rides/${orphanRideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  await api(`/drivers/feed/rides/${orphanRideId}/accept`, { method: 'POST', token: vikasToken });

  // Simulate a crash between "ride cancelled" and "escrow released".
  await Ride.updateOne(
    { _id: orphanRideId },
    { $set: { status: 'cancelled', liveStatus: 'cancelled', updatedAt: new Date(Date.now() - 2 * 3600 * 1000) } },
    { timestamps: false },
  );

  const frozenBeforeSweep = (await Driver.findById(ramesh._id).lean()).wallet.frozenBalance;
  check('Money is stranded before the sweep', frozenBeforeSweep === 3000, String(frozenBeforeSweep));

  const { releaseOrphanedEscrow } = await import(
    '../src/modules/taxi/services/networkCronService.js'
  );
  const sweep = await releaseOrphanedEscrow();
  check('Sweep releases the orphan', sweep.released === 1, JSON.stringify(sweep));
  check(
    'Publisher money is freed',
    (await Driver.findById(ramesh._id).lean()).wallet.frozenBalance === 0,
  );
  check(
    'Acceptor money is freed',
    (await Driver.findById(vikas._id).lean()).wallet.frozenBalance === 0,
  );

  // =====================================================================
  console.log('\n=== Q. Cleanup of synthetic fleet drivers ===');
  // =====================================================================
  const removed = await Driver.deleteMany({ phone: { $regex: '^9200' } });
  check('Synthetic drivers cleaned up', removed.deletedCount === 4, String(removed.deletedCount));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
};

run()
  .catch((error) => {
    console.error('Smoke run crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
