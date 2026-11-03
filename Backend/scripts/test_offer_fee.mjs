// Self-check for the offer publishing-fee calculator: node scripts/test_offer_fee.mjs
import assert from 'node:assert/strict';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/x';
process.env.JWT_SECRET ||= 'x';
const { computeOfferFee } = await import('../src/modules/taxi/offers/services/offerService.js');

const rates = { enabled: true, max_live_hours: 2160, hour_rate: 10, day_rate: 100, week_rate: 500, month_rate: 1500 };
const fee = (hours, p = rates) => computeOfferFee(p, hours);

assert.equal(fee(1).fee, 10, '1 hour');
assert.equal(fee(2).fee, 20, '2 hours = 2 x hour rate');
assert.equal(fee(3).fee, 30, '3 hours');
assert.equal(fee(24).fee, 100, '1 day');
assert.equal(fee(25).fee, 110, '1 day + 1 hour');
assert.equal(fee(11).fee, 100, '11 hours is cheaper as a day (110 > 100)');
assert.equal(fee(11).covered_hours, 24, 'and covers the whole day');
assert.equal(fee(168).fee, 500, '1 week');
assert.equal(fee(720).fee, 1500, '1 month');
assert.equal(fee(24 * 8).fee, 600, '1 week + 1 day');
assert.deepEqual(fee(25).breakdown.map((r) => [r.unit, r.count]), [['day', 1], ['hour', 1]]);

// Only an hour rate set: plain multiplication.
assert.equal(fee(5, { ...rates, day_rate: 0, week_rate: 0, month_rate: 0 }).fee, 50);

assert.throws(() => fee(0), /live/i);
assert.throws(() => fee(2161), /at most/);
assert.throws(() => computeOfferFee({ ...rates, enabled: false }, 5), /not available/);
assert.throws(() => computeOfferFee({ ...rates, hour_rate: 0, day_rate: 0, week_rate: 0, month_rate: 0 }, 5), /not available/);

console.log('offer fee checks passed');
process.exit(0);
