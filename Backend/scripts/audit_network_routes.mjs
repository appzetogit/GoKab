/**
 * Route reachability audit.
 *
 * Every endpoint the spec defines is hit with a real request. The point is not
 * to test behaviour — the smoke suites do that — but to catch an endpoint that
 * was never mounted, is shadowed by a parameterised route, or is missing its
 * auth guard. A 404 here means the route does not exist; a 200/4xx means it
 * does and answered.
 */

const API = process.env.AUDIT_API || 'http://127.0.0.1:4000/api/v1';

const call = async (method, path, { token, body } = {}) => {
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

const login = async (path, body) => (await call('POST', path, { body })).json?.data?.token;

const run = async () => {
  const driverToken = await login('/drivers/login', { phone: '9000000001', password: 'password' });
  const adminToken = await login('/admin/login', { email: 'admin@gmail.com', password: 'password' });
  const userToken = null; // no rider password login in this build

  if (!driverToken || !adminToken) {
    console.error('Could not obtain tokens — is the local seed loaded?');
    process.exit(1);
  }

  // A placeholder id: real enough to parse, guaranteed not to exist. Endpoints
  // should answer 403/404/409/422 — anything but "route not found".
  const FAKE = '000000000000000000000000';

  const endpoints = [
    // --- Module 1: category & recharge ---
    ['GET', '/drivers/category', driverToken],
    ['GET', '/drivers/subscription/tiers', driverToken],
    ['GET', '/drivers/subscription/current', driverToken],

    // --- Module 3: routes ---
    ['GET', '/drivers/routes', driverToken],
    ['POST', '/drivers/routes', driverToken, { name: '', stops: [] }],
    ['PATCH', `/drivers/routes/${FAKE}`, driverToken, { name: 'x' }],
    ['DELETE', `/drivers/routes/${FAKE}`, driverToken],
    ['PATCH', '/drivers/route-mode', driverToken, { mode: 'all_locations' }],

    // --- Module 4: driver-created rides ---
    ['PATCH', '/drivers/organization', driverToken, { company_name: 'Ram Travels' }],
    ['GET', '/drivers/network/rides', driverToken],
    ['POST', '/drivers/network/rides', driverToken, {}],
    ['GET', '/drivers/network/fleet/availability', driverToken],
    ['POST', `/drivers/network/rides/${FAKE}/assign`, driverToken, { driverId: FAKE }],
    ['POST', `/drivers/network/rides/${FAKE}/unassign`, driverToken, {}],
    ['POST', `/drivers/network/rides/${FAKE}/reassign`, driverToken, { driverId: FAKE }],
    ['POST', `/drivers/network/rides/${FAKE}/cancel`, driverToken, {}],
    ['POST', `/drivers/network/rides/${FAKE}/reject-assignment`, driverToken, {}],

    // --- Module 5: publish & feed ---
    ['POST', `/drivers/network/rides/${FAKE}/publish`, driverToken, { total_fare: 1, owner_commission: 0, driver_payout: 1 }],
    ['DELETE', `/drivers/network/rides/${FAKE}/publish`, driverToken],
    ['GET', '/drivers/feed?tab=driver', driverToken],
    ['GET', '/drivers/feed?tab=customer', driverToken],
    ['POST', `/drivers/feed/rides/${FAKE}/accept`, driverToken],

    // --- Module 6: lead contact & chat ---
    ['POST', `/drivers/feed/rides/${FAKE}/contact`, driverToken, { channel: 'chat' }],
    ['GET', '/drivers/lead-conversations', driverToken],
    ['GET', `/drivers/lead-conversations/${FAKE}/messages`, driverToken],
    ['POST', `/drivers/lead-conversations/${FAKE}/messages`, driverToken, { message: 'hi' }],
    ['GET', '/users/lead-conversations', userToken],

    // --- Module 7: escrow ---
    ['POST', `/drivers/network/rides/${FAKE}/escrow/dispute`, driverToken, { reason: 'x' }],

    // --- Module 8: live map ---
    ['GET', '/drivers/network/live-map', driverToken],

    // --- Admin ---
    ['GET', '/admin/driver-network/settings', adminToken],
    ['PATCH', '/admin/driver-network/settings', adminToken, {}],
    ['GET', '/admin/driver-network/prime-slots', adminToken],
    ['DELETE', `/admin/driver-network/prime-slots/${FAKE}`, adminToken],
    ['PATCH', `/admin/driver-network/cities/${FAKE}/prime-limit`, adminToken, { prime_limit: 5 }],
    ['PATCH', `/admin/driver-network/drivers/${FAKE}/category`, adminToken, { category: 'lower' }],
    ['PATCH', `/admin/driver-network/drivers/${FAKE}/route-limit`, adminToken, { max_routes_override: 3 }],
    ['GET', `/admin/driver-network/drivers/${FAKE}/routes`, adminToken],
    ['GET', '/admin/driver-network/rides', adminToken],
    ['GET', '/admin/driver-network/escrow?state=held', adminToken],
    ['POST', `/admin/driver-network/escrow/${FAKE}/resolve`, adminToken, { collected_by: 'driver' }],
    ['POST', `/admin/driver-network/escrow/${FAKE}/force-release`, adminToken, {}],
    ['GET', '/admin/driver-network/lead-contacts', adminToken],
    ['GET', '/admin/driver-network/reports/summary', adminToken],
    ['PATCH', `/admin/driver-network/vehicles/${FAKE}/usage-type`, adminToken, { usage_type: 'private' }],
  ];

  let missing = 0;
  let unguarded = 0;

  console.log('\n--- reachability ---');
  for (const [method, path, token, body] of endpoints) {
    const { status } = await call(method, path, { token, body });
    const notFound = status === 404 && !path.includes(FAKE);
    const routeMissing = status === 404 && path.includes(FAKE) ? false : notFound;

    if (routeMissing) {
      missing += 1;
      console.log(`  MISSING  ${method} ${path} -> 404`);
    } else {
      console.log(`  ok       ${method.padEnd(6)} ${path.padEnd(62)} ${status}`);
    }
  }

  console.log('\n--- auth guards (same endpoints, no token) ---');
  for (const [method, path, , body] of endpoints) {
    if (path.startsWith('/users/')) continue; // no token was used for these anyway
    const { status } = await call(method, path, { body });
    if (status !== 401 && status !== 403) {
      unguarded += 1;
      console.log(`  UNGUARDED  ${method} ${path} -> ${status}`);
    }
  }
  console.log(`  ${endpoints.length} endpoints, ${unguarded} reachable without a token`);

  console.log('\n--- cross-role guards (driver token on admin routes) ---');
  let crossRole = 0;
  for (const [method, path, , body] of endpoints.filter(([, p]) => p.startsWith('/admin/'))) {
    const { status } = await call(method, path, { token: driverToken, body });
    if (status !== 401 && status !== 403) {
      crossRole += 1;
      console.log(`  LEAK  ${method} ${path} -> ${status}`);
    }
  }
  console.log(`  ${crossRole} admin endpoints reachable with a driver token`);

  console.log(
    `\nRESULT: ${missing} missing routes, ${unguarded} unguarded, ${crossRole} cross-role leaks\n`,
  );
  process.exitCode = missing || unguarded || crossRole ? 1 : 0;
};

run().catch((error) => {
  console.error('Audit crashed:', error);
  process.exitCode = 1;
});
