/**
 * Smoke test for Saved Contacts (plan §7.2).
 *
 *  1  can_use_contacts: on for Middle/Prime, off (locked) for Lower
 *  2  worked-with list derived from shared rides
 *  3  add contact: shared-ride rule, idempotent, validation, locked tier refused
 *  4  assign to a contact: split required, secure escrow, wallet checks without
 *     leaking the contact's balance, decline/unassign give the holds back,
 *     settlement and commission earnings
 *  5  unsecure contact assignment: cash, no holds
 *  6  downgrade: lists answer locked=true but keep data; assign refused; delete allowed
 *
 * Ramesh (Prime) is the assigner. Mohan (Lower, not in Ramesh's fleet) is the contact.
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs. Only touches rides/contacts it creates itself.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *     node scripts/smoke_saved_contacts.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import mongoose from 'mongoose';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const INDORE = [75.8577, 22.7196];
const BHOPAL = [77.4126, 23.2599];
const TAG = `smoke-contacts-${Date.now()}`;

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

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { SavedContact } = await import('../src/modules/taxi/driver/models/SavedContact.js');
  const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');
  const { updateRideLifecycle } = await import('../src/modules/taxi/services/rideService.js');
  const { findSharedRide } = await import('../src/modules/taxi/driver/services/contactService.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const mohan = await Driver.findOne({ phone: '9000000004' }).lean();
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();

  const adminToken = await loginAdmin();
  const setCategory = (id, category) =>
    api(`/admin/driver-network/drivers/${id}/category`, { method: 'PATCH', token: adminToken, body: { category } });
  await setCategory(ramesh._id, 'prime');
  await setCategory(mohan._id, 'lower');

  const setWallets = (rameshBalance, mohanBalance) =>
    Promise.all([
      Driver.updateOne({ _id: ramesh._id }, { $set: { 'wallet.balance': rameshBalance, 'wallet.frozenBalance': 0, isOnRide: false } }),
      Driver.updateOne({ _id: mohan._id }, { $set: { 'wallet.balance': mohanBalance, 'wallet.frozenBalance': 0, isOnRide: false } }),
    ]);
  const wallet = async (id) => (await Driver.findById(id).select('wallet').lean()).wallet;

  const rameshToken = await login('9000000001');
  const mohanToken = await login('9000000004');
  const sureshToken = await login('9000000002');

  const createRide = async () =>
    (await api('/drivers/network/rides', {
      method: 'POST', token: rameshToken,
      body: {
        customer: { name: 'Contact Customer', phone: '9100000033' },
        pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
        drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
        fare: 5000, paymentMethod: 'cash', notes: TAG,
      },
    })).json?.data?.id;
  const complete = async (rideId, driverId, args = {}) => {
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'arriving' });
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'started' });
    await updateRideLifecycle({ rideId, driverId, nextStatus: 'completed', ...args });
  };
  const assign = (rideId, body) =>
    api(`/drivers/network/rides/${rideId}/assign`, { method: 'POST', token: rameshToken, body: { driverId: String(mohan._id), ...body } });

  const preexisting = await SavedContact.find({ owner_driver_id: { $in: [ramesh._id, mohan._id] } }).lean();
  await SavedContact.deleteMany({ owner_driver_id: { $in: [ramesh._id, mohan._id] } });

  try {
    console.log('\n1  Permission');
    const rameshCategory = (await api('/drivers/category', { token: rameshToken })).json?.data;
    check('Prime: can_use_contacts=true', rameshCategory?.permissions?.can_use_contacts === true, JSON.stringify(rameshCategory?.permissions));
    const mohanCategory = (await api('/drivers/category', { token: mohanToken })).json?.data;
    check('Lower: can_use_contacts=false', mohanCategory?.permissions?.can_use_contacts === false);

    console.log('\n2  Worked with');
    const sharedBefore = await findSharedRide(ramesh._id, mohan._id);
    if (!sharedBefore) {
      const early = await api('/drivers/contacts', { method: 'POST', token: rameshToken, body: { driver_id: String(mohan._id) } });
      check('cannot save a driver you never shared a ride with (NO_SHARED_RIDE)', early.status === 403 && early.json?.code === 'NO_SHARED_RIDE', JSON.stringify(early.json));
    } else {
      console.log('  SKIP  NO_SHARED_RIDE check (this database already has a shared ride)');
    }
    await setWallets(10000, 2500);
    const r1 = await createRide();
    await api(`/drivers/network/rides/${r1}/publish`, {
      method: 'POST', token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000, is_secure: false },
    });
    const took = await api(`/drivers/feed/rides/${r1}/accept`, { method: 'POST', token: mohanToken });
    check('setup: Mohan takes R1 from the feed', took.status === 200, JSON.stringify(took.json));
    await complete(r1, mohan._id);

    const worked = (await api('/drivers/contacts/worked-with', { token: rameshToken })).json?.data;
    const mohanRow = worked?.results?.find((row) => row.driver?.id === String(mohan._id));
    check('Ramesh worked-with lists Mohan', Boolean(mohanRow), JSON.stringify(worked).slice(0, 300));
    check('...they_drove_for_me ≥ 1, not saved yet', mohanRow?.they_drove_for_me >= 1 && mohanRow?.is_saved === false && mohanRow?.contact_id === null);
    check('...locked=false for Prime', worked?.locked === false);
    const mohanWorked = (await api('/drivers/contacts/worked-with', { token: mohanToken })).json?.data;
    check('Mohan (Lower) sees the list but locked=true', mohanWorked?.locked === true && mohanWorked?.results?.some((row) => row.driver?.id === String(ramesh._id)));

    console.log('\n3  Add contact');
    const lockedAdd = await api('/drivers/contacts', { method: 'POST', token: mohanToken, body: { driver_id: String(ramesh._id) } });
    check('Lower driver cannot add (403 CONTACTS_LOCKED)', lockedAdd.status === 403 && lockedAdd.json?.code === 'CONTACTS_LOCKED', JSON.stringify(lockedAdd.json));
    const self = await api('/drivers/contacts', { method: 'POST', token: rameshToken, body: { driver_id: String(ramesh._id) } });
    check('cannot save yourself (422 INVALID_CONTACT)', self.json?.code === 'INVALID_CONTACT', JSON.stringify(self.json));
    const badId = await api('/drivers/contacts', { method: 'POST', token: rameshToken, body: { driver_id: 'nope' } });
    check('bad id → 400 INVALID_ID', badId.status === 400 && badId.json?.code === 'INVALID_ID');
    const wrongRide = await api('/drivers/contacts', { method: 'POST', token: rameshToken, body: { driver_id: String(mohan._id), source_ride_id: String(new mongoose.Types.ObjectId()) } });
    check('source_ride_id they did not share → 403 NO_SHARED_RIDE', wrongRide.json?.code === 'NO_SHARED_RIDE', JSON.stringify(wrongRide.json));
    const added = await api('/drivers/contacts', { method: 'POST', token: rameshToken, body: { driver_id: String(mohan._id), nickname: 'Mohan bhai' } });
    check('added (201, created=true)', added.status === 201 && added.json?.data?.created === true, JSON.stringify(added.json));
    check('...nickname and source ride stored', added.json?.data?.contact?.nickname === 'Mohan bhai' && Boolean(added.json?.data?.contact?.source_ride_id));
    const again = await api('/drivers/contacts', { method: 'POST', token: rameshToken, body: { driver_id: String(mohan._id), nickname: 'Mohan ji' } });
    check('saving again is idempotent (200, created=false) and updates nickname', again.status === 200 && again.json?.data?.created === false && again.json?.data?.contact?.nickname === 'Mohan ji', JSON.stringify(again.json));
    const contactId = added.json?.data?.contact?.id;
    const list = (await api('/drivers/contacts', { token: rameshToken })).json?.data;
    check('GET /drivers/contacts lists Mohan, locked=false', list?.locked === false && list?.results?.some((row) => row.id === contactId && row.driver?.id === String(mohan._id)));
    const workedAfter = (await api('/drivers/contacts/worked-with', { token: rameshToken })).json?.data?.results?.find((row) => row.driver?.id === String(mohan._id));
    check('worked-with now shows is_saved + contact_id', workedAfter?.is_saved === true && workedAfter?.contact_id === contactId);

    console.log('\n4  Assign to a contact (secure)');
    const r2 = await createRide();
    const noSplit = await assign(r2, {});
    check('no split → 422 SPLIT_REQUIRED', noSplit.json?.code === 'SPLIT_REQUIRED', JSON.stringify(noSplit.json));
    const badSplit = await assign(r2, { driver_payout: 3000, owner_commission: 1000 });
    check('split not adding up → INVALID_SPLIT', badSplit.json?.code === 'INVALID_SPLIT');
    await setWallets(100, 2500);
    const poor = await assign(r2, { driver_payout: 3000 });
    check('assigner short → 402 INSUFFICIENT_WALLET_FOR_PUBLISH with required/available', poor.json?.code === 'INSUFFICIENT_WALLET_FOR_PUBLISH' && poor.json?.details?.required === 3000, JSON.stringify(poor.json));
    await setWallets(10000, 0);
    const contactPoor = await assign(r2, { driver_payout: 3000 });
    check('contact short → 402 CONTACT_INSUFFICIENT_WALLET', contactPoor.status === 402 && contactPoor.json?.code === 'CONTACT_INSUFFICIENT_WALLET', JSON.stringify(contactPoor.json));
    check("...without revealing the contact's balance", !contactPoor.json?.details);
    const r2Doc = await Ride.findById(r2).lean();
    check('...and nothing was written (ride open, no hold, contact free)', r2Doc.driverId === null && r2Doc.escrow.state === 'none' && (await wallet(ramesh._id)).frozenBalance === 0 && (await Driver.findById(mohan._id).lean()).isOnRide === false);

    await setWallets(10000, 2500);
    const assigned = await assign(r2, { driver_payout: 3000 });
    check('secure contact assign 200', assigned.status === 200, JSON.stringify(assigned.json));
    check('...target_type=contact, mode direct_assign', assigned.json?.data?.assignment?.target_type === 'contact' && assigned.json?.data?.assignment?.mode === 'direct_assign');
    check('...escrow held, split recorded', assigned.json?.data?.escrow?.state === 'held' && assigned.json?.data?.publish?.driver_payout === 3000 && assigned.json?.data?.publish?.owner_commission === 2000);
    check('...assigner payout frozen (3000)', (await wallet(ramesh._id)).frozenBalance === 3000);
    check('...contact commission frozen (2000)', (await wallet(mohan._id)).frozenBalance === 2000);

    const declined = await api(`/drivers/network/rides/${r2}/reject-assignment`, { method: 'POST', token: mohanToken, body: { reason: 'Busy' } });
    check('contact can decline', declined.status === 200, JSON.stringify(declined.json));
    const afterDecline = await Ride.findById(r2).lean();
    check('...holds released on both sides', (await wallet(ramesh._id)).frozenBalance === 0 && (await wallet(mohan._id)).frozenBalance === 0);
    check('...no money moved (10000 / 2500)', (await wallet(ramesh._id)).balance === 10000 && (await wallet(mohan._id)).balance === 2500);
    check('...ride open again with split and escrow cleared', afterDecline.status === 'searching' && afterDecline.escrow.state === 'none' && !afterDecline.publish.taken_by_driver_id && afterDecline.assignment.target_type === null);

    const reassigned = await assign(r2, { driver_payout: 3000 });
    check('can be assigned to the contact again', reassigned.status === 200 && reassigned.json?.data?.escrow?.state === 'held', JSON.stringify(reassigned.json));
    const upcoming = (await api('/drivers/rides/upcoming', { token: mohanToken })).json?.data?.results?.find((row) => row.id === r2);
    check("contact's upcoming shows payout and assigner", upcoming?.amount_for_you === 3000 && upcoming?.assignment?.assigned_by?.driver_id === String(ramesh._id));
    await complete(r2, mohan._id, { collectedBy: 'driver' });
    check('settled: assigner +2000 commission', (await wallet(ramesh._id)).balance === 12000, String((await wallet(ramesh._id)).balance));
    check('settled: contact -2000 (kept the 5000 cash)', (await wallet(mohan._id)).balance === 500, String((await wallet(mohan._id)).balance));
    const commissions = (await api('/drivers/earnings/commissions?range=today&limit=100', { token: rameshToken })).json?.data?.results || [];
    check('shows in commission earnings with the contact as acceptor', commissions.some((row) => row.ride_id === r2 && row.acceptor?.id === String(mohan._id) && row.net_earned === 2000));

    console.log('\n5  Unsecure contact assign + unassign');
    await setWallets(0, 0);
    const r3 = await createRide();
    const unsecure = await assign(r3, { driver_payout: 3000, is_secure: false });
    check('unsecure contact assign works with empty wallets', unsecure.status === 200 && unsecure.json?.data?.escrow?.state === 'none' && unsecure.json?.data?.publish?.is_secure === false, JSON.stringify(unsecure.json));
    check('...forced to cash', (await Ride.findById(r3).lean()).paymentMethod === 'cash');
    const unassigned = await api(`/drivers/network/rides/${r3}/unassign`, { method: 'POST', token: rameshToken, body: { reason: 'changed plan' } });
    check('assigner can unassign a contact', unassigned.status === 200 && unassigned.json?.data?.status === 'searching', JSON.stringify(unassigned.json));

    await setWallets(10000, 2500);
    const r4 = await createRide();
    await assign(r4, { driver_payout: 3000 });
    const unassignHeld = await api(`/drivers/network/rides/${r4}/unassign`, { method: 'POST', token: rameshToken, body: {} });
    check('unassigning a secure contact assignment releases the holds (was 409 before)', unassignHeld.status === 200 && (await wallet(ramesh._id)).frozenBalance === 0 && (await wallet(mohan._id)).frozenBalance === 0, JSON.stringify(unassignHeld.json));

    const outsider = await api(`/drivers/network/rides/${r4}/assign`, { method: 'POST', token: rameshToken, body: { driverId: String((await Driver.findOne({ phone: '9000000003' }).lean())._id) } });
    check('non-fleet, non-contact driver still refused (DRIVER_NOT_IN_FLEET)', outsider.json?.code === 'DRIVER_NOT_IN_FLEET', JSON.stringify(outsider.json));
    const fleet = await api(`/drivers/network/rides/${r4}/assign`, { method: 'POST', token: rameshToken, body: { driverId: String(suresh._id) } });
    check('fleet assign unchanged: no split needed, target_type=fleet, no escrow', fleet.status === 200 && fleet.json?.data?.assignment?.target_type === 'fleet' && fleet.json?.data?.escrow?.state === 'none', JSON.stringify(fleet.json).slice(0, 300));
    await api(`/drivers/network/rides/${r4}/reject-assignment`, { method: 'POST', token: sureshToken, body: {} });

    console.log('\n6  Downgrade keeps data');
    await setCategory(ramesh._id, 'lower');
    const lockedList = (await api('/drivers/contacts', { token: rameshToken })).json?.data;
    check('after downgrade: locked=true, Mohan still listed', lockedList?.locked === true && lockedList?.results?.some((row) => row.id === contactId), JSON.stringify(lockedList).slice(0, 200));
    const lockedAssign = await assign(r4, { driver_payout: 3000 });
    check('after downgrade: assigning to the contact refused (403)', lockedAssign.status === 403, JSON.stringify(lockedAssign.json));
    const lockedAddAgain = await api('/drivers/contacts', { method: 'POST', token: rameshToken, body: { driver_id: String(mohan._id) } });
    check('after downgrade: adding refused (CONTACTS_LOCKED)', lockedAddAgain.json?.code === 'CONTACTS_LOCKED');
    const deleted = await api(`/drivers/contacts/${contactId}`, { method: 'DELETE', token: rameshToken });
    check('deleting your own contact works even while locked', deleted.status === 200 && deleted.json?.data?.deleted === true);
    const deletedAgain = await api(`/drivers/contacts/${contactId}`, { method: 'DELETE', token: rameshToken });
    check('deleting twice → 404 CONTACT_NOT_FOUND', deletedAgain.status === 404 && deletedAgain.json?.code === 'CONTACT_NOT_FOUND');
  } finally {
    await setCategory(ramesh._id, 'prime');
    const mine = await Ride.find({ network_notes: TAG }).select('_id').lean();
    await WalletTransaction.deleteMany({ rideId: { $in: mine.map((ride) => ride._id) } });
    await Ride.deleteMany({ network_notes: TAG });
    await SavedContact.deleteMany({ owner_driver_id: { $in: [ramesh._id, mohan._id] } });
    if (preexisting.length) await SavedContact.insertMany(preexisting);
    await Driver.updateOne({ _id: ramesh._id }, { $set: { 'wallet.balance': ramesh.wallet?.balance || 0, 'wallet.frozenBalance': 0, isOnRide: false } });
    await Driver.updateOne({ _id: mohan._id }, { $set: { 'wallet.balance': mohan.wallet?.balance || 0, 'wallet.frozenBalance': 0, isOnRide: false } });
    await Driver.updateOne({ _id: suresh._id }, { $set: { isOnRide: false } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
