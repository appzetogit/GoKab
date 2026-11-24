// node scripts/check_earnings.mjs
import assert from 'node:assert/strict';
import { changePercent, earningsRange, planAt, roundMoney } from '../src/modules/taxi/admin/services/earningsRules.js';

// Days are Indian days, both ends included; the period before is equally long.
const range = earningsRange('2026-11-01', '2026-11-30');
assert.equal(range.start.toISOString(), '2026-10-31T18:30:00.000Z');
assert.equal(range.end.toISOString(), '2026-11-30T18:30:00.000Z');
assert.equal(range.previousStart.toISOString(), '2026-10-01T18:30:00.000Z');
for (const [from, to] of [['2026-11-02', '2026-11-01'], ['x', '2026-11-01'], ['2026-02-31', '2026-03-05'], ['', ''], ['1900-01-01', '2026-01-01']]) {
  assert.equal(earningsRange(from, to), null);
}

const gold = { tier_id: 'gold', status: 'expired', start_date: '2026-11-01', end_date: '2026-12-01', updatedAt: '2026-11-10' };
const diamond = { tier_id: 'diamond', status: 'active', start_date: '2026-11-10', end_date: '2026-12-10', updatedAt: '2026-11-12' };
const subs = [gold, diamond];
assert.equal(planAt(subs, '2026-11-05', 'basic'), 'gold');
assert.equal(planAt(subs, '2026-11-20', 'basic'), 'diamond'); // upgraded: gold's own end date no longer counts
assert.equal(planAt(subs, '2026-10-20', 'basic'), 'basic');
assert.equal(planAt(subs, '2026-12-20', 'basic'), 'basic');
assert.equal(planAt([{ ...gold, status: 'cancelled' }], '2026-11-20', 'basic'), 'basic'); // taken back by an admin
assert.equal(planAt([{ ...gold, status: 'pending_refund' }], '2026-11-05', 'basic'), 'basic');
assert.equal(planAt([], '2026-11-05'), '');

assert.equal(roundMoney(0.1 + 0.2), 0.3);
assert.equal(changePercent(112, 100), 12);
assert.equal(changePercent(5, 0), null);
console.log('earnings: ok');
