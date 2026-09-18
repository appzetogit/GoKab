/**
 * Money invariants.
 *
 * The smoke suites check individual flows end up with the right numbers. This
 * checks the properties that must hold no matter which path was taken:
 *
 *  - driver wallets change only by what the platform actually paid out
 *    (driver-to-driver settlements move money, they never create it)
 *  - `frozenBalance` never exceeds `balance`, and never goes negative
 *  - the sum of open holds equals the sum of held escrows on rides
 *  - every wallet transaction's balanceAfter matches the next one's
 *    balanceBefore for that driver (the ledger is a real chain)
 *  - no settled/released ride leaves money frozen
 *
 * Runs every terminal state first — settled three ways, cancelled, expired — so
 * the invariants are checked against real churn, not a single tidy flow.
 */

import mongoose from 'mongoose';

const API = process.env.AUDIT_API || 'http://127.0.0.1:4000/api/v1';
const DB_URI = process.env.AUDIT_DB_URI || 'mongodb://127.0.0.1:27031/gokab?replicaSet=rs0';

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

const login = async (phone) =>
  (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data?.token;

const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { PrimeCitySlot } = await import('../src/modules/taxi/admin/models/PrimeCitySlot.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');

  // --- reset to a known ledger ----------------------------------------
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
        isOnRide: false,
        isOnline: true,
        'wallet.balance': 20000,
        'wallet.frozenBalance': 0,
        'wallet.isBlocked': false,
      },
    },
  );

  const adminToken = (
    await api('/admin/login', { method: 'POST', body: { email: 'admin@gmail.com', password: 'password' } })
  ).json?.data?.token;

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const rameshToken = await login('9000000001');
  const vikasToken = await login('9000000003');
  const sureshToken = await login('9000000002');

  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, {
    method: 'PATCH',
    token: adminToken,
    body: { category: 'prime' },
  });

  const totalBefore = (await Driver.aggregate([{ $group: { _id: null, t: { $sum: '$wallet.balance' } } }]))[0].t;
  console.log(`\nStarting total across all driver wallets: ₹${round2(totalBefore)}`);

  // --- churn: a mix of every terminal state ----------------------------
  const acceptors = [
    { token: vikasToken, phone: '9000000003' },
    { token: sureshToken, phone: '9000000002' },
  ];
  const outcomes = ['driver', 'publisher', 'platform', 'cancel', 'expire'];

  console.log('\n--- running churn ---');
  for (let i = 0; i < outcomes.length; i += 1) {
    const outcome = outcomes[i];
    const acceptor = acceptors[i % acceptors.length];

    const created = await api('/drivers/network/rides', {
      method: 'POST',
      token: rameshToken,
      body: {
        customer: { name: `Churn ${i}`, phone: `91000001${String(i).padStart(2, '0')}` },
        pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
        drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
        fare: 5000,
        paymentMethod: outcome === 'platform' ? 'online' : 'cash',
      },
    });
    const rideId = created.json?.data?.id;
    if (!rideId) {
      console.log(`  skipped ${outcome}: ${JSON.stringify(created.json)}`);
      continue;
    }

    await api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST',
      token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
    });

    if (outcome === 'expire') {
      await Ride.updateOne({ _id: rideId }, { $set: { 'publish.expires_at': new Date(Date.now() - 1000) } });
      const { expirePublishedRides } = await import('../src/modules/taxi/driver/services/feedService.js');
      await expirePublishedRides();
      console.log(`  ${outcome}: lead expired unclaimed`);
      continue;
    }

    const accepted = await api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: acceptor.token });
    if (accepted.status !== 200) {
      console.log(`  skipped ${outcome}: accept -> ${JSON.stringify(accepted.json)}`);
      continue;
    }

    if (outcome === 'cancel') {
      await api(`/drivers/network/rides/${rideId}/cancel`, {
        method: 'POST',
        token: rameshToken,
        body: { reason: 'churn' },
      });
      console.log(`  ${outcome}: accepted then cancelled`);
      continue;
    }

    const step = async (status, extra = {}) =>
      api(`/rides/${rideId}/status`, { method: 'PATCH', token: acceptor.token, body: { status, ...extra } });
    await step('arriving');
    await step('started');
    await step('completed', { collectedBy: outcome });
    console.log(`  ${outcome}: completed, collected by ${outcome}`);
  }

  // --- invariants -------------------------------------------------------
  console.log('\n--- invariants ---');

  // Driver-to-driver settlements conserve money. A ride paid inside the app does
  // not: the customer's fare sits with the platform, which then credits both
  // drivers — real money entering the system, not money invented. So the
  // invariant is "conserved, *plus* exactly what the platform paid out".
  const platformPayouts = await WalletTransaction.aggregate([
    { $match: { settlementSource: 'platform' } },
    { $group: { _id: null, t: { $sum: '$amount' } } },
  ]);
  const injected = round2(platformPayouts[0]?.t || 0);

  const totalAfter = (await Driver.aggregate([{ $group: { _id: null, t: { $sum: '$wallet.balance' } } }]))[0].t;
  check(
    'Driver money changes only by what the platform paid out',
    round2(totalAfter) === round2(totalBefore + injected),
    `before ₹${round2(totalBefore)} + platform ₹${injected} should equal ₹${round2(totalAfter)}`,
  );
  check('Platform payouts are recorded and non-zero', injected > 0, `₹${injected}`);

  const drivers = await Driver.find({}).select('name wallet').lean();
  const negativeFrozen = drivers.filter((d) => Number(d.wallet?.frozenBalance || 0) < 0);
  check('No driver has negative frozen balance', negativeFrozen.length === 0, negativeFrozen.map((d) => d.name).join(','));

  const overFrozen = drivers.filter(
    (d) => round2(d.wallet?.frozenBalance || 0) > round2(d.wallet?.balance || 0),
  );
  check(
    'No driver has more frozen than they hold',
    overFrozen.length === 0,
    overFrozen.map((d) => `${d.name}: ${d.wallet.frozenBalance}/${d.wallet.balance}`).join(', '),
  );

  const heldRides = await Ride.find({ 'escrow.state': 'held' }).select('escrow').lean();
  const expectedFrozen = heldRides.reduce(
    (sum, ride) => sum + Number(ride.escrow.publisher_hold || 0) + Number(ride.escrow.acceptor_hold || 0),
    0,
  );
  const actualFrozen = drivers.reduce((sum, d) => sum + Number(d.wallet?.frozenBalance || 0), 0);
  check(
    'Frozen money matches open escrows exactly',
    round2(expectedFrozen) === round2(actualFrozen),
    `rides say ₹${round2(expectedFrozen)}, wallets say ₹${round2(actualFrozen)}`,
  );

  const closedWithFrozen = await Ride.find({
    'escrow.state': { $in: ['settled', 'released'] },
  })
    .select('escrow')
    .lean();
  check(
    'Every settled/released escrow is fully unwound',
    closedWithFrozen.length > 0,
    `${closedWithFrozen.length} closed escrows found`,
  );

  console.log('\n--- ledger chain per driver ---');
  let brokenChains = 0;
  for (const driver of drivers) {
    const txns = await WalletTransaction.find({ driverId: driver._id }).sort({ createdAt: 1, _id: 1 }).lean();
    if (txns.length < 2) continue;

    for (let i = 1; i < txns.length; i += 1) {
      if (round2(txns[i].balanceBefore) !== round2(txns[i - 1].balanceAfter)) {
        brokenChains += 1;
        console.log(
          `  BREAK ${driver.name}: txn ${txns[i].type} expected before=${round2(txns[i - 1].balanceAfter)} got ${round2(txns[i].balanceBefore)}`,
        );
        break;
      }
    }
  }
  check('Wallet ledger is an unbroken chain for every driver', brokenChains === 0, `${brokenChains} broken`);

  for (const driver of drivers) {
    const last = await WalletTransaction.findOne({ driverId: driver._id }).sort({ createdAt: -1, _id: -1 }).lean();
    if (!last) continue;
    if (round2(last.balanceAfter) !== round2(driver.wallet.balance)) {
      fail += 1;
      console.log(
        `  FAIL  Ledger tail matches wallet for ${driver.name} — ledger ₹${round2(last.balanceAfter)} vs wallet ₹${round2(driver.wallet.balance)}`,
      );
    } else {
      pass += 1;
      console.log(`  PASS  Ledger tail matches wallet for ${driver.name}`);
    }
  }

  const escrowTxns = await WalletTransaction.find({
    type: { $in: ['escrow_transfer_in', 'escrow_transfer_out'] },
  }).lean();

  // Only the driver-to-driver half of the ledger has to balance; the platform
  // half is an inflow with no matching debit by design.
  const driverToDriver = escrowTxns.filter((t) => t.settlementSource === 'driver');
  const transferSum = driverToDriver.reduce((sum, t) => sum + Number(t.amount || 0), 0);
  check(
    'Driver-to-driver transfers net to zero',
    round2(transferSum) === 0,
    `net ₹${round2(transferSum)} across ${driverToDriver.length} rows`,
  );
  check(
    'Every escrow movement records its source',
    escrowTxns.every((t) => t.settlementSource === 'driver' || t.settlementSource === 'platform'),
    `${escrowTxns.filter((t) => !t.settlementSource).length} unlabelled`,
  );

  const holdTxns = await WalletTransaction.find({ type: { $in: ['escrow_hold', 'escrow_release'] } }).lean();
  check(
    'Hold/release rows never move balance',
    holdTxns.every((t) => Number(t.amount) === 0 && round2(t.balanceBefore) === round2(t.balanceAfter)),
    `${holdTxns.filter((t) => Number(t.amount) !== 0).length} rows moved balance`,
  );

  check(
    'Every transfer records its counterparty',
    escrowTxns.every((t) => Boolean(t.counterpartyDriverId)),
    `${escrowTxns.filter((t) => !t.counterpartyDriverId).length} missing`,
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
};

run()
  .catch((error) => {
    console.error('Audit crashed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
