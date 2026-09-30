/**
 * Smoke test for "Create Fleet Ride = Create + Assign in one call" (backend
 * spec, 2026-09-30): POST /drivers/network/rides accepts an optional
 * assign_to_driver_id/assignToDriverId that creates and assigns atomically —
 * either the ride exists and is assigned, or nothing is created at all.
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_create_assign_ride.mjs
 */

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4099/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27035/gokab_ride_test?replicaSet=rs0';
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
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
};

const login = async (phone) =>
  (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data?.token;
const loginAdmin = async () =>
  (await api('/admin/login', { method: 'POST', body: { email: 'admin@gmail.com', password: 'password' } })).json?.data?.token;

let phoneCounter = 0;
const nextCustomer = () => {
  phoneCounter += 1;
  return { name: `Create-Assign Customer ${phoneCounter}`, phone: `910000${String(9000 + phoneCounter)}` };
};

const rideBody = (extra = {}) => ({
  customer: nextCustomer(),
  pickup: { address: 'Indore', coordinates: INDORE },
  drop: { address: 'Bhopal', coordinates: BHOPAL },
  fare: 5000,
  paymentMethod: 'cash',
  serviceType: 'ride',
  ...extra,
});

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();
  const rameshToken = await login('9000000001');
  const adminToken = await loginAdmin();

  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, {
    method: 'PATCH', token: adminToken, body: { category: 'prime' },
  });

  // Clean slate: no rides left over from a previous run, no driver stuck busy.
  await Ride.deleteMany({ created_by_driver_id: ramesh._id });
  await Driver.updateMany({ _id: { $in: [ramesh._id, suresh._id, vikas._id] } }, { $set: { isOnRide: false } });

  console.log('\n=== 1. Create WITHOUT assign_to_driver_id -> unchanged (dispatch, unassigned) ===');
  const plain = await api('/drivers/network/rides', { method: 'POST', token: rameshToken, body: rideBody() });
  check('201 created', plain.status === 201, JSON.stringify(plain.json));
  check('status: searching', plain.json?.data?.status === 'searching');
  check('assignment.mode: dispatch', plain.json?.data?.assignment?.mode === 'dispatch');
  check('assignment.driver is null', plain.json?.data?.assignment?.driver === null);

  console.log('\n=== 2. Create + self-assign ===');
  const selfAssign = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: rideBody({ assign_to_driver_id: String(ramesh._id) }),
  });
  check('201 created and assigned', selfAssign.status === 201, JSON.stringify(selfAssign.json));
  check('status: accepted', selfAssign.json?.data?.status === 'accepted');
  check('assignment.mode: direct_assign', selfAssign.json?.data?.assignment?.mode === 'direct_assign');
  check('assignment.driver is Ramesh', selfAssign.json?.data?.assignment?.driver?.id === String(ramesh._id));
  await Driver.updateOne({ _id: ramesh._id }, { $set: { isOnRide: false } });

  console.log('\n=== 3. Create + assign to a fleet driver (camelCase field) -> notified ===');
  const fleetAssign = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: rideBody({ assignToDriverId: String(suresh._id) }),
  });
  check('201 created and assigned to Suresh', fleetAssign.status === 201, JSON.stringify(fleetAssign.json));
  check('assignment.driver is Suresh', fleetAssign.json?.data?.assignment?.driver?.id === String(suresh._id));
  const sureshAfter = await Driver.findById(suresh._id).lean();
  check('Suresh is now isOnRide', sureshAfter.isOnRide === true);
  await Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: false } });
  const fleetRideId = fleetAssign.json?.data?.id;
  await Ride.updateOne({ _id: fleetRideId }, { $set: { status: 'completed', liveStatus: 'completed', driverId: null } });

  console.log('\n=== 4. Fleet driver id on a plan without can_manage_fleet -> 403 CATEGORY_NOT_ALLOWED, no ride left ===');
  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, { method: 'PATCH', token: adminToken, body: { category: 'middle' } });
  const beforeCount4 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  const noFleetPerm = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: rideBody({ assign_to_driver_id: String(suresh._id) }),
  });
  check('403 CATEGORY_NOT_ALLOWED', noFleetPerm.status === 403 && noFleetPerm.json?.code === 'CATEGORY_NOT_ALLOWED', JSON.stringify(noFleetPerm.json));
  const afterCount4 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  check('No ride left behind for the refused attempt', afterCount4 === beforeCount4, `${beforeCount4} -> ${afterCount4}`);
  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, { method: 'PATCH', token: adminToken, body: { category: 'prime' } });

  console.log('\n=== 5. Driver from another organisation -> 403 DRIVER_NOT_IN_FLEET, no ride in DB ===');
  const beforeCount5 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  const notInFleet = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: rideBody({ assign_to_driver_id: String(vikas._id) }),
  });
  check('403 DRIVER_NOT_IN_FLEET', notInFleet.status === 403 && notInFleet.json?.code === 'DRIVER_NOT_IN_FLEET', JSON.stringify(notInFleet.json));
  const afterCount5 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  check('No ride created in the DB', afterCount5 === beforeCount5, `${beforeCount5} -> ${afterCount5}`);

  console.log('\n=== 6. Unapproved/deleted driver id -> 404 DRIVER_NOT_FOUND, no ride in DB ===');
  const beforeCount6 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  const notFound = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: rideBody({ assign_to_driver_id: String(new mongoose.Types.ObjectId()) }),
  });
  check('404 DRIVER_NOT_FOUND', notFound.status === 404 && notFound.json?.code === 'DRIVER_NOT_FOUND', JSON.stringify(notFound.json));
  const afterCount6 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  check('No ride created in the DB', afterCount6 === beforeCount6, `${beforeCount6} -> ${afterCount6}`);

  console.log('\n=== 7. Immediate ride to a driver already on a ride -> 409 DRIVER_BUSY, no ride in DB ===');
  await Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: true } });
  const beforeCount7 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  const busyImmediate = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: rideBody({ assign_to_driver_id: String(suresh._id) }),
  });
  check('409 DRIVER_BUSY', busyImmediate.status === 409 && busyImmediate.json?.code === 'DRIVER_BUSY', JSON.stringify(busyImmediate.json));
  const afterCount7 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  check('No ride created in the DB', afterCount7 === beforeCount7, `${beforeCount7} -> ${afterCount7}`);
  await Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: false } });

  console.log('\n=== 8. Scheduled ride to a busy driver with no time clash -> 201 (allowed) ===');
  await Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: true } });
  const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const scheduledOk = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: rideBody({ assign_to_driver_id: String(suresh._id), scheduledAt: farFuture }),
  });
  check('201 scheduled ride assigned despite isOnRide', scheduledOk.status === 201, JSON.stringify(scheduledOk.json));
  await Ride.deleteOne({ _id: scheduledOk.json?.data?.id });
  await Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: false } });

  console.log('\n=== 9. Scheduled ride clashing with another scheduled trip -> 409 DRIVER_BUSY with conflictingRideId, no ride created ===');
  const firstScheduled = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: rideBody({ assign_to_driver_id: String(suresh._id), scheduledAt: farFuture, estimatedDurationMinutes: 60 }),
  });
  check('First scheduled ride created', firstScheduled.status === 201, JSON.stringify(firstScheduled.json));
  const beforeCount9 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  const clash = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: rideBody({ assign_to_driver_id: String(suresh._id), scheduledAt: farFuture, estimatedDurationMinutes: 60 }),
  });
  check(
    '409 DRIVER_BUSY with conflictingRideId',
    clash.status === 409 && clash.json?.code === 'DRIVER_BUSY' && Boolean(clash.json?.details?.conflictingRideId),
    JSON.stringify(clash.json),
  );
  const afterCount9 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  check('No ride created for the clashing attempt', afterCount9 === beforeCount9, `${beforeCount9} -> ${afterCount9}`);
  await Ride.deleteOne({ _id: firstScheduled.json?.data?.id });

  console.log('\n=== 10. Race: two simultaneous immediate assigns to the same free driver -> one 201, one 409, loser leaves no ride ===');
  await Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: false } });
  const beforeCount10 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  const [raceA, raceB] = await Promise.all([
    api('/drivers/network/rides', { method: 'POST', token: rameshToken, body: rideBody({ assign_to_driver_id: String(suresh._id) }) }),
    api('/drivers/network/rides', { method: 'POST', token: rameshToken, body: rideBody({ assign_to_driver_id: String(suresh._id) }) }),
  ]);
  const raceStatuses = [raceA.status, raceB.status].sort();
  check('One 201 and one 409 out of the two simultaneous attempts', raceStatuses[0] === 201 && raceStatuses[1] === 409, JSON.stringify(raceStatuses));
  const afterCount10 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  check('Exactly one new ride persisted from the race (loser left nothing)', afterCount10 === beforeCount10 + 1, `${beforeCount10} -> ${afterCount10}`);
  const winner = raceA.status === 201 ? raceA : raceB;
  await Ride.deleteOne({ _id: winner.json?.data?.id });
  await Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: false } });

  console.log('\n=== 11. Missing customer WITH assign_to_driver_id -> 422, no ride, no assignment attempted ===');
  const beforeCount11 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  const badPayload = await api('/drivers/network/rides', {
    method: 'POST', token: rameshToken,
    body: { pickup: { address: 'Indore', coordinates: INDORE }, drop: { address: 'Bhopal', coordinates: BHOPAL }, fare: 5000, assign_to_driver_id: String(suresh._id) },
  });
  check('422 CUSTOMER_REQUIRED', badPayload.status === 422 && badPayload.json?.code === 'CUSTOMER_REQUIRED', JSON.stringify(badPayload.json));
  const afterCount11 = await Ride.countDocuments({ created_by_driver_id: ramesh._id });
  check('No ride created', afterCount11 === beforeCount11, `${beforeCount11} -> ${afterCount11}`);
  const sureshUnaffected = await Driver.findById(suresh._id).lean();
  check('Suresh was never touched (no assignment attempted)', sureshUnaffected.isOnRide === false);

  console.log('\n=== 12. Existing /assign endpoint still works the same way ===');
  const forAssign = await api('/drivers/network/rides', { method: 'POST', token: rameshToken, body: rideBody() });
  const assignCall = await api(`/drivers/network/rides/${forAssign.json?.data?.id}/assign`, {
    method: 'POST', token: rameshToken, body: { driverId: String(suresh._id) },
  });
  check('POST /assign still assigns correctly', assignCall.status === 200 && assignCall.json?.data?.assignment?.driver?.id === String(suresh._id), JSON.stringify(assignCall.json));
  await Ride.deleteOne({ _id: forAssign.json?.data?.id });
  await Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: false } });

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
