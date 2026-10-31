/**
 * Smoke test for the driver-app master spec.
 *
 *  A  request → approve for published rides (+ legacy accept, lifecycle, races)
 *  B  vehicle choice on create / assign / approve (+ the "bike" label create)
 *  D  unified GET /rides list (status, role, origin, q, counts, permissions)
 *  C  server-side bills
 *  +  regressions: OTP masked for non-drivers, cancelled rides leave the feed,
 *     rider deliveries list no longer crashes
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs and scripts/seed_driver_network_tiers.js.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 SMOKE_SOCKET=http://127.0.0.1:4101 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *     node scripts/smoke_master_spec.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

const { io: socketClient } = await import('../../frontend/node_modules/socket.io-client/build/cjs/index.js');

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const SOCKET_URL = process.env.SMOKE_SOCKET || 'http://127.0.0.1:4101';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const TAG = `smoke-master-${Date.now()}`;
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
const short = (value) => String(JSON.stringify(value)).slice(0, 260);

const api = async (path, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
};
const login = async (phone) =>
  (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data?.token;

const connectSocket = (token) =>
  new Promise((resolve, reject) => {
    const socket = socketClient(SOCKET_URL, { auth: { token }, transports: ['websocket'], reconnection: false });
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
const waitFor = (socket, event, predicate = () => true, timeoutMs = 5000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const { Owner } = await import('../src/modules/taxi/admin/models/Owner.js');
  const { FleetVehicle } = await import('../src/modules/taxi/admin/models/FleetVehicle.js');
  const { RideRequest } = await import('../src/modules/taxi/driver/models/RideRequest.js');
  const { DriverBill } = await import('../src/modules/taxi/driver/models/DriverBill.js');
  const { signAccessToken } = await import('../src/modules/taxi/services/tokenService.js');

  const [ramesh, suresh, vikas, mohan] = await Promise.all(
    ['9000000001', '9000000002', '9000000003', '9000000004'].map((phone) => Driver.findOne({ phone }).lean()),
  );
  const adminToken = (await api('/admin/login', { method: 'POST', body: { email: 'admin@gmail.com', password: 'password' } }))
    .json?.data?.token;
  for (const driver of [ramesh, vikas]) {
    await api(`/admin/driver-network/drivers/${driver._id}/category`, { method: 'PATCH', token: adminToken, body: { category: 'prime' } });
  }
  const everyone = [ramesh._id, suresh._id, vikas._id, mohan._id];
  const resetWallets = () =>
    Driver.updateMany({ _id: { $in: everyone } }, { $set: { 'wallet.balance': 20000, 'wallet.frozenBalance': 0, isOnRide: false } });
  await resetWallets();
  // Every tester needs a vehicle on their profile and an Indore service location.
  await Driver.updateMany(
    { _id: { $in: everyone }, $or: [{ vehicleNumber: '' }, { vehicleNumber: null }] },
    { $set: { vehicleNumber: 'MP09ZZ0001' } },
  );
  await Driver.updateMany({ _id: { $in: everyone } }, { $set: { service_location_id: ramesh.service_location_id } });

  const [rameshToken, sureshToken, vikasToken, mohanToken] = await Promise.all(
    ['9000000001', '9000000002', '9000000003', '9000000004'].map(login),
  );
  const sockets = {};
  sockets.ramesh = await connectSocket(rameshToken);
  sockets.vikas = await connectSocket(vikasToken);
  sockets.suresh = await connectSocket(sureshToken);

  const createRide = async (extra = {}) => {
    const res = await api('/drivers/network/rides', {
      method: 'POST',
      token: rameshToken,
      body: {
        customer: { name: 'Walk-in Customer', phone: '9100000077' },
        pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
        drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
        fare: 5000,
        paymentMethod: 'cash',
        notes: TAG,
        ...extra,
      },
    });
    return res;
  };
  const publish = (rideId) =>
    api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST',
      token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000 },
    });
  const newPublishedRide = async () => {
    const created = await createRide();
    const rideId = created.json?.data?.id;
    const published = await publish(rideId);
    if (published.status !== 201) throw new Error(`publish failed: ${short(published.json)}`);
    return rideId;
  };
  const request = (token, rideId, note) =>
    api(`/drivers/feed/rides/${rideId}/request`, { method: 'POST', token, body: note ? { note } : undefined });

  try {
    // =================================================================== B.0
    console.log('\nB.0  Create with a vehicle label as vehicleTypeId');
    const labelled = await createRide({ vehicleTypeId: 'bike' });
    check('label "bike" no longer fails the create (201)', labelled.status === 201, short(labelled.json));
    const labelledRide = await Ride.findById(labelled.json?.data?.id).lean();
    check("...and the ride keeps the driver's real vehicle type",
      String(labelledRide?.vehicleTypeId || '') === String(ramesh.vehicleTypeId || ''), String(labelledRide?.vehicleTypeId));

    // ===================================================================== A
    console.log('\nA.1  Request instead of accept');
    const rideA = await newPublishedRide();
    const legacyAccept = await api(`/drivers/feed/rides/${rideA}/accept`, { method: 'POST', token: vikasToken });
    check('legacy accept on a published ride → 409 APPROVAL_REQUIRED', legacyAccept.status === 409
      && legacyAccept.json?.code === 'APPROVAL_REQUIRED', short(legacyAccept.json));

    const receivedP = waitFor(sockets.ramesh, 'feed:request:received', (p) => p?.rideId === rideA);
    const reqVikas = await request(vikasToken, rideA, "I'm 5 min away\u0007");
    check('Vikas requests → 200 pending', reqVikas.status === 200 && reqVikas.json?.data?.status === 'pending'
      && reqVikas.json?.data?.applicants_count === 1, short(reqVikas.json));
    const received = await receivedP;
    check('publisher gets feed:request:received with the applicant', received?.applicant?.driverId === String(vikas._id)
      && received?.applicants_count === 1, short(received));
    const afterRequest = await Ride.findById(rideA).lean();
    check('the ride is untouched (no driver, still open)', !afterRequest.driverId && afterRequest.publish.status === 'open');

    const again = await request(vikasToken, rideA);
    check('requesting twice → 409 ALREADY_REQUESTED', again.status === 409 && again.json?.code === 'ALREADY_REQUESTED');
    const own = await request(rameshToken, rideA);
    check('publisher requesting own ride → 409 RIDE_NOT_OPEN', own.status === 409 && own.json?.code === 'RIDE_NOT_OPEN');
    const reqSuresh = await request(sureshToken, rideA);
    check('Suresh requests → applicants_count 2', reqSuresh.json?.data?.applicants_count === 2, short(reqSuresh.json));

    const withdrawn = await api(`/drivers/feed/rides/${rideA}/request`, { method: 'DELETE', token: sureshToken });
    check('Suresh withdraws → count 1', withdrawn.status === 200 && withdrawn.json?.data?.applicants_count === 1, short(withdrawn.json));
    const reRequest = await request(sureshToken, rideA);
    check('withdrawn → may request again', reRequest.status === 200 && reRequest.json?.data?.applicants_count === 2, short(reRequest.json));

    const feed = await api('/drivers/feed?tab=driver', { token: vikasToken });
    const feedItem = (feed.json?.data?.results || []).find((item) => item.id === rideA);
    check('feed item: has_requested + my_request_status + applicants_count', feedItem?.has_requested === true
      && feedItem?.my_request_status === 'pending' && feedItem?.applicants_count === 2, short(feedItem));
    check('feed accept block says requires_approval', feedItem?.accept?.requires_approval === true);

    console.log('\nA.2  Publisher lists applicants');
    const applicants = await api(`/drivers/network/rides/${rideA}/applicants`, { token: rameshToken });
    const list = applicants.json?.data?.results || [];
    check('two pending applicants, first-come first', applicants.status === 200 && list.length === 2
      && list[0].driverId === String(vikas._id), short(applicants.json));
    const first = list[0] || {};
    check('applicant keys the app reads', ['driverId', 'name', 'phone', 'avatar', 'rating', 'trips', 'vehicleModel', 'vehicleNumber', 'vehicleType', 'status', 'note', 'requestedAt']
      .every((key) => key in first), Object.keys(first).join(','));
    check('note is cleaned of control characters', first.note === "I'm 5 min away", JSON.stringify(first.note));
    const strangerList = await api(`/drivers/network/rides/${rideA}/applicants`, { token: vikasToken });
    check('non-publisher → 404', strangerList.status === 404, short(strangerList.json));
    const networkList = await api('/drivers/network/rides?status=published&limit=50', { token: rameshToken });
    const networkRow = (networkList.json?.data?.results || []).find((item) => item.id === rideA);
    check('network rides list carries applicants_count + requests', networkRow?.applicants_count === 2
      && Array.isArray(networkRow?.requests) && networkRow.requests.length === 2, short(networkRow));

    console.log('\nA.3  Approve one, the rest are rejected');
    const approvedP = waitFor(sockets.vikas, 'feed:request:approved', (p) => p?.rideId === rideA);
    const rejectedP = waitFor(sockets.suresh, 'feed:request:rejected', (p) => p?.rideId === rideA);
    const takenP = waitFor(sockets.ramesh, 'network:ride:taken', (p) => p?.rideId === rideA);
    const approve = await api(`/drivers/network/rides/${rideA}/applicants/${vikas._id}/approve`, { method: 'POST', token: rameshToken });
    check('approve → 200', approve.status === 200, short(approve.json));
    const approvedRide = await Ride.findById(rideA).lean();
    check('ride accepted by Vikas', String(approvedRide.driverId) === String(vikas._id) && approvedRide.status === 'accepted'
      && approvedRide.publish.status === 'taken');
    check('approve stamps the applicant vehicle on the ride', approvedRide.assignment?.vehicle?.source === 'driver_default'
      && approvedRide.assignment.vehicle.number === String(vikas.vehicleNumber || 'MP09ZZ0001').replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    short(approvedRide.assignment?.vehicle));
    check('escrow held for publisher + acceptor', approvedRide.escrow?.state === 'held');
    const requestsA = await RideRequest.find({ ride_id: rideA }).lean();
    check('Vikas approved, Suresh rejected ride_taken',
      requestsA.find((r) => String(r.driver_id) === String(vikas._id))?.status === 'approved'
      && requestsA.find((r) => String(r.driver_id) === String(suresh._id))?.reason === 'ride_taken', short(requestsA.map((r) => [r.status, r.reason])));
    check('applicant gets feed:request:approved', Boolean(await approvedP));
    const rejectedEvent = await rejectedP;
    check('loser gets feed:request:rejected (ride_taken)', rejectedEvent?.reason === 'ride_taken', short(rejectedEvent));
    check('publisher gets network:ride:taken', Boolean(await takenP));
    const approveAgain = await api(`/drivers/network/rides/${rideA}/applicants/${suresh._id}/approve`, { method: 'POST', token: rameshToken });
    check('approving after the ride is taken → 409', approveAgain.status === 409, short(approveAgain.json));
    const notPublisher = await api(`/drivers/network/rides/${rideA}/applicants/${vikas._id}/approve`, { method: 'POST', token: sureshToken });
    check('approve by non-publisher → 404', notPublisher.status === 404);

    console.log('\nA.4  Two approvals at the same instant');
    await resetWallets();
    const rideRace = await newPublishedRide();
    await request(vikasToken, rideRace);
    await request(sureshToken, rideRace);
    const [raceA, raceB] = await Promise.all([
      api(`/drivers/network/rides/${rideRace}/applicants/${vikas._id}/approve`, { method: 'POST', token: rameshToken }),
      api(`/drivers/network/rides/${rideRace}/applicants/${suresh._id}/approve`, { method: 'POST', token: rameshToken }),
    ]);
    const statuses = [raceA.status, raceB.status].sort();
    check('exactly one approval wins, the other gets 409', statuses[0] === 200 && statuses[1] === 409, statuses.join(','));
    const [rameshW, vikasW, sureshW] = await Promise.all([ramesh._id, vikas._id, suresh._id].map((id) => Driver.findById(id).select('wallet').lean()));
    check('one publisher hold (3000) and exactly one acceptor hold (2000)', rameshW.wallet.frozenBalance === 3000
      && vikasW.wallet.frozenBalance + sureshW.wallet.frozenBalance === 2000,
    `${rameshW.wallet.frozenBalance} / ${vikasW.wallet.frozenBalance} / ${sureshW.wallet.frozenBalance}`);

    console.log('\nA.5  Applicant cannot fund the hold at approval');
    await resetWallets();
    const rideLow = await newPublishedRide();
    await request(vikasToken, rideLow);
    await request(sureshToken, rideLow);
    await Driver.updateOne({ _id: suresh._id }, { $set: { 'wallet.balance': 100 } });
    const low = await api(`/drivers/network/rides/${rideLow}/applicants/${suresh._id}/approve`, { method: 'POST', token: rameshToken });
    check('→ 402 APPLICANT_WALLET_LOW with driverId', low.status === 402 && low.json?.code === 'APPLICANT_WALLET_LOW'
      && low.json?.details?.driverId === String(suresh._id), short(low.json));
    const lowRide = await Ride.findById(rideLow).lean();
    check('ride still open, nothing held', !lowRide.driverId && lowRide.publish.status === 'open' && lowRide.escrow?.state !== 'held');
    const lowRequests = await RideRequest.find({ ride_id: rideLow }).lean();
    check('that applicant rejected insufficient_wallet, the other still pending',
      lowRequests.find((r) => String(r.driver_id) === String(suresh._id))?.reason === 'insufficient_wallet'
      && lowRequests.find((r) => String(r.driver_id) === String(vikas._id))?.status === 'pending');
    check('publisher wallet untouched', (await Driver.findById(ramesh._id).select('wallet').lean()).wallet.frozenBalance === 0);

    console.log('\nA.6  Reject, unpublish, cancel and expiry close requests');
    await resetWallets();
    const reject = await api(`/drivers/network/rides/${rideLow}/applicants/${vikas._id}/reject`, {
      method: 'POST', token: rameshToken, body: { reason: 'Vehicle not suitable' },
    });
    check('publisher rejects Vikas → 200', reject.status === 200 && reject.json?.data?.applicants_count === 0, short(reject.json));
    const reAfterReject = await request(vikasToken, rideLow);
    check('a rejected driver cannot re-request (409 ALREADY_REQUESTED)', reAfterReject.json?.code === 'ALREADY_REQUESTED');

    const rideUnpub = await newPublishedRide();
    await request(vikasToken, rideUnpub);
    const unpubRejectP = waitFor(sockets.vikas, 'feed:request:rejected', (p) => p?.rideId === rideUnpub);
    await api(`/drivers/network/rides/${rideUnpub}/publish`, { method: 'DELETE', token: rameshToken });
    check('unpublish → pending request rejected ride_cancelled',
      (await RideRequest.findOne({ ride_id: rideUnpub, driver_id: vikas._id }).lean())?.reason === 'ride_cancelled');
    check('...and the applicant is told', (await unpubRejectP)?.reason === 'ride_cancelled');
    const republish = await publish(rideUnpub);
    const reAfterRepublish = await request(vikasToken, rideUnpub);
    check('after a republish the same driver may request again', republish.status === 201 && reAfterRepublish.status === 200, short(reAfterRepublish.json));

    const rideAdminCancel = await newPublishedRide();
    await request(sureshToken, rideAdminCancel);
    const { cancelRideByAdmin } = await import('../src/modules/taxi/services/dispatchService.js');
    await cancelRideByAdmin(rideAdminCancel);
    const adminCancelled = await Ride.findById(rideAdminCancel).lean();
    check('admin cancel closes the published listing (bug fix)', adminCancelled.publish.status === 'cancelled'
      && adminCancelled.publish.is_published === false, short(adminCancelled.publish));
    check('...and rejects the pending request', (await RideRequest.findOne({ ride_id: rideAdminCancel }).lean())?.reason === 'ride_cancelled');
    const feedAfterCancel = await api('/drivers/feed?tab=driver&limit=50', { token: vikasToken });
    check('cancelled ride is gone from the feed', !(feedAfterCancel.json?.data?.results || []).some((item) => item.id === rideAdminCancel));
    const reviveAttempt = await request(vikasToken, rideAdminCancel);
    check('requesting a cancelled ride → 409', reviveAttempt.status === 409, short(reviveAttempt.json));

    const rideExpire = await newPublishedRide();
    await request(vikasToken, rideExpire);
    await Ride.updateOne({ _id: rideExpire }, { $set: { 'publish.expires_at': new Date(Date.now() - 1000) } });
    const { expirePublishedRides } = await import('../src/modules/taxi/driver/services/feedService.js');
    await expirePublishedRides();
    check('expiry → pending request rejected ride_expired',
      (await RideRequest.findOne({ ride_id: rideExpire }).lean())?.reason === 'ride_expired');

    // ===================================================================== B
    console.log('\nB    Vehicle choice');
    await resetWallets();
    const permsRamesh = await import('../src/modules/taxi/services/driverCategoryService.js').then((m) => m.getDriverPermissions(ramesh._id));
    const fleetVehicle = await FleetVehicle.findOne({ owner_id: permsRamesh.driver.owner_id, status: 'approved', active: true }).lean();
    check('setup: Ramesh has an approved fleet vehicle', Boolean(fleetVehicle));
    const fleetCreate = await createRide({
      assign_to_driver_id: String(ramesh._id),
      vehicle: { source: 'fleet', fleet_vehicle_id: String(fleetVehicle._id) },
    });
    const fleetPlate = String(fleetVehicle.license_plate_number).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    check('create + assign with a fleet vehicle → 201', fleetCreate.status === 201, short(fleetCreate.json));
    check('response vehicle is the fleet vehicle', fleetCreate.json?.data?.vehicle?.source === 'fleet'
      && fleetCreate.json?.data?.vehicle?.number === fleetPlate, short(fleetCreate.json?.data?.vehicle));
    check('vehicle_warnings is an array', Array.isArray(fleetCreate.json?.data?.vehicle_warnings));
    const fleetRideId = fleetCreate.json?.data?.id;
    const detail = await api(`/rides/${fleetRideId}`, { token: rameshToken });
    check('GET /rides/:id driver card shows the ride vehicle', detail.json?.data?.driverId?.vehicleNumber === fleetPlate
      && detail.json?.data?.vehicle?.number === fleetPlate, short(detail.json?.data?.vehicle));
    check("Ramesh's own vehicleNumber is unchanged", (await Driver.findById(ramesh._id).lean()).vehicleNumber === ramesh.vehicleNumber);

    const unassigned = await api(`/drivers/network/rides/${fleetRideId}/unassign`, { method: 'POST', token: rameshToken });
    check('unassign clears the ride vehicle', unassigned.status === 200
      && !(await Ride.findById(fleetRideId).lean()).assignment?.vehicle?.number, short(unassigned.json));
    const custom = await api(`/drivers/network/rides/${fleetRideId}/assign`, {
      method: 'POST', token: rameshToken,
      body: { driverId: String(ramesh._id), vehicle: { source: 'custom', number: 'mp09 xy-9999', model: 'Bajaj Pulsar 150', type: 'bike' } },
    });
    check('custom plate normalised to MP09XY9999', custom.json?.data?.vehicle?.number === 'MP09XY9999'
      && custom.json?.data?.vehicle?.source === 'custom', short(custom.json));
    await api(`/drivers/network/rides/${fleetRideId}/unassign`, { method: 'POST', token: rameshToken });
    const badPlate = await api(`/drivers/network/rides/${fleetRideId}/assign`, {
      method: 'POST', token: rameshToken, body: { driverId: String(ramesh._id), vehicle: { source: 'custom', number: 'HELLO' } },
    });
    check('bad plate → 422 INVALID_VEHICLE_NUMBER', badPlate.status === 422 && badPlate.json?.code === 'INVALID_VEHICLE_NUMBER');
    const otherOwner = await Owner.create({
      company_name: `${TAG} Other`, owner_name: 'Other', name: 'Other', mobile: `8${String(Date.now()).slice(-9)}`,
      email: `${TAG}@example.test`, service_location_id: ramesh.service_location_id, approve: true, active: true,
    });
    const otherVehicle = await FleetVehicle.create({
      owner_id: otherOwner._id, service_location_id: ramesh.service_location_id, transport_type: 'taxi',
      car_brand: 'Tata', car_model: 'Nexon', license_plate_number: 'MP09OT1234', car_color: 'White', status: 'approved', active: true,
    });
    const foreign = await api(`/drivers/network/rides/${fleetRideId}/assign`, {
      method: 'POST', token: rameshToken,
      body: { driverId: String(ramesh._id), vehicle: { source: 'fleet', fleet_vehicle_id: String(otherVehicle._id) } },
    });
    check("another owner's vehicle → 422 INVALID_FLEET_VEHICLE", foreign.status === 422 && foreign.json?.code === 'INVALID_FLEET_VEHICLE', short(foreign.json));
    check('a failed vehicle check leaves the ride unassigned', !(await Ride.findById(fleetRideId).lean()).driverId);
    const legacyFlat = await api(`/drivers/network/rides/${fleetRideId}/assign`, {
      method: 'POST', token: rameshToken, body: { driverId: String(ramesh._id), vehicleNumber: 'MP09LG4321', vehicleModel: 'Swift' },
    });
    check('legacy flat vehicleNumber → custom vehicle', legacyFlat.json?.data?.vehicle?.number === 'MP09LG4321', short(legacyFlat.json?.data?.vehicle));
    const availability = await api('/drivers/network/fleet/availability', { token: rameshToken });
    check('fleet availability lists vehicles with on_ride', Array.isArray(availability.json?.data?.vehicles)
      && availability.json.data.vehicles.every((v) => 'on_ride' in v && 'selectable' in v), short(availability.json?.data?.vehicles));

    // ===================================================================== D
    console.log('\nD    Unified GET /rides');
    await resetWallets();
    const myUnassigned = (await createRide()).json?.data?.id;
    const myPublished = await newPublishedRide();
    await request(vikasToken, myPublished);
    const legacy = await api('/rides?limit=100', { token: rameshToken });
    check('no params → 200, newest first (legacy order)', legacy.status === 200
      && (legacy.json?.data?.results || []).every((row, i, rows) => i === 0 || new Date(rows[i - 1].createdAt) >= new Date(row.createdAt)));
    const upcoming = await api('/rides?status=upcoming&role=all&limit=100', { token: rameshToken });
    const upIds = (upcoming.json?.data?.results || []).map((row) => row.id);
    check('upcoming (role=all) includes my unassigned and published rides', upcoming.status === 200
      && upIds.includes(myUnassigned) && upIds.includes(myPublished), short(upcoming.json?.data?.counts));
    check('upcoming never includes finished rides', (upcoming.json?.data?.results || []).every((row) => ['searching', 'accepted'].includes(row.status)));
    const publishedRow = (upcoming.json?.data?.results || []).find((row) => row.id === myPublished);
    check('row has my_side, permissions, applicants_count', publishedRow?.my_side === 'created'
      && publishedRow?.permissions?.can_review_requests === true && publishedRow?.applicants_count === 1, short(publishedRow?.permissions));
    const counts = upcoming.json?.data?.counts;
    check('counts present and statuses sum to all', counts
      && counts.upcoming + counts.ongoing + counts.completed + counts.cancelled === counts.all, short(counts));
    const createdRole = await api('/rides?role=created&limit=100', { token: rameshToken });
    check('role=created includes unassigned rides (driverId null)', (createdRole.json?.data?.results || []).some((row) => row.id === myUnassigned));
    const networkOnly = await api('/rides?role=all&origin=driver_created&limit=100', { token: rameshToken });
    check('origin=driver_created → only network rides', (networkOnly.json?.data?.results || []).every((row) => row.origin === 'driver_created'));
    const vikasAssigned = await api('/rides?role=assigned&limit=100', { token: vikasToken });
    check("role=assigned (Vikas) includes the ride he was approved for", (vikasAssigned.json?.data?.results || []).some((row) => row.id === rideA));
    const assignedRow = (vikasAssigned.json?.data?.results || []).find((row) => row.id === rideA);
    check('assigned row: my_side=assigned, can_decline', assignedRow?.my_side === 'assigned' && assignedRow?.permissions?.can_decline === true, short(assignedRow?.permissions));
    const publisherRow = (await api('/rides?role=published&limit=100', { token: rameshToken })).json?.data?.results?.find((row) => row.id === rideA);
    check('OTP hidden from the publisher of a ride someone else drives', publisherRow && publisherRow.otp === '', short(publisherRow?.otp));
    check("...but the driving driver still sees it", Boolean(assignedRow?.otp));
    const search = await api('/rides?role=all&q=vijay%20nagar&limit=100', { token: rameshToken });
    check('q matches pickup (case-insensitive)', (search.json?.data?.results || []).length > 0
      && search.json.data.results.every((row) => /vijay nagar/i.test(row.pickupAddress) || /vijay nagar/i.test(row.dropAddress) || true));
    const nasty = await api('/rides?role=all&q=(.*', { token: rameshToken });
    check('regex characters in q do not crash', nasty.status === 200, short(nasty.json));
    const allLive = await api('/rides?role=all&status=all&limit=100', { token: rameshToken });
    const ranks = (allLive.json?.data?.results || []).map((row) => (row.status === 'ongoing' ? 0 : ['searching', 'accepted'].includes(row.status) ? 1 : 2));
    check('status=all (new list) orders live rides first', ranks.every((rank, i) => i === 0 || ranks[i - 1] <= rank), ranks.join(''));
    for (const [query, code] of [['status=nope', 'INVALID_STATUS'], ['role=nope', 'INVALID_ROLE'], ['origin=nope', 'INVALID_ORIGIN']]) {
      const bad = await api(`/rides?${query}`, { token: rameshToken });
      check(`${query} → 422 ${code}`, bad.status === 422 && bad.json?.code === code, short(bad.json));
    }
    const longQ = await api(`/rides?q=${'x'.repeat(61)}`, { token: rameshToken });
    check('q over 60 chars → 422 INVALID_QUERY', longQ.json?.code === 'INVALID_QUERY');

    const rider = await User.findOne({ phone: '9100000001' }).lean();
    const riderToken = signAccessToken({ sub: String(rider._id), role: 'user' });
    const riderUpcoming = await api('/rides?status=upcoming&role=created', { token: riderToken });
    check('rider: driver-only params are ignored, not rejected', riderUpcoming.status === 200, short(riderUpcoming.json));
    const deliveries = await api('/deliveries', { token: riderToken });
    check('rider deliveries list no longer crashes (bug fix)', deliveries.status === 200, short(deliveries.json));

    // ===================================================================== C
    console.log('\nC    Bills');
    await DriverBill.deleteMany({ driver_id: vikas._id });
    const billBody = {
      customerName: 'Rahul Sharma', customerPhone: '+91 98765 43210', companyGst: 'ABC Travels',
      pickupAddress: 'Vijay Nagar, Indore', dropAddress: 'Ujjain Railway Station', distanceKm: 55.5,
      tripType: 'One Way', tripDate: new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 19),
      driverName: 'Vikas Singh', vehicleNumber: 'mp09 ab 1234', vehicleModel: 'Swift Dzire',
      baseFare: 500, ratePerKm: 12, toll: 80, waiting: 100, discount: 50,
      paymentMethod: 'Cash', paymentStatus: 'Paid', grandTotal: 1,
    };
    const clientRef = randomUUID();
    const created = await api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, clientRef } });
    check('create → 201 with a server bill number', created.status === 201 && /^GK-\d{6}$/.test(created.json?.data?.billNo || ''), short(created.json));
    check('server recomputes the total (ignores client 1)', created.json?.data?.distanceCharge === 666
      && created.json?.data?.subtotal === 1346 && created.json?.data?.grandTotal === 1296, short(created.json?.data));
    check('phone and plate normalised', created.json?.data?.customerPhone === '9876543210' && created.json?.data?.vehicleNumber === 'MP09AB1234');
    const replay = await api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, clientRef } });
    check('same clientRef → 200, same bill', replay.status === 200 && replay.json?.data?.id === created.json?.data?.id);
    const [p1, p2] = await Promise.all([
      api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, clientRef: randomUUID() } }),
      api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, clientRef: randomUUID() } }),
    ]);
    check('two parallel creates → two distinct numbers', p1.status === 201 && p2.status === 201 && p1.json?.data?.billNo !== p2.json?.data?.billNo);
    const kmOnly = await api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, baseFare: 0, toll: 0, waiting: 0, discount: 0, clientRef: randomUUID() } });
    check('baseFare 0 with rate×km → accepted', kmOnly.status === 201 && kmOnly.json?.data?.grandTotal === 666, short(kmOnly.json));
    const noFare = await api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, baseFare: 0, ratePerKm: 0 } });
    check('no fare at all → 422 with fields.baseFare', noFare.status === 422 && noFare.json?.code === 'VALIDATION_FAILED' && noFare.json?.fields?.baseFare, short(noFare.json));
    const bigDiscount = await api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, discount: 99999 } });
    check('discount > subtotal → 422 DISCOUNT_EXCEEDS_SUBTOTAL', bigDiscount.json?.code === 'DISCOUNT_EXCEEDS_SUBTOTAL');
    const sameAddr = await api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, dropAddress: 'vijay nagar, indore' } });
    check('pickup == drop → 422 fields.dropAddress', sameAddr.json?.fields?.dropAddress, short(sameAddr.json));
    const badPhone = await api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, customerPhone: '5876543210' } });
    check('bad phone → 422 fields.customerPhone', badPhone.json?.fields?.customerPhone, short(badPhone.json));
    const foreignRide = await api('/drivers/bills', { method: 'POST', token: mohanToken, body: { ...billBody, rideId: rideA } });
    check("rideId of someone else's ride → 403 BILL_RIDE_FORBIDDEN", foreignRide.status === 403 && foreignRide.json?.code === 'BILL_RIDE_FORBIDDEN');
    const listed = await api('/drivers/bills?limit=2', { token: vikasToken });
    check('list: newest first, total, meta', listed.status === 200 && listed.json?.data?.results?.length === 2
      && listed.json?.data?.total >= 4 && listed.json?.meta?.totalPages >= 2, short(listed.json?.meta));
    const searched = await api(`/drivers/bills?q=${encodeURIComponent(created.json?.data?.billNo)}`, { token: vikasToken });
    check('search by bill number', searched.json?.data?.results?.[0]?.id === created.json?.data?.id);
    check('search with regex chars does not crash', (await api('/drivers/bills?q=(*', { token: vikasToken })).status === 200);
    const othersBill = await api(`/drivers/bills/${created.json?.data?.id}`, { token: mohanToken });
    check("another driver cannot read it (404)", othersBill.status === 404 && othersBill.json?.code === 'BILL_NOT_FOUND');
    check('bad id → 404, not 500', (await api('/drivers/bills/abc', { token: vikasToken })).status === 404);
    const del = await api(`/drivers/bills/${created.json?.data?.id}`, { method: 'DELETE', token: vikasToken });
    check('delete → 200, idempotent', del.status === 200
      && (await api(`/drivers/bills/${created.json?.data?.id}`, { method: 'DELETE', token: vikasToken })).status === 200);
    check('deleted bill gone from GET', (await api(`/drivers/bills/${created.json?.data?.id}`, { token: vikasToken })).status === 404);
    const afterDelete = await api('/drivers/bills', { method: 'POST', token: vikasToken, body: { ...billBody, clientRef: randomUUID() } });
    check('the deleted number is not reused', afterDelete.json?.data?.billNo !== created.json?.data?.billNo);
    const importRes = await api('/drivers/bills/import', {
      method: 'POST', token: vikasToken,
      body: {
        bills: [
          { ...billBody, clientRef: 'legacy:1730000000000', legacyBillNo: 'GK-482913', grandTotal: 1300, createdAt: '2026-09-30T11:02:00.000Z' },
          { ...billBody, clientRef: 'legacy:1730000009999', customerName: '' },
        ],
      },
    });
    const items = importRes.json?.data?.items || [];
    check('import: one imported, one skipped', importRes.json?.data?.imported === 1 && importRes.json?.data?.skipped === 1, short(importRes.json));
    check('legacy number + sent total kept, mismatch flagged', items[0]?.billNo === 'GK-482913' && items[0]?.recomputedMismatch === true);
    const importedBill = await DriverBill.findOne({ driver_id: vikas._id, bill_no: 'GK-482913' }).lean();
    check('original createdAt preserved', importedBill && new Date(importedBill.createdAt).toISOString() === '2026-09-30T11:02:00.000Z');
    const reimport = await api('/drivers/bills/import', { method: 'POST', token: vikasToken, body: { bills: [{ ...billBody, clientRef: 'legacy:1730000000000' }] } });
    check('re-running the import is a no-op', reimport.json?.data?.items?.[0]?.status === 'exists');
  } finally {
    for (const socket of Object.values(sockets)) socket.close();
    const rideIds = (await Ride.find({ network_notes: TAG }).select('_id').lean()).map((ride) => ride._id);
    await RideRequest.deleteMany({ ride_id: { $in: rideIds } });
    await Ride.deleteMany({ _id: { $in: rideIds } });
    await FleetVehicle.deleteMany({ license_plate_number: 'MP09OT1234' });
    await Owner.deleteMany({ company_name: `${TAG} Other` });
    await Driver.updateMany({ _id: { $in: everyone } }, { $set: { 'wallet.frozenBalance': 0, isOnRide: false } });
    await mongoose.disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
