// What a plan gives, kept free of imports so it can be checked without a database:
//   node scripts/check_plan_benefits.mjs
//
// A driver keeps what they paid for: an improved plan reaches them at once, a
// reduced one only when they renew. The purchase stores `captureBenefits(tier)`
// on the subscription; `mergeBenefits` takes the better of that and the plan now.

const GRANTS = [
  'can_create_rides',
  'can_publish_rides',
  'can_manage_fleet',
  'can_use_contacts',
  'can_generate_bills',
  'cancellation_penalty_waived',
];
// Conditions put on the driver: fewer is better.
const DEMANDS = ['requires_commercial_and_private', 'requires_commercial_at_purchase'];
const HIGHER_IS_BETTER = ['max_cash_debt_allowed', 'free_cancellations_per_day', 'search_radius_multiplier', 'max_routes'];
const LOWER_IS_BETTER = [
  'commission_percent',
  'customer_lead_contact_fee',
  'driver_lead_contact_fee',
  'customer_ride_accept_fee',
];
// A stored 0 on these means "no limit", but only when the feature itself is on.
const LIMITS = ['max_vehicles', 'max_fleet_drivers', 'max_bills_per_month'];
const NO_LIMIT_WHERE_ZERO_MEANS_ONE = 9999;

const levelOf = (plan) => String(plan?.driver_category || 'lower');
const number = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Plans saved before the bill option existed keep bills on, as every driver has today. */
export const canGenerateBills = (plan) => plan?.can_generate_bills !== false;

/** The calendar month in India, as YYYY-MM: monthly limits restart on the 1st, Indian time. */
export const indianMonth = (at = Date.now()) => new Date(Number(at) + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 7);

const grants = (plan, key) => {
  if (key === 'can_generate_bills') return canGenerateBills(plan);
  if (key === 'can_use_contacts' && (plan?.can_use_contacts ?? null) === null) {
    return ['middle', 'prime'].includes(levelOf(plan));
  }
  return Boolean(plan?.[key]);
};

const limitOf = (plan, key) => {
  const value = Math.max(0, number(plan?.[key]));
  if (key === 'max_vehicles') return value || (levelOf(plan) === 'lower' ? 1 : Infinity);
  if (!grants(plan, key === 'max_fleet_drivers' ? 'can_manage_fleet' : 'can_generate_bills')) return 0;
  return value || Infinity;
};

const moduleId = (item) => String(item?._id || item);

/** The plan's benefits as plain values, to store with a purchase. */
export const captureBenefits = (tier) => ({
  driver_category: levelOf(tier),
  ...Object.fromEntries(GRANTS.map((key) => [key, grants(tier, key)])),
  ...Object.fromEntries(DEMANDS.map((key) => [key, Boolean(tier?.[key])])),
  ...Object.fromEntries(
    [...HIGHER_IS_BETTER, ...LOWER_IS_BETTER, ...LIMITS].map((key) => [key, number(tier?.[key])]),
  ),
  ride_module_ids: (tier?.ride_module_ids || []).map(moduleId),
});

/** The plan with each benefit at the better of now and when it was bought. */
export const mergeBenefits = (tier, bought) => {
  if (!tier || !bought) return tier;

  const merged = { ...tier };
  for (const key of GRANTS) merged[key] = grants(tier, key) || grants(bought, key);
  for (const key of DEMANDS) merged[key] = Boolean(tier[key]) && Boolean(bought[key]);
  for (const key of HIGHER_IS_BETTER) merged[key] = Math.max(number(tier[key]), number(bought[key]));
  // A value missing from the snapshot must not read as a free 0.
  for (const key of LOWER_IS_BETTER) {
    merged[key] = Math.min(number(tier[key]), bought[key] == null ? Infinity : number(bought[key]));
  }

  for (const key of LIMITS) {
    const best = Math.max(limitOf(tier, key), limitOf(bought, key));
    if (best !== Infinity) merged[key] = best;
    // On the lowest level a stored 0 vehicles reads as one, so spell "no limit" out.
    else merged[key] = key === 'max_vehicles' && levelOf(tier) === 'lower' ? NO_LIMIT_WHERE_ZERO_MEANS_ONE : 0;
  }

  // No modules listed = every module allowed.
  const now = tier.ride_module_ids || [];
  const then = bought.ride_module_ids || [];
  const known = new Set(now.map(moduleId));
  merged.ride_module_ids =
    !now.length || !then.length ? [] : [...now, ...then.filter((id) => !known.has(moduleId(id)))];

  return merged;
};
