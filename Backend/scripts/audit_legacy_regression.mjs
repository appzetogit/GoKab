/**
 * Regression guard for the flows that existed before the driver network.
 *
 * The network module changed `Ride`, `createRideRecord`, `updateRideLifecycle`,
 * the wallet snapshot and the matching query. This checks a plain app booking
 * still behaves exactly as it did: dispatch matches, the driver accepts,
 * commission settles off `baseFare`, and none of the escrow machinery engages.
 */

import mongoose from 'mongoose';

const DB_URI = process.env.AUDIT_DB_URI || 'mongodb://127.0.0.1:27031/gokab?replicaSet=rs0';
const INDORE = [75.8577, 22.7196];
const NEARBY = [75.87, 22.73];

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

const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { PrimeCitySlot } = await import('../src/modules/taxi/admin/models/PrimeCitySlot.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
  const { createRideRecord, acceptRideAssignment, updateRideLifecycle } = await import(
    '../src/modules/taxi/services/rideService.js'
  );
  const { matchDrivers } = await import('../src/modules/taxi/services/matchingService.js');
  const { serializeDriverWallet } = await import('../src/modules/taxi/driver/services/walletService.js');

  await Promise.all([
    PrimeCitySlot.deleteMany({}),
    DriverSubscription.deleteMany({}),
    Ride.deleteMany({}),
    WalletTransaction.deleteMany({}),
  ]);
  await Driver.updateMany(
    {},
    {
      $set: {
        driver_category: 'lower',
        route_mode: 'all_locations',
        active_route_id: null,
        isOnRide: false,
        isOnline: true,
        'wallet.balance': 5000,
        'wallet.frozenBalance': 0,
        'wallet.isBlocked': false,
      },
    },
  );
  await User.updateMany({}, { $set: { currentRideId: null } });

  const rider = await User.findOne({ phone: '9100000001' }).lean();
  const driver = await Driver.findOne({ phone: '9000000002' }).lean();

  console.log('\n=== 1. Plain app booking still dispatches ===');
  const matched = await matchDrivers(INDORE, {
    maxDistance: 8000,
    serviceLocationId: driver.service_location_id,
  });
  check(
    'Dispatch still finds drivers with no drop coordinates',
    matched.drivers.length > 0,
    `${matched.drivers.length} matched`,
  );
  check('Zone resolution still works', Boolean(matched.zone), String(matched.zone?.name));

  const withDrop = await matchDrivers(INDORE, {
    maxDistance: 8000,
    serviceLocationId: driver.service_location_id,
    dropCoords: NEARBY,
  });
  check(
    'All-locations drivers are not filtered out by the route check',
    withDrop.drivers.length === matched.drivers.length,
    `${withDrop.drivers.length} vs ${matched.drivers.length}`,
  );

  console.log('\n=== 2. Booking, accepting and completing ===');
  const ride = await createRideRecord({
    userId: rider._id,
    pickupCoords: INDORE,
    dropCoords: NEARBY,
    pickupAddress: 'Vijay Nagar, Indore',
    dropAddress: 'Palasia, Indore',
    fare: 400,
    vehicleTypeId: driver.vehicleTypeId,
    paymentMethod: 'cash',
    service_location_id: driver.service_location_id,
  });

  check('Ride created', Boolean(ride?._id));
  check('Defaults to a customer_app ride', ride.origin === 'customer_app', ride.origin);
  check('No escrow attached', ride.escrow.state === 'none', ride.escrow.state);
  check('Assignment mode is plain dispatch', ride.assignment.mode === 'dispatch', ride.assignment.mode);
  check('Publish block is inert', ride.publish.status === 'none', ride.publish.status);
  check('Rider is linked', String(ride.userId) === String(rider._id));
  check('OTP generated', /^\d{4}$/.test(ride.otp || ''), ride.otp);

  const refreshedUser = await User.findById(rider._id).lean();
  check('Rider currentRideId is set', String(refreshedUser.currentRideId) === String(ride._id));

  const accepted = await acceptRideAssignment({ rideId: ride._id, driverId: driver._id });
  check('Driver accepts', accepted.status === 'accepted', accepted.status);
  check('Driver marked on-ride', (await Driver.findById(driver._id).lean()).isOnRide === true);

  const balanceBefore = (await Driver.findById(driver._id).lean()).wallet.balance;

  await updateRideLifecycle({ rideId: ride._id, driverId: driver._id, nextStatus: 'arriving' });
  await updateRideLifecycle({ rideId: ride._id, driverId: driver._id, nextStatus: 'started' });
  const completed = await updateRideLifecycle({
    rideId: ride._id,
    driverId: driver._id,
    nextStatus: 'completed',
  });

  check('Ride completes without a collectedBy', completed.status === 'completed', completed.status);

  const settled = await Ride.findById(ride._id).lean();
  const driverAfter = await Driver.findById(driver._id).lean();

  check('Commission recorded', settled.commissionAmount > 0, String(settled.commissionAmount));
  check('Driver earnings recorded', settled.driverEarnings > 0, String(settled.driverEarnings));
  check(
    'Earnings are fare minus commission',
    round2(settled.driverEarnings + settled.commissionAmount) === round2(settled.baseFare || settled.fare),
    `${settled.driverEarnings} + ${settled.commissionAmount} vs ${settled.baseFare || settled.fare}`,
  );
  check('Wallet settled timestamp set', Boolean(settled.walletSettledAt));
  check('Escrow never engaged', settled.escrow.state === 'none', settled.escrow.state);

  // Cash ride: the driver physically took the fare, so the wallet is debited the
  // commission rather than credited the earnings.
  check(
    'Cash commission debited from the wallet',
    round2(driverAfter.wallet.balance) === round2(balanceBefore - settled.commissionAmount),
    `${balanceBefore} -> ${driverAfter.wallet.balance}, commission ${settled.commissionAmount}`,
  );
  check('Nothing frozen on a normal ride', driverAfter.wallet.frozenBalance === 0);
  check('Driver freed after completion', driverAfter.isOnRide === false);

  const ledger = await WalletTransaction.find({ rideId: ride._id }).lean();
  check('One ledger row for the settlement', ledger.length === 1, `${ledger.length} rows`);
  check(
    'It is a commission deduction, not an escrow row',
    ledger[0]?.type === 'commission_deduction',
    ledger[0]?.type,
  );

  console.log('\n=== 3. Wallet serialisation stays backward compatible ===');
  const wallet = await serializeDriverWallet(await Driver.findById(driver._id));
  for (const key of ['balance', 'cashLimit', 'minimumBalanceForOrders', 'availableForOrders', 'isBlocked']) {
    check(`Existing wallet field "${key}" still present`, wallet[key] !== undefined, JSON.stringify(wallet));
  }
  check('New "frozenBalance" field added', wallet.frozenBalance === 0);
  check('New "available" field added', wallet.available === wallet.balance);

  console.log('\n=== 4. A rider ride still requires a rider ===');
  let rejected = null;
  try {
    await createRideRecord({
      userId: null,
      pickupCoords: INDORE,
      dropCoords: NEARBY,
      fare: 100,
      vehicleTypeId: driver.vehicleTypeId,
      service_location_id: driver.service_location_id,
    });
  } catch (error) {
    rejected = error;
  }
  check('Booking with no rider is still refused', Boolean(rejected), 'expected a refusal');

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
};

run()
  .catch((error) => {
    console.error('Regression audit crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
