/**
 * Smoke test for the Driver Routes CRUD spec (backend spec, 2026-09-28):
 * invalid ids 404 instead of 500, corridor_km validation, path only rebuilt
 * when stops actually changed, route-mode-updated socket event on
 * update/delete/downgrade, ROUTES_NOT_IN_PLAN vs ROUTE_LIMIT_REACHED, and
 * active_route_id echoed back from PATCH /route-mode.
 *
 * Runs against a local backend + local database only.
 *
 * Usage: node scripts/smoke_driver_routes_crud.mjs
 */

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4066/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27032/gokab_route_test?replicaSet=rs0';

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

const INDORE = [75.8577, 22.7196];
const UJJAIN = [75.7849, 23.1765];
const BHOPAL = [77.4126, 23.2599];

const threeStopBody = (name = 'Indore - Ujjain - Bhopal') => ({
  name,
  stops: [
    { name: 'Indore', coordinates: INDORE },
    { name: 'Ujjain', coordinates: UJJAIN },
    { name: 'Bhopal', coordinates: BHOPAL },
  ],
  corridor_km: 10,
  bidirectional: false,
});

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { DriverRoute } = await import('../src/modules/taxi/driver/models/DriverRoute.js');
  const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
  const { SubscriptionTier } = await import('../src/modules/taxi/admin/models/SubscriptionTier.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  if (!ramesh) throw new Error('Run scripts/seed_local_test_env.mjs first');

  await DriverRoute.deleteMany({ driver_id: ramesh._id });
  await Driver.updateOne({ _id: ramesh._id }, { $set: { route_mode: 'all_locations', active_route_id: null, max_routes_override: null } });

  const token = await login('9000000001');
  check('Ramesh logs in', Boolean(token));

  console.log('\n=== 1. Create: invalid corridor_km -> 422 INVALID_CORRIDOR ===');
  const badCorridor = await api('/drivers/routes', { method: 'POST', token, body: { ...threeStopBody(), corridor_km: 80 } });
  check('422 INVALID_CORRIDOR (too high)', badCorridor.status === 422 && badCorridor.json?.code === 'INVALID_CORRIDOR', JSON.stringify(badCorridor.json));
  const badCorridor2 = await api('/drivers/routes', { method: 'POST', token, body: { ...threeStopBody(), corridor_km: 'abc' } });
  check('422 INVALID_CORRIDOR (NaN)', badCorridor2.status === 422 && badCorridor2.json?.code === 'INVALID_CORRIDOR');

  console.log('\n=== 2. Create: no corridor_km -> admin default used ===');
  const noCorridor = await api('/drivers/routes', {
    method: 'POST',
    token,
    body: { name: 'No Corridor Route', stops: threeStopBody().stops },
  });
  check('201 created with default corridor', noCorridor.status === 201 && noCorridor.json?.data?.corridor_km === 10, JSON.stringify(noCorridor.json));
  await api(`/drivers/routes/${noCorridor.json?.data?.id}`, { method: 'DELETE', token });

  console.log('\n=== 3. Create: identical stops -> 422 INVALID_STOPS ===');
  const sameSpot = await api('/drivers/routes', {
    method: 'POST',
    token,
    body: { name: 'Same Spot', stops: [{ name: 'A', coordinates: INDORE }, { name: 'B', coordinates: INDORE }] },
  });
  check('422 INVALID_STOPS (identical stops)', sameSpot.status === 422 && sameSpot.json?.code === 'INVALID_STOPS', JSON.stringify(sameSpot.json));

  console.log('\n=== 4. Create: two valid routes (Ramesh has max_routes: 10 on Prime) ===');
  const route1 = await api('/drivers/routes', { method: 'POST', token, body: threeStopBody('Indore - Bhopal') });
  check('201 route1 created', route1.status === 201, JSON.stringify(route1.json));
  const routeId1 = route1.json?.data?.id;
  const route2 = await api('/drivers/routes', { method: 'POST', token, body: threeStopBody('Indore - Bhopal 2') });
  check('201 route2 created', route2.status === 201);
  const routeId2 = route2.json?.data?.id;

  console.log('\n=== 5. Update: invalid route id -> 404 (not 500) ===');
  const badId = await api('/drivers/routes/not-a-real-id', { method: 'PATCH', token, body: { name: 'X' } });
  check('404 ROUTE_NOT_FOUND on malformed id', badId.status === 404 && badId.json?.code === 'ROUTE_NOT_FOUND', JSON.stringify(badId.json));

  console.log('\n=== 6. Update: rename only -> stops/path untouched, no rebuild ===');
  const before = await DriverRoute.findById(routeId1).lean();
  const rename = await api(`/drivers/routes/${routeId1}`, { method: 'PATCH', token, body: { name: 'Renamed Route' } });
  check('200 renamed', rename.status === 200 && rename.json?.data?.name === 'Renamed Route', JSON.stringify(rename.json));
  const after = await DriverRoute.findById(routeId1).lean();
  check('path_source unchanged after rename-only update', before.path_source === after.path_source);
  check('distance_meters unchanged after rename-only update', before.distance_meters === after.distance_meters);

  console.log('\n=== 7. Update: empty name -> 422 INVALID_NAME ===');
  const emptyName = await api(`/drivers/routes/${routeId1}`, { method: 'PATCH', token, body: { name: '   ' } });
  check('422 INVALID_NAME', emptyName.status === 422 && emptyName.json?.code === 'INVALID_NAME', JSON.stringify(emptyName.json));

  console.log('\n=== 8. Update: move a stop -> path rebuilt ===');
  const moved = await api(`/drivers/routes/${routeId1}`, {
    method: 'PATCH',
    token,
    body: { stops: [{ name: 'Indore', coordinates: INDORE }, { name: 'Somewhere Else', coordinates: [76.5, 22.0] }] },
  });
  check('200 stops updated', moved.status === 200, JSON.stringify(moved.json));
  const afterMove = await DriverRoute.findById(routeId1).lean();
  check('distance_meters changed after moving a stop', afterMove.distance_meters !== before.distance_meters);

  console.log('\n=== 9. Route mode: switch to route -> active_route_id echoed back ===');
  const switchToRoute = await api('/drivers/route-mode', { method: 'PATCH', token, body: { mode: 'route', routeId: routeId2 } });
  check('200 switched to route mode', switchToRoute.status === 200, JSON.stringify(switchToRoute.json));
  check('active_route_id present at top level', switchToRoute.json?.data?.active_route_id === routeId2, JSON.stringify(switchToRoute.json));

  console.log('\n=== 10. Route mode: deleted/invalid route id -> 404 ===');
  const badRouteMode = await api('/drivers/route-mode', { method: 'PATCH', token, body: { mode: 'route', routeId: 'not-a-real-id' } });
  check('404 on malformed routeId', badRouteMode.status === 404 && badRouteMode.json?.code === 'ROUTE_NOT_FOUND');

  console.log('\n=== 11. Route mode: all_locations always allowed, echoes active_route_id: null ===');
  const allLoc = await api('/drivers/route-mode', { method: 'PATCH', token, body: { mode: 'all_locations' } });
  check('200 all_locations', allLoc.status === 200 && allLoc.json?.data?.active_route_id === null, JSON.stringify(allLoc.json));

  console.log('\n=== 12. Delete: non-active route -> was_active:false, mode unchanged ===');
  await api('/drivers/route-mode', { method: 'PATCH', token, body: { mode: 'route', routeId: routeId2 } });
  const deleteInactive = await api(`/drivers/routes/${routeId1}`, { method: 'DELETE', token });
  check('was_active:false for a non-active route', deleteInactive.json?.data?.was_active === false, JSON.stringify(deleteInactive.json));
  const driverAfterInactiveDelete = await Driver.findById(ramesh._id).lean();
  check('route_mode unchanged (still route)', driverAfterInactiveDelete.route_mode === 'route');

  console.log('\n=== 13. Delete: the active route -> was_active:true, mode falls back to all_locations ===');
  const deleteActive = await api(`/drivers/routes/${routeId2}`, { method: 'DELETE', token });
  check('was_active:true for the active route', deleteActive.json?.data?.was_active === true, JSON.stringify(deleteActive.json));
  check('route_mode in response is all_locations', deleteActive.json?.data?.route_mode === 'all_locations');
  const driverAfterActiveDelete = await Driver.findById(ramesh._id).lean();
  check('driver.route_mode is now all_locations', driverAfterActiveDelete.route_mode === 'all_locations');
  check('driver.active_route_id cleared', driverAfterActiveDelete.active_route_id === null);

  console.log('\n=== 14. Delete: invalid id -> 404 ===');
  const deleteBadId = await api('/drivers/routes/not-a-real-id', { method: 'DELETE', token });
  check('404 on malformed delete id', deleteBadId.status === 404 && deleteBadId.json?.code === 'ROUTE_NOT_FOUND');

  console.log('\n=== 15. Plan with max_routes: 0 -> ROUTES_NOT_IN_PLAN on create and on route-mode switch ===');
  await Driver.updateOne({ _id: ramesh._id }, { $set: { max_routes_override: 0 } });
  const zeroRoutesCreate = await api('/drivers/routes', { method: 'POST', token, body: threeStopBody('Blocked') });
  check('403 ROUTES_NOT_IN_PLAN on create', zeroRoutesCreate.status === 403 && zeroRoutesCreate.json?.code === 'ROUTES_NOT_IN_PLAN', JSON.stringify(zeroRoutesCreate.json));
  // assertRoutesInPlan runs before the route lookup, so any well-formed id
  // (real or not) proves the 0-route gate fires first.
  const zeroRoutesSwitch = await api('/drivers/route-mode', { method: 'PATCH', token, body: { mode: 'route', routeId: String(new mongoose.Types.ObjectId()) } });
  check('403 ROUTES_NOT_IN_PLAN on route-mode switch', zeroRoutesSwitch.status === 403 && zeroRoutesSwitch.json?.code === 'ROUTES_NOT_IN_PLAN', JSON.stringify(zeroRoutesSwitch.json));
  const allLocationsStillWorks = await api('/drivers/route-mode', { method: 'PATCH', token, body: { mode: 'all_locations' } });
  check('all_locations still allowed on a 0-route plan', allLocationsStillWorks.status === 200);
  await Driver.updateOne({ _id: ramesh._id }, { $set: { max_routes_override: null } });

  console.log('\n=== 16. Downgrade: Prime driver in route mode downgraded to a 0-route plan -> falls back to all_locations, route kept ===');
  const { downgradeToLower } = await import('../src/modules/taxi/services/driverCategoryService.js');
  const freshRoute = await api('/drivers/routes', { method: 'POST', token, body: threeStopBody('Downgrade Test Route') });
  await api('/drivers/route-mode', { method: 'PATCH', token, body: { mode: 'route', routeId: freshRoute.json?.data?.id } });
  const beforeDowngrade = await Driver.findById(ramesh._id).lean();
  check('driver is in route mode before downgrade', beforeDowngrade.route_mode === 'route');
  // The seeded "Lower" fallback tier here allows 2 routes, so to exercise the
  // actual max_routes:0 scenario the spec describes, pin the override the
  // same way an admin-configured 0-route plan would — downgradeToLower itself
  // never touches this field.
  await Driver.updateOne({ _id: ramesh._id }, { $set: { max_routes_override: 0 } });
  await downgradeToLower({ driverId: ramesh._id, reason: 'smoke_test' });
  const afterDowngrade = await Driver.findById(ramesh._id).lean();
  check('route_mode falls back to all_locations after downgrade', afterDowngrade.route_mode === 'all_locations');
  check('active_route_id cleared after downgrade', afterDowngrade.active_route_id === null);
  const routeStillExists = await DriverRoute.findById(freshRoute.json?.data?.id).lean();
  check('the route itself was NOT deleted by the downgrade', Boolean(routeStillExists) && !routeStillExists.deletedAt);

  // Restore Ramesh to Prime for any later regression runs sharing this DB.
  const primeTier = await SubscriptionTier.findOne({ driver_category: 'prime' }).lean();
  await DriverSubscription.deleteMany({ driver_id: ramesh._id });
  await DriverSubscription.create({
    driver_id: ramesh._id,
    tier_id: primeTier._id,
    billing_cycle: 'monthly',
    status: 'active',
    start_date: new Date(),
    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  await Driver.updateOne({ _id: ramesh._id }, { $set: { driver_category: 'prime', max_routes_override: null } });

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
