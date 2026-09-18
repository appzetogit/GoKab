/**
 * Phase 5 + 6 + 7 smoke test: lead contact fees and chat, the owner live map's
 * OTP boundary, and the admin driver-network endpoints.
 *
 * Runs against a local backend + local database only.
 */

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4000/api/v1';
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

const loginAdmin = async () => {
  const { json } = await api('/admin/login', {
    method: 'POST',
    body: { email: 'admin@gmail.com', password: 'password' },
  });
  return json?.data?.token;
};

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { LeadContact } = await import('../src/modules/taxi/driver/models/LeadContact.js');
  const { LeadConversation } = await import('../src/modules/taxi/driver/models/LeadConversation.js');
  const { LeadMessage } = await import('../src/modules/taxi/driver/models/LeadMessage.js');
  const { PrimeCitySlot } = await import('../src/modules/taxi/admin/models/PrimeCitySlot.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { ServiceLocation } = await import('../src/modules/taxi/admin/models/ServiceLocation.js');
  const categoryService = await import('../src/modules/taxi/services/driverCategoryService.js');
  const { updateRideLifecycle, updateRideDriverLocation } = await import(
    '../src/modules/taxi/services/rideService.js'
  );
  const { getLiveMapSnapshot } = await import('../src/modules/taxi/services/liveMapService.js');

  // --- reset -----------------------------------------------------------
  await Promise.all([
    PrimeCitySlot.deleteMany({}),
    DriverSubscription.deleteMany({}),
    LeadContact.deleteMany({}),
    LeadConversation.deleteMany({}),
    LeadMessage.deleteMany({}),
    Ride.deleteMany({ origin: 'driver_created' }),
  ]);
  await Driver.updateMany(
    {},
    { $set: { driver_category: 'lower', isOnRide: false, 'wallet.frozenBalance': 0 } },
  );
  await Driver.updateOne({ phone: '9000000001' }, { $set: { 'wallet.balance': 20000 } });
  await Driver.updateOne({ phone: '9000000003' }, { $set: { 'wallet.balance': 5000 } });
  // Below the ₹20 customer-lead contact fee, so the refusal path is exercised.
  await Driver.updateOne({ phone: '9000000004' }, { $set: { 'wallet.balance': 5 } });

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();
  const mohan = await Driver.findOne({ phone: '9000000004' }).lean();

  const rameshToken = await loginDriver('9000000001');
  const vikasToken = await loginDriver('9000000003');
  const mohanToken = await loginDriver('9000000004');
  const adminToken = await loginAdmin();
  check('Admin logs in', Boolean(adminToken));

  const primeTier = await SubscriptionTier.findOne({ driver_category: 'prime', is_active: true }).lean();
  const subscription = await DriverSubscription.create({
    driver_id: ramesh._id,
    tier_id: primeTier._id,
    billing_cycle: 'monthly',
    start_date: new Date(Date.now() - 1000),
    end_date: new Date(Date.now() + 30 * 864e5),
    status: 'active',
  });
  await categoryService.applyCategoryFromSubscription({ subscription });

  const created = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Neha Verma', phone: '9100000055' },
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

  console.log('\n=== 1. Driver lead contact is free ===');
  const freeContact = await api(`/drivers/feed/rides/${rideId}/contact`, {
    method: 'POST',
    token: vikasToken,
    body: { channel: 'chat' },
  });
  check('Contact opened', freeContact.status === 200, JSON.stringify(freeContact.json));
  check('No fee for a driver-published lead', freeContact.json?.data?.fee_charged === 0);
  const conversationId = freeContact.json?.data?.conversation_id;
  check('Conversation created', Boolean(conversationId));
  check(
    'Wallet untouched',
    (await Driver.findById(vikas._id).lean()).wallet.balance === 5000,
  );

  console.log('\n=== 2. Chat works both ways ===');
  const sent = await api(`/drivers/lead-conversations/${conversationId}/messages`, {
    method: 'POST',
    token: vikasToken,
    body: { message: 'I can do this trip, leaving at 11.' },
  });
  check('Driver can post', sent.status === 201, JSON.stringify(sent.json));

  const replied = await api(`/drivers/lead-conversations/${conversationId}/messages`, {
    method: 'POST',
    token: rameshToken,
    body: { message: 'Good, pickup is Vijay Nagar.' },
  });
  check('Publisher can reply', replied.status === 201, JSON.stringify(replied.json));

  const thread = await api(`/drivers/lead-conversations/${conversationId}/messages`, {
    token: vikasToken,
  });
  check('Both messages are in the thread', thread.json?.data?.results?.length === 2, JSON.stringify(thread.json?.data?.results?.length));
  check(
    'Oldest first',
    thread.json?.data?.results?.[0]?.message === 'I can do this trip, leaving at 11.',
  );

  const outsider = await api(`/drivers/lead-conversations/${conversationId}/messages`, {
    method: 'POST',
    token: mohanToken,
    body: { message: 'Let me in' },
  });
  check('A non-participant cannot post', outsider.status === 403, String(outsider.status));

  const conversationList = await api('/drivers/lead-conversations', { token: vikasToken });
  check('Conversation appears in the list', conversationList.json?.data?.results?.length === 1);
  check(
    'List shows the last message',
    conversationList.json?.data?.results?.[0]?.last_message === 'Good, pickup is Vijay Nagar.',
  );

  console.log('\n=== 3. Call reveals the number ===');
  const call = await api(`/drivers/feed/rides/${rideId}/contact`, {
    method: 'POST',
    token: vikasToken,
    body: { channel: 'call' },
  });
  check('Call channel allowed after contact', call.status === 200, JSON.stringify(call.json));
  check('Number revealed', call.json?.data?.call?.phone === '9000000001', JSON.stringify(call.json?.data?.call));
  check('No second charge for the same ride', call.json?.data?.fee_charged === 0);
  check(
    'Still one contact row',
    (await LeadContact.countDocuments({ ride_id: rideId, requester_driver_id: vikas._id })) === 1,
  );

  console.log('\n=== 4. Customer lead is charged (Lower tier) ===');
  const customerRide = await Ride.create({
    userId: (await mongoose.connection.collection('taxiusers').findOne({ phone: '9100000001' }))._id,
    origin: 'customer_app',
    pickupLocation: { type: 'Point', coordinates: INDORE },
    pickupAddress: 'Palasia, Indore',
    dropLocation: { type: 'Point', coordinates: [75.9, 22.75] },
    dropAddress: 'Rau, Indore',
    fare: 300,
    otp: '4444',
    status: 'searching',
    liveStatus: 'searching',
    service_location_id: ramesh.service_location_id,
  });

  const poorContact = await api(`/drivers/feed/rides/${customerRide._id}/contact`, {
    method: 'POST',
    token: mohanToken,
    body: { channel: 'chat' },
  });
  check(
    'Driver without balance is refused',
    poorContact.json?.code === 'INSUFFICIENT_WALLET_FOR_CONTACT',
    JSON.stringify(poorContact.json),
  );
  check('Nothing charged on refusal', (await Driver.findById(mohan._id).lean()).wallet.balance === 5);

  const paidContact = await api(`/drivers/feed/rides/${customerRide._id}/contact`, {
    method: 'POST',
    token: vikasToken,
    body: { channel: 'chat' },
  });
  check('Customer lead contact charged ₹20', paidContact.json?.data?.fee_charged === 20, JSON.stringify(paidContact.json));
  check(
    'Wallet debited once',
    (await Driver.findById(vikas._id).lean()).wallet.balance === 4980,
    String((await Driver.findById(vikas._id).lean()).wallet.balance),
  );

  const secondContact = await api(`/drivers/feed/rides/${customerRide._id}/contact`, {
    method: 'POST',
    token: vikasToken,
    body: { channel: 'call' },
  });
  check('Second contact on the same ride is free', secondContact.json?.data?.fee_charged === 0);
  check(
    'Wallet unchanged on the second contact',
    (await Driver.findById(vikas._id).lean()).wallet.balance === 4980,
  );

  console.log('\n=== 5. Conversation closes when the ride is taken ===');
  await api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: vikasToken });
  const closedConversation = await LeadConversation.findById(conversationId).lean();
  check('Conversation closed', closedConversation.closed === true);

  const afterClose = await api(`/drivers/lead-conversations/${conversationId}/messages`, {
    method: 'POST',
    token: rameshToken,
    body: { message: 'still here?' },
  });
  check('Closed conversation rejects new messages', afterClose.status === 409, String(afterClose.status));
  check('...with CONVERSATION_CLOSED', afterClose.json?.code === 'CONVERSATION_CLOSED', JSON.stringify(afterClose.json));

  console.log('\n=== 6. Live map respects the OTP boundary ===');
  const beforeOtp = await getLiveMapSnapshot(ramesh._id);
  const beforeEntry = beforeOtp.drivers.find((item) => item.rideId === rideId);
  check('Ride is on the owner map', Boolean(beforeEntry), JSON.stringify(beforeOtp.drivers.map((d) => d.rideId)));
  check('Location withheld before the OTP', beforeEntry?.location === null, JSON.stringify(beforeEntry?.location));
  check('Status still visible', beforeEntry?.liveStatus === 'accepted', beforeEntry?.liveStatus);

  await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'arriving' });
  const duringArrival = await getLiveMapSnapshot(ramesh._id);
  check(
    'Still no location while only arriving',
    duringArrival.drivers.find((item) => item.rideId === rideId)?.location === null,
  );

  await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'started' });
  await updateRideDriverLocation({
    rideId,
    driverId: vikas._id,
    coordinates: [75.9, 22.8],
    heading: 90,
  });

  const afterOtp = await getLiveMapSnapshot(ramesh._id);
  const afterEntry = afterOtp.drivers.find((item) => item.rideId === rideId);
  check('Location shared once the trip starts', Array.isArray(afterEntry?.location), JSON.stringify(afterEntry?.location));
  check('Coordinates are the ones reported', afterEntry?.location?.[0] === 75.9);
  check('Relation identified as an outside acceptor', afterEntry?.relation === 'published_acceptor', afterEntry?.relation);

  const mapEndpoint = await api('/drivers/network/live-map', { token: rameshToken });
  check('Live map endpoint works', mapEndpoint.status === 200, JSON.stringify(mapEndpoint.json).slice(0, 200));

  console.log('\n=== 7. Admin: settings, slots and limits ===');
  const settings = await api('/admin/driver-network/settings', { token: adminToken });
  check('Settings readable', settings.status === 200, JSON.stringify(settings.json).slice(0, 150));
  check('Default prime_per_city is 5', settings.json?.data?.settings?.prime_per_city === 5);

  const patched = await api('/admin/driver-network/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { publish_expiry_minutes: 45, not_a_real_setting: 'x' },
  });
  check('Settings updated', patched.json?.data?.settings?.publish_expiry_minutes === 45);
  check('Unknown keys ignored', patched.json?.data?.settings?.not_a_real_setting === undefined);

  const slots = await api('/admin/driver-network/prime-slots', { token: adminToken });
  check('Prime slots listed', slots.json?.data?.results?.length === 1, String(slots.json?.data?.results?.length));
  check('Slot shows the driver', slots.json?.data?.results?.[0]?.driver?.phone === '9000000001');

  const tooLow = await api(`/admin/driver-network/cities/${ramesh.service_location_id}/prime-limit`, {
    method: 'PATCH',
    token: adminToken,
    body: { prime_limit: 0 },
  });
  check(
    'Cannot set a limit below current usage',
    tooLow.json?.code === 'LIMIT_BELOW_CURRENT_USAGE',
    JSON.stringify(tooLow.json),
  );

  const limitSet = await api(`/admin/driver-network/cities/${ramesh.service_location_id}/prime-limit`, {
    method: 'PATCH',
    token: adminToken,
    body: { prime_limit: 3 },
  });
  check('City limit set to 3', limitSet.json?.data?.limit === 3, JSON.stringify(limitSet.json));
  check('Two seats left', limitSet.json?.data?.left === 2);

  const routeLimit = await api(`/admin/driver-network/drivers/${mohan._id}/route-limit`, {
    method: 'PATCH',
    token: adminToken,
    body: { max_routes_override: 7 },
  });
  check('Route override saved', routeLimit.json?.data?.max_routes_override === 7);
  const mohanCategory = await api('/drivers/category', { token: mohanToken });
  check('Driver sees the raised limit', mohanCategory.json?.data?.permissions?.max_routes === 7, String(mohanCategory.json?.data?.permissions?.max_routes));

  console.log('\n=== 8. Admin: escrow monitor and reports ===');
  const escrow = await api('/admin/driver-network/escrow?state=held', { token: adminToken });
  check('Held escrow listed', escrow.json?.data?.results?.length === 1, String(escrow.json?.data?.results?.length));
  check('Total frozen reported', escrow.json?.data?.total_frozen === 5000, String(escrow.json?.data?.total_frozen));

  const leadContacts = await api('/admin/driver-network/lead-contacts', { token: adminToken });
  check('Lead contacts listed', leadContacts.json?.data?.results?.length === 2, String(leadContacts.json?.data?.results?.length));
  check('Contact revenue totalled', leadContacts.json?.data?.revenue === 20, String(leadContacts.json?.data?.revenue));

  const summary = await api('/admin/driver-network/reports/summary', { token: adminToken });
  check('Summary returns category counts', summary.json?.data?.drivers_by_category?.prime === 1, JSON.stringify(summary.json?.data?.drivers_by_category));
  check('Summary reports frozen total', summary.json?.data?.total_frozen_in_escrow === 5000, String(summary.json?.data?.total_frozen_in_escrow));

  const adminRides = await api('/admin/driver-network/rides?origin=driver_created', { token: adminToken });
  check('Network rides listed for admin', adminRides.json?.data?.results?.length >= 1);

  console.log('\n=== 9. Admin: category override and slot revoke ===');
  const revoke = await api(`/admin/driver-network/prime-slots/${slots.json.data.results[0].id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  check('Slot revoked', revoke.json?.data?.revoked === true, JSON.stringify(revoke.json));
  check('Driver downgraded to lower', (await Driver.findById(ramesh._id).lean()).driver_category === 'lower');
  check('Slot row removed', (await PrimeCitySlot.countDocuments({ driver_id: ramesh._id })) === 0);

  const override = await api(`/admin/driver-network/drivers/${ramesh._id}/category`, {
    method: 'PATCH',
    token: adminToken,
    body: { category: 'middle', reason: 'promo' },
  });
  check('Category overridden to middle', override.json?.data?.category === 'middle', JSON.stringify(override.json));
  check(
    'Driver record reflects it',
    (await Driver.findById(ramesh._id).lean()).driver_category === 'middle',
  );

  console.log('\n=== 10. Admin: vehicle usage type ===');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const vehicle = await FleetVehicle.findOne({ license_plate_number: 'MP09PV0001' }).lean();
  const usage = await api(`/admin/driver-network/vehicles/${vehicle._id}/usage-type`, {
    method: 'PATCH',
    token: adminToken,
    body: { usage_type: 'commercial', verified: true },
  });
  check('Usage type updated', usage.json?.data?.usage_type === 'commercial', JSON.stringify(usage.json));
  check('Marked verified', usage.json?.data?.usage_type_verified === true);
  await api(`/admin/driver-network/vehicles/${vehicle._id}/usage-type`, {
    method: 'PATCH',
    token: adminToken,
    body: { usage_type: 'private', verified: true },
  });

  console.log('\n=== 11. Admin permissions are enforced ===');
  const asDriver = await api('/admin/driver-network/settings', { token: rameshToken });
  check('A driver token cannot reach admin endpoints', asDriver.status === 403, String(asDriver.status));

  // Restore the default so re-runs start clean.
  await api('/admin/driver-network/settings', {
    method: 'PATCH',
    token: adminToken,
    body: { publish_expiry_minutes: 60 },
  });
  await ServiceLocation.updateOne({ _id: ramesh.service_location_id }, { $set: { prime_limit: null } });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
};

run()
  .catch((error) => {
    console.error('Smoke run crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
