// node scripts/check_plan_benefits.mjs
import assert from 'node:assert/strict';
import { canGenerateBills, captureBenefits, indianMonth, mergeBenefits } from '../src/modules/taxi/services/planBenefits.js';

const gold = {
  name: 'Gold', driver_category: 'middle', can_create_rides: true, can_publish_rides: true, can_manage_fleet: true,
  can_generate_bills: true, max_bills_per_month: 50, max_vehicles: 5, max_fleet_drivers: 0, max_routes: 2,
  commission_percent: 10, max_cash_debt_allowed: 500, ride_module_ids: [{ _id: 'city', code: 'city' }],
};
const bought = captureBenefits(gold);

// Unchanged plan: everything comes out the same.
const same = mergeBenefits(gold, bought);
for (const key of Object.keys(gold)) assert.deepEqual(same[key], gold[key], key);
assert.deepEqual(captureBenefits(same), bought);
// No snapshot (older subscriptions): the plan itself, untouched.
assert.equal(mergeBenefits(gold, null), gold);

// Improved: at once.
const better = mergeBenefits({ ...gold, max_vehicles: 8, commission_percent: 5, max_bills_per_month: 0 }, bought);
assert.deepEqual([better.max_vehicles, better.commission_percent, better.max_bills_per_month], [8, 5, 0]);

// Reduced: the driver keeps what they bought.
const worse = mergeBenefits(
  {
    ...gold, max_vehicles: 3, commission_percent: 20, max_bills_per_month: 10, max_routes: 0, can_publish_rides: false,
    can_manage_fleet: false, can_generate_bills: false, max_cash_debt_allowed: 0,
    ride_module_ids: [{ _id: 'x', code: 'x' }], requires_commercial_and_private: true,
  },
  bought,
);
assert.deepEqual(
  [
    worse.max_vehicles, worse.commission_percent, worse.max_bills_per_month, worse.max_routes, worse.can_publish_rides,
    worse.can_manage_fleet, worse.max_fleet_drivers, worse.can_generate_bills, worse.max_cash_debt_allowed,
    worse.requires_commercial_and_private,
  ],
  [5, 10, 50, 2, true, true, 0, true, 500, false],
);
assert.deepEqual(worse.ride_module_ids.map((m) => m.code || m), ['x', 'city']);

// "0 = no limit" beats any number; an off feature with 0 is not "no limit".
const unlimited = captureBenefits({ ...gold, max_vehicles: 0 });
assert.equal(mergeBenefits(gold, unlimited).max_vehicles, 0);
assert.equal(mergeBenefits({ ...gold, driver_category: 'lower' }, unlimited).max_vehicles, 9999);
const noBills = captureBenefits({ ...gold, can_generate_bills: false, max_bills_per_month: 0 });
assert.equal(mergeBenefits(gold, noBills).max_bills_per_month, 50);

// Lowest level: 0 vehicles means one, contacts off unless the plan says so.
const basic = { driver_category: 'lower', max_vehicles: 0 };
assert.equal(captureBenefits(basic).can_use_contacts, false);
assert.equal(mergeBenefits({ ...basic, max_vehicles: 2 }, captureBenefits(basic)).max_vehicles, 2);

// A partial snapshot never makes a fee free.
assert.equal(mergeBenefits({ ...gold, customer_ride_accept_fee: 20 }, { driver_category: 'lower' }).customer_ride_accept_fee, 20);

// Old plans without the bill field keep bills on.
assert.equal(canGenerateBills({}), true);
assert.equal(canGenerateBills(null), true);
// The month turns over at midnight in India (18:30 UTC).
assert.equal(indianMonth(Date.UTC(2026, 10, 30, 18, 29)), '2026-11');
assert.equal(indianMonth(Date.UTC(2026, 10, 30, 18, 30)), '2026-12');
console.log('plan benefits: ok');
