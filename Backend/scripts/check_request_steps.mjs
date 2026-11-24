// node scripts/check_request_steps.mjs
import assert from 'node:assert/strict';
import {
  allAskedHaveRejected, plansOpenAtStep, stepsForKind, validateRequestSteps,
} from '../src/modules/taxi/services/requestSteps.js';

const plans = [
  { _id: 'diamond', name: 'Diamond', is_active: true },
  { _id: 'gold', name: 'Gold', is_active: true },
  { _id: 'silver', name: 'Silver', is_active: true, is_default: true },
];
const good = {
  default: [
    { plan_ids: ['diamond'], minutes: 2 },
    { plan_ids: ['diamond', 'gold'], minutes: 3, radius_km: '20' },
    { plan_ids: ['silver', 'silver'], minutes: 5 },
  ],
};
const saved = validateRequestSteps(good, { plans, requireDefault: true });
assert.deepEqual(saved.default.map((s) => [s.plan_ids.length, s.minutes, s.radius_km]), [[1, 2, null], [2, 3, 20], [1, 5, null]]);

// A plan keeps access after its step; past the last step nothing is lost.
assert.deepEqual(plansOpenAtStep(saved.default, 0), ['diamond']);
assert.deepEqual(plansOpenAtStep(saved.default, 2), ['diamond', 'gold', 'silver']);
assert.deepEqual(plansOpenAtStep(saved.default, 99), ['diamond', 'gold', 'silver']);

const bad = (raw, message, options = { plans }) => assert.throws(() => validateRequestSteps(raw, options), message);
bad({ default: [{ plan_ids: ['diamond'], minutes: 2 }] }, /last step must include the default plan/);
bad({ default: [{ plan_ids: [], minutes: 2 }] }, /at least one plan/);
bad({ default: [{ plan_ids: ['gone'], minutes: 2 }] }, /no longer exists/);
bad({ default: [{ plan_ids: ['silver'], minutes: 0 }] }, /minutes/);
bad({ default: [{ plan_ids: ['silver'], minutes: 'x' }] }, /minutes/);
bad({ default: [{ plan_ids: ['silver'], minutes: 2, radius_km: 999 }] }, /radius/);
bad({ default: Array(11).fill({ plan_ids: ['silver'], minutes: 1 }) }, /at most 10/);
bad({}, /first/, { plans, requireDefault: true });
bad(good, /default plan first/, { plans: plans.map((p) => ({ ...p, is_default: false })) });

// Own steps for a kind win; otherwise the common ones; nothing usable = null (earlier phases apply).
const own = { ...saved, outstation: [{ plan_ids: ['silver'], minutes: 9 }] };
assert.equal(stepsForKind(own, 'outstation')[0].minutes, 9);
assert.equal(stepsForKind(own, 'city').length, 3);
for (const empty of [null, {}, { default: [] }, { default: 'x' }, { default: [{ plan_ids: [], minutes: 1 }] }]) {
  assert.equal(stepsForKind(empty, 'city'), null);
}

assert.equal(allAskedHaveRejected([], []), false);
assert.equal(allAskedHaveRejected(['a', 'b'], ['a']), false);
assert.equal(allAskedHaveRejected(['a', 'b'], ['b', 'a', 'c']), true);
console.log('request steps: ok');
