/**
 * Phase-2 smoke test: driver routes, the per-tier route limit, corridor
 * matching (including direction) and route-mode filtering inside dispatch.
 *
 * Runs against a local backend + local database only.
 */

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4000/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27031/gokab?replicaSet=rs0';

const INDORE = [75.8577, 22.7196];
const UJJAIN = [75.7885, 23.1765];
const BHOPAL = [77.4126, 23.2599];
const MUMBAI = [72.8777, 19.076];

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
  const { matchRideToRoute } = await import('../src/modules/taxi/services/routeMatchService.js');
  const { matchDrivers } = await import('../src/modules/taxi/services/matchingService.js');

  await DriverRoute.deleteMany({});
  await PrimeCitySlot.deleteMany({});
  await DriverSubscription.deleteMany({});
  // Full reset, including anything an earlier suite may have left behind
  // (admin route overrides, drained wallets, stuck on-ride flags).
  await Driver.updateMany(
    {},
    {
      $set: {
        driver_category: 'lower',
        route_mode: 'all_locations',
        active_route_id: null,
        max_routes_override: null,
        isOnRide: false,
        isOnline: true,
        'wallet.balance': 2000,
        'wallet.frozenBalance': 0,
        'wallet.isBlocked': false,
      },
    },
  );

  const mohanToken = await login('9000000004');
  const mohan = await Driver.findOne({ phone: '9000000004' }).lean();

  console.log('\n=== 1. Route CRUD ===');
  const created = await api('/drivers/routes', {
    method: 'POST',
    token: mohanToken,
    body: {
      name: 'Indore - Ujjain - Bhopal',
      stops: [
        { name: 'Indore', coordinates: INDORE },
        { name: 'Ujjain', coordinates: UJJAIN },
        { name: 'Bhopal', coordinates: BHOPAL },
      ],
      corridor_km: 10,
    },
  });
  check('Route created', created.status === 201, JSON.stringify(created.json));
  check('Stops round-trip', created.json?.data?.stops?.length === 3);
  check('Path distance computed', created.json?.data?.distance_meters > 100_000, String(created.json?.data?.distance_meters));

  const listed = await api('/drivers/routes', { token: mohanToken });
  check('Route list shows limit 2 for Lower', listed.json?.data?.limit === 2, String(listed.json?.data?.limit));
  check('Route list shows 1 used', listed.json?.data?.used === 1);
  check('Mode starts at all_locations', listed.json?.data?.route_mode === 'all_locations');

  const badStops = await api('/drivers/routes', {
    method: 'POST',
    token: mohanToken,
    body: { name: 'One stop', stops: [{ name: 'Indore', coordinates: INDORE }] },
  });
  check('Single-stop route refused with INVALID_STOPS', badStops.json?.code === 'INVALID_STOPS', JSON.stringify(badStops.json));

  const second = await api('/drivers/routes', {
    method: 'POST',
    token: mohanToken,
    body: {
      name: 'Bhopal - Bina - Jhansi',
      stops: [
        { name: 'Bhopal', coordinates: BHOPAL },
        { name: 'Bina', coordinates: [78.2, 24.18] },
        { name: 'Jhansi', coordinates: [78.57, 25.44] },
      ],
      bidirectional: true,
    },
  });
  check('Second route allowed (limit 2)', second.status === 201, JSON.stringify(second.json));

  const third = await api('/drivers/routes', {
    method: 'POST',
    token: mohanToken,
    body: {
      name: 'Too many',
      stops: [
        { name: 'A', coordinates: INDORE },
        { name: 'B', coordinates: BHOPAL },
      ],
    },
  });
  check('Third route refused', third.status === 403, String(third.status));
  check('...with ROUTE_LIMIT_REACHED', third.json?.code === 'ROUTE_LIMIT_REACHED', JSON.stringify(third.json));

  console.log('\n=== 2. Admin route-limit override ===');
  await Driver.updateOne({ _id: mohan._id }, { $set: { max_routes_override: 3 } });
  const afterOverride = await api('/drivers/routes', {
    method: 'POST',
    token: mohanToken,
    body: {
      name: 'Third allowed by override',
      stops: [
        { name: 'Indore', coordinates: INDORE },
        { name: 'Ujjain', coordinates: UJJAIN },
      ],
    },
  });
  check('Override raises the limit to 3', afterOverride.status === 201, JSON.stringify(afterOverride.json));
  await Driver.updateOne({ _id: mohan._id }, { $set: { max_routes_override: null } });

  console.log('\n=== 3. Corridor matching ===');
  const route = await DriverRoute.findById(created.json.data.id).lean();
  check(
    'Indore -> Bhopal matches',
    matchRideToRoute({ route, pickup: INDORE, drop: BHOPAL }).match === true,
  );
  check(
    'Ujjain -> Bhopal (mid-route pickup) matches',
    matchRideToRoute({ route, pickup: UJJAIN, drop: BHOPAL }).match === true,
  );
  const reverse = matchRideToRoute({ route, pickup: BHOPAL, drop: INDORE });
  check('Bhopal -> Indore is rejected on a one-way route', reverse.match === false, reverse.reason);
  check('...because of direction, not distance', reverse.reason === 'WRONG_DIRECTION', reverse.reason);
  const offRoute = matchRideToRoute({ route, pickup: INDORE, drop: MUMBAI });
  check('Indore -> Mumbai is rejected', offRoute.match === false, offRoute.reason);
  check('...because the drop is off-corridor', offRoute.reason === 'DROP_OFF_ROUTE', offRoute.reason);

  const twoWay = await DriverRoute.findById(second.json.data.id).lean();
  check(
    'Bidirectional route accepts the reverse trip',
    matchRideToRoute({ route: twoWay, pickup: [78.57, 25.44], drop: BHOPAL }).match === true,
  );

  console.log('\n=== 4. Route mode gates dispatch ===');
  const modeOn = await api('/drivers/route-mode', {
    method: 'PATCH',
    token: mohanToken,
    body: { mode: 'route', routeId: created.json.data.id },
  });
  check('Route mode set', modeOn.json?.data?.route_mode === 'route', JSON.stringify(modeOn.json));

  const indoreDriver = await Driver.findOne({ phone: '9000000004' }).lean();
  const onRoute = await matchDrivers(INDORE, {
    maxDistance: 15000,
    serviceLocationId: indoreDriver.service_location_id,
    dropCoords: BHOPAL,
  });
  const offRouteMatch = await matchDrivers(INDORE, {
    maxDistance: 15000,
    serviceLocationId: indoreDriver.service_location_id,
    dropCoords: MUMBAI,
  });
  const idsOf = (result) => result.drivers.map((driver) => String(driver._id));

  check(
    'Route-mode driver is offered an on-corridor trip',
    idsOf(onRoute).includes(String(mohan._id)),
    idsOf(onRoute).join(','),
  );
  check(
    'Route-mode driver is NOT offered an off-corridor trip',
    !idsOf(offRouteMatch).includes(String(mohan._id)),
    idsOf(offRouteMatch).join(','),
  );
  check(
    'Other all_locations drivers still get the off-corridor trip',
    offRouteMatch.drivers.length > 0,
    String(offRouteMatch.drivers.length),
  );

  console.log('\n=== 5. Far-away driver reachable via their route ===');
  // Park Mohan in Indore but ask for a pickup in Ujjain — far outside the
  // radius, yet squarely on his corridor.
  const ujjainPickup = await matchDrivers(UJJAIN, {
    maxDistance: 3000,
    dropCoords: BHOPAL,
  });
  check(
    'Corridor driver surfaces for a pickup beyond the radius',
    idsOf(ujjainPickup).includes(String(mohan._id)),
    idsOf(ujjainPickup).join(','),
  );

  console.log('\n=== 6. Deleting the active route falls back safely ===');
  const deleted = await api(`/drivers/routes/${created.json.data.id}`, {
    method: 'DELETE',
    token: mohanToken,
  });
  check('Route deleted', deleted.json?.data?.deleted === true, JSON.stringify(deleted.json));
  const afterDelete = await Driver.findById(mohan._id).lean();
  check('Driver falls back to all_locations', afterDelete.route_mode === 'all_locations', afterDelete.route_mode);
  check('Active route cleared', afterDelete.active_route_id === null);

  const backInDispatch = await matchDrivers(INDORE, {
    maxDistance: 15000,
    serviceLocationId: indoreDriver.service_location_id,
    dropCoords: MUMBAI,
  });
  check(
    'Driver receives everything again after the fallback',
    idsOf(backInDispatch).includes(String(mohan._id)),
    idsOf(backInDispatch).join(','),
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
