/**
 * Phase 3 + 4 smoke test: driver-created rides, fleet assignment, publishing to
 * the network, the feed, and the full escrow lifecycle (hold → settle both
 * ways, release on cancel, dispute correction).
 *
 * Mirrors the worked example in the spec: fare 5000 = 2000 commission + 3000
 * payout, published by Ramesh (Prime) and taken by Vikas.
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

const login = async (phone) => {
  const { json } = await api('/drivers/login', {
    method: 'POST',
    body: { phone, password: 'password' },
  });
  return json?.data?.token;
};

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { DriverRoute } = await import('../src/modules/taxi/driver/models/DriverRoute.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { PrimeCitySlot } = await import('../src/modules/taxi/admin/models/PrimeCitySlot.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
  const categoryService = await import('../src/modules/taxi/services/driverCategoryService.js');
  const { updateRideLifecycle } = await import('../src/modules/taxi/services/rideService.js');

  // --- reset -----------------------------------------------------------
  await PrimeCitySlot.deleteMany({});
  await DriverSubscription.deleteMany({});
  await DriverRoute.deleteMany({});
  await Ride.deleteMany({ origin: 'driver_created' });
  await WalletTransaction.deleteMany({});
  await Driver.updateMany(
    {},
    {
      $set: {
        driver_category: 'lower',
        route_mode: 'all_locations',
        active_route_id: null,
        isOnRide: false,
        'wallet.frozenBalance': 0,
      },
    },
  );
  await Driver.updateOne({ phone: '9000000001' }, { $set: { 'wallet.balance': 10000 } });
  await Driver.updateOne({ phone: '9000000003' }, { $set: { 'wallet.balance': 2500 } });
  await Driver.updateOne({ phone: '9000000002' }, { $set: { 'wallet.balance': 2000 } });

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();

  const rameshToken = await login('9000000001');
  const sureshToken = await login('9000000002');
  const vikasToken = await login('9000000003');

  console.log('\n=== 1. Category gates ride creation ===');
  const asLower = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Amit Sharma', phone: '9100000001' },
      pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
      drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
      fare: 5000,
    },
  });
  check('Lower driver cannot create a ride', asLower.status === 403, String(asLower.status));
  check('...with CATEGORY_NOT_ALLOWED', asLower.json?.code === 'CATEGORY_NOT_ALLOWED', JSON.stringify(asLower.json));

  // Make Ramesh Prime.
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

  console.log('\n=== 2. Prime creates a ride for a walk-in customer ===');
  const created = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Rakesh Offline', phone: '9100000099' },
      pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
      drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
      fare: 5000,
      paymentMethod: 'cash',
      notes: '2 bags',
    },
  });
  check('Ride created', created.status === 201, JSON.stringify(created.json));
  const rideId = created.json?.data?.id;
  check('Customer is stored as offline (no app account)', created.json?.data?.customer?.is_app_user === false);
  check('OTP is masked in the response', created.json?.data?.otp_masked === '****');
  check('Starts unassigned', created.json?.data?.status === 'searching');

  const rideDoc = await Ride.findById(rideId).lean();
  check('Marked as driver_created', rideDoc.origin === 'driver_created');
  check('Has no userId', rideDoc.userId === null);
  check('Linked to the organisation', Boolean(rideDoc.organization_owner_id));
  check('Real OTP generated', /^\d{4}$/.test(rideDoc.otp || ''), rideDoc.otp);
  check('Dispatch was NOT started', rideDoc.driverId === null);

  console.log('\n=== 3. Assignment rules ===');
  const outsider = await api(`/drivers/network/rides/${rideId}/assign`, {
    method: 'POST',
    token: rameshToken,
    body: { driverId: String(vikas._id) },
  });
  check('Cannot assign to a driver outside the fleet', outsider.status === 403, String(outsider.status));
  check('...with DRIVER_NOT_IN_FLEET', outsider.json?.code === 'DRIVER_NOT_IN_FLEET', JSON.stringify(outsider.json));

  const assigned = await api(`/drivers/network/rides/${rideId}/assign`, {
    method: 'POST',
    token: rameshToken,
    body: { driverId: String(suresh._id) },
  });
  check('Assigned to own fleet driver', assigned.status === 200, JSON.stringify(assigned.json));
  check('Ride is accepted', assigned.json?.data?.status === 'accepted');
  check('Assignment mode is direct_assign', assigned.json?.data?.assignment?.mode === 'direct_assign');
  check(
    'Fleet driver marked on-ride',
    (await Driver.findById(suresh._id).lean()).isOnRide === true,
  );
  check(
    'No escrow for an in-house assignment',
    (await Ride.findById(rideId).lean()).escrow.state === 'none',
  );

  const doubleAssign = await api(`/drivers/network/rides/${rideId}/assign`, {
    method: 'POST',
    token: rameshToken,
    body: { driverId: String(ramesh._id) },
  });
  check('Cannot assign an already-assigned ride', doubleAssign.status === 409, String(doubleAssign.status));

  console.log('\n=== 4. Fleet driver declines ===');
  const rejected = await api(`/drivers/network/rides/${rideId}/reject-assignment`, {
    method: 'POST',
    token: sureshToken,
    body: { reason: 'Already booked' },
  });
  check('Assigned driver can decline', rejected.status === 200, JSON.stringify(rejected.json));
  check('Ride returns to searching', rejected.json?.data?.status === 'searching');
  check('Driver freed', (await Driver.findById(suresh._id).lean()).isOnRide === false);
  check(
    'History records the decline',
    (await Ride.findById(rideId).lean()).assignment.history.length === 2,
  );

  console.log('\n=== 5. Publishing ===');
  const badSplit = await api(`/drivers/network/rides/${rideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 2500 },
  });
  check('Split that does not add up is refused', badSplit.json?.code === 'INVALID_SPLIT', JSON.stringify(badSplit.json));

  const published = await api(`/drivers/network/rides/${rideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000, expires_in_minutes: 60 },
  });
  check('Ride published', published.status === 201, JSON.stringify(published.json));

  const publishedDoc = await Ride.findById(rideId).lean();
  check('Publish status open', publishedDoc.publish.status === 'open');
  check('Payout stored', publishedDoc.publish.driver_payout === 3000);
  check('Nothing frozen yet', (await Driver.findById(ramesh._id).lean()).wallet.frozenBalance === 0);

  console.log('\n=== 6. Feed visibility ===');
  const vikasFeed = await api('/drivers/feed?tab=driver', { token: vikasToken });
  const rameshFeed = await api('/drivers/feed?tab=driver', { token: rameshToken });
  const feedIds = (payload) => (payload.json?.data?.results || []).map((item) => item.id);

  check('Lead appears for another driver', feedIds(vikasFeed).includes(rideId), feedIds(vikasFeed).join(','));
  check('Publisher does not see their own lead', !feedIds(rameshFeed).includes(rideId));
  const leadItem = (vikasFeed.json?.data?.results || []).find((item) => item.id === rideId);
  check('Lead shows what the acceptor earns', leadItem?.amount_for_you === 3000, String(leadItem?.amount_for_you));
  check('Lead shows the hold required', leadItem?.accept?.hold_required === 2000, String(leadItem?.accept?.hold_required));
  check('Customer name is masked', /\*/.test(leadItem?.customer?.name_masked || ''), leadItem?.customer?.name_masked);
  check('Customer phone is not exposed', JSON.stringify(leadItem).includes('9100000099') === false);
  check('Publisher org name shown', leadItem?.publisher?.org_name === 'Ram Travels', leadItem?.publisher?.org_name);

  console.log('\n=== 7. Accepting freezes both sides ===');
  const accepted = await api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: vikasToken });
  check('Vikas accepts the lead', accepted.status === 200, JSON.stringify(accepted.json));

  const rameshAfterAccept = await Driver.findById(ramesh._id).lean();
  const vikasAfterAccept = await Driver.findById(vikas._id).lean();
  check('Publisher freezes the payout (3000)', rameshAfterAccept.wallet.frozenBalance === 3000, String(rameshAfterAccept.wallet.frozenBalance));
  check('Acceptor freezes the commission (2000)', vikasAfterAccept.wallet.frozenBalance === 2000, String(vikasAfterAccept.wallet.frozenBalance));
  check('Publisher balance unchanged', rameshAfterAccept.wallet.balance === 10000, String(rameshAfterAccept.wallet.balance));
  check('Acceptor balance unchanged', vikasAfterAccept.wallet.balance === 2500, String(vikasAfterAccept.wallet.balance));

  const escrowRide = await Ride.findById(rideId).lean();
  check('Escrow is held', escrowRide.escrow.state === 'held');
  check('Ride is accepted by Vikas', String(escrowRide.driverId) === String(vikas._id));
  check('Publish marked taken', escrowRide.publish.status === 'taken');

  const takenAgain = await api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: sureshToken });
  check('A second driver gets RIDE_ALREADY_TAKEN', takenAgain.json?.code === 'RIDE_ALREADY_TAKEN', JSON.stringify(takenAgain.json));

  console.log('\n=== 8. Frozen money is not withdrawable ===');
  const withdraw = await api('/drivers/wallet/withdrawals', {
    method: 'POST',
    token: vikasToken,
    body: { amount: 2000, payment_method: 'bank_transfer' },
  });
  check(
    'Cannot withdraw money held in escrow',
    withdraw.status === 400 && /available/i.test(withdraw.json?.message || ''),
    JSON.stringify(withdraw.json),
  );

  console.log('\n=== 9. Completion: customer paid the acceptor (cash) ===');
  await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'arriving' });
  await updateRideLifecycle({ rideId, driverId: vikas._id, nextStatus: 'started' });
  await updateRideLifecycle({
    rideId,
    driverId: vikas._id,
    nextStatus: 'completed',
    collectedBy: 'driver',
  });

  const rameshFinal = await Driver.findById(ramesh._id).lean();
  const vikasFinal = await Driver.findById(vikas._id).lean();
  check('Publisher receives the commission (+2000)', rameshFinal.wallet.balance === 12000, String(rameshFinal.wallet.balance));
  check('Acceptor pays the commission (-2000)', vikasFinal.wallet.balance === 500, String(vikasFinal.wallet.balance));
  check('Publisher hold released', rameshFinal.wallet.frozenBalance === 0, String(rameshFinal.wallet.frozenBalance));
  check('Acceptor hold released', vikasFinal.wallet.frozenBalance === 0, String(vikasFinal.wallet.frozenBalance));

  const settled = await Ride.findById(rideId).lean();
  check('Escrow settled', settled.escrow.state === 'settled');
  check('Collector recorded', settled.escrow.collected_by === 'driver');
  check('Dispute window open', settled.escrow.dispute_until > new Date());

  console.log('\n=== 10. Settlement is idempotent ===');
  const { settlePublishedRide } = await import('../src/modules/taxi/driver/services/escrowService.js');
  let secondSettleFailed = false;
  try {
    await settlePublishedRide({ rideId, collectedBy: 'driver' });
  } catch (error) {
    secondSettleFailed = error.code === 'ESCROW_STATE_INVALID';
  }
  check('A repeat settlement is refused', secondSettleFailed);
  check(
    'No money moved on the repeat',
    (await Driver.findById(vikasFinal._id).lean()).wallet.balance === 500,
  );

  console.log('\n=== 11. Dispute correction ===');
  const disputed = await api(`/drivers/network/rides/${rideId}/escrow/dispute`, {
    method: 'POST',
    token: rameshToken,
    body: { reason: 'Customer paid me, not the driver' },
  });
  check('Publisher can dispute', disputed.status === 200, JSON.stringify(disputed.json));

  const { resolveEscrowDispute } = await import('../src/modules/taxi/driver/services/escrowService.js');
  await resolveEscrowDispute({ rideId, correctCollectedBy: 'publisher' });

  const rameshCorrected = await Driver.findById(ramesh._id).lean();
  const vikasCorrected = await Driver.findById(vikas._id).lean();
  // Reverse the wrong transfer (+2000 back to Vikas, -2000 from Ramesh), then
  // apply the right one (-3000 Ramesh, +3000 Vikas): net 10000 - 3000 = 7000.
  check('Publisher ends at 7000', rameshCorrected.wallet.balance === 7000, String(rameshCorrected.wallet.balance));
  check('Acceptor ends at 5500', vikasCorrected.wallet.balance === 5500, String(vikasCorrected.wallet.balance));

  console.log('\n=== 12. Cancel releases both holds ===');
  const second = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Second Customer', phone: '9100000098' },
      pickup: { coordinates: INDORE, address: 'Palasia, Indore' },
      drop: { coordinates: BHOPAL, address: 'Arera, Bhopal' },
      fare: 4000,
    },
  });
  const secondRideId = second.json.data.id;
  await api(`/drivers/network/rides/${secondRideId}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 4000, owner_commission: 1000, driver_payout: 3000 },
  });
  await api(`/drivers/feed/rides/${secondRideId}/accept`, { method: 'POST', token: vikasToken });

  const beforeCancel = await Driver.findById(ramesh._id).lean();
  check('Hold taken on the second ride', beforeCancel.wallet.frozenBalance === 3000, String(beforeCancel.wallet.frozenBalance));

  const cancelled = await api(`/drivers/network/rides/${secondRideId}/cancel`, {
    method: 'POST',
    token: rameshToken,
    body: { reason: 'Customer called off' },
  });
  check('Creator can cancel', cancelled.status === 200, JSON.stringify(cancelled.json));

  const rameshAfterCancel = await Driver.findById(ramesh._id).lean();
  const vikasAfterCancel = await Driver.findById(vikas._id).lean();
  check('Publisher hold released', rameshAfterCancel.wallet.frozenBalance === 0, String(rameshAfterCancel.wallet.frozenBalance));
  check('Acceptor hold released', vikasAfterCancel.wallet.frozenBalance === 0, String(vikasAfterCancel.wallet.frozenBalance));
  check('Publisher balance untouched by the cancel', rameshAfterCancel.wallet.balance === 7000, String(rameshAfterCancel.wallet.balance));
  check('Acceptor balance untouched by the cancel', vikasAfterCancel.wallet.balance === 5500, String(vikasAfterCancel.wallet.balance));
  check(
    'Escrow marked released',
    (await Ride.findById(secondRideId).lean()).escrow.state === 'released',
  );

  console.log('\n=== 13. Publishing beyond your wallet is refused ===');
  await Driver.updateOne({ _id: ramesh._id }, { $set: { 'wallet.balance': 100 } });
  const third = await api('/drivers/network/rides', {
    method: 'POST',
    token: rameshToken,
    body: {
      customer: { name: 'Third Customer', phone: '9100000097' },
      pickup: { coordinates: INDORE, address: 'Indore' },
      drop: { coordinates: BHOPAL, address: 'Bhopal' },
      fare: 5000,
    },
  });
  const poorPublish = await api(`/drivers/network/rides/${third.json.data.id}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  check(
    'Publisher without the payout is refused',
    poorPublish.json?.code === 'INSUFFICIENT_WALLET_FOR_PUBLISH',
    JSON.stringify(poorPublish.json),
  );

  console.log('\n=== 14. Expiry sweeps the feed ===');
  await Driver.updateOne({ _id: ramesh._id }, { $set: { 'wallet.balance': 10000 } });
  await api(`/drivers/network/rides/${third.json.data.id}/publish`, {
    method: 'POST',
    token: rameshToken,
    body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
  });
  await Ride.updateOne(
    { _id: third.json.data.id },
    { $set: { 'publish.expires_at': new Date(Date.now() - 1000) } },
  );
  const { expirePublishedRides } = await import('../src/modules/taxi/driver/services/feedService.js');
  const swept = await expirePublishedRides();
  check('Expired lead swept', swept.expired === 1, JSON.stringify(swept));
  const feedAfterExpiry = await api('/drivers/feed?tab=driver', { token: vikasToken });
  check(
    'Expired lead is gone from the feed',
    !feedIds(feedAfterExpiry).includes(third.json.data.id),
    feedIds(feedAfterExpiry).join(','),
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
};

run()
  .catch((error) => {
    console.error('Smoke run crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
