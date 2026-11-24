// node scripts/check_complaints.mjs
import assert from 'node:assert/strict';
import { DEFAULT_REASONS, ownerOf, reasonsFrom, validateReasons, whyNotAllowed } from '../src/modules/taxi/complaints/services/complaintRules.js';

const now = Date.parse('2026-11-24T10:00:00Z');
const ride = { userId: 'u1', driverId: 'd1', status: 'completed', completedAt: '2026-11-20T10:00:00Z' };
const why = (patch, role = 'user', accountId = 'u1') => whyNotAllowed({ ride: patch === null ? null : { ...ride, ...patch }, role, accountId, now })?.code ?? null;
assert.equal(why({}), null);
assert.equal(why({}, 'driver', 'd1'), null);
assert.equal(why({ status: 'ongoing', completedAt: null }), null);
assert.equal(why(null), 'RIDE_NOT_FOUND');
assert.equal(why({}, 'user', 'u2'), 'RIDE_NOT_FOUND'); // somebody else's ride
assert.equal(why({}, 'driver', 'u1'), 'RIDE_NOT_FOUND'); // a rider's id does not pass as the driver
assert.equal(why({ driverId: null }), 'NO_DRIVER');
assert.equal(why({ userId: null }, 'driver', 'd1'), 'NO_RIDER_ACCOUNT');
assert.equal(why({ userId: null }, 'user', ''), 'NO_RIDER_ACCOUNT');
assert.equal(why({ completedAt: '2026-11-10T10:00:00Z' }), 'TOO_LATE');
assert.equal(why({ status: 'cancelled', completedAt: null, updatedAt: '2026-11-23T10:00:00Z' }), null);

const lead = { _id: 'L', name: 'Ramesh', phone: '1' };
const company = { _id: 'O', company_name: 'Sharma Travels', owner_name: 'Sharma', mobile: '2' };
const member = { _id: 'd1', name: 'Mohan', owner_id: 'O' };
assert.deepEqual([ownerOf({ driver: member, lead, company }).kind, ownerOf({ driver: member, lead, company }).key], ['lead', 'driver:L']);
assert.deepEqual([ownerOf({ driver: member, company }).kind, ownerOf({ driver: member, company }).name], ['company', 'Sharma']);
assert.equal(ownerOf({ driver: { _id: 'L', name: 'Ramesh', owner_id: 'O', is_self_drive_owner: true }, lead, company }).key, 'driver:L'); // the lead shares their team's key
assert.equal(ownerOf({ driver: { _id: 'x', name: 'Alone' } }).kind, 'self');

assert.deepEqual(reasonsFrom(null), DEFAULT_REASONS);
assert.deepEqual(reasonsFrom({ user: [{ text: ' Late  ride ' }, { text: 'late ride' }, { text: '' }] }).user, [{ text: 'Late ride', safety: false }]);
assert.throws(() => validateReasons({ user: [{ text: 'a' }], driver: [] }), /at least one/);
console.log('complaints: ok');
