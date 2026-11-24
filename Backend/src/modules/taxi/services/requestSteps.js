// Admin-made request steps: which plans get a customer ride, in what order, for
// how long. Free of imports so it can be checked without a database:
//   node scripts/check_request_steps.mjs

export const REQUEST_STEP_MODES = ['off', 'shadow', 'on'];
/** `default` covers every ride; the others replace it for that kind of ride. */
export const REQUEST_STEP_KINDS = ['default', 'city', 'outstation'];

const MAX_STEPS = 10;
const MAX_MINUTES = 120;
const MAX_RADIUS_KM = 300;

const cleanStep = (step) => {
  const radiusKm = Number(step?.radius_km);
  return {
    plan_ids: [...new Set((Array.isArray(step?.plan_ids) ? step.plan_ids : []).map((id) => String(id || '')).filter(Boolean))],
    minutes: Number(step?.minutes),
    // null = the admin's All Locations radius.
    radius_km: Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : null,
  };
};

/** Cleans what the admin saves; throws an Error whose message the admin can act on. */
export const validateRequestSteps = (raw, { plans = [], requireDefault = false } = {}) => {
  const known = new Set(plans.map((plan) => String(plan._id)));
  const defaultPlan = plans.find((plan) => plan.is_default && plan.is_active !== false);
  const result = {};

  for (const kind of REQUEST_STEP_KINDS) {
    const steps = (Array.isArray(raw?.[kind]) ? raw[kind] : []).map(cleanStep);
    if (!steps.length) continue;
    if (steps.length > MAX_STEPS) throw new Error(`${kind}: at most ${MAX_STEPS} steps`);

    steps.forEach((step, index) => {
      const where = `${kind}, step ${index + 1}`;
      if (!step.plan_ids.length) throw new Error(`${where}: choose at least one plan`);
      if (step.plan_ids.some((id) => !known.has(id))) throw new Error(`${where}: a chosen plan no longer exists`);
      if (!(step.minutes > 0 && step.minutes <= MAX_MINUTES)) {
        throw new Error(`${where}: minutes must be more than 0 and at most ${MAX_MINUTES}`);
      }
      if (step.radius_km !== null && step.radius_km > MAX_RADIUS_KM) {
        throw new Error(`${where}: radius can be at most ${MAX_RADIUS_KM} km`);
      }
    });

    // Every driver without a subscription is on the default plan: leaving it out
    // would stop their rides.
    if (!defaultPlan) throw new Error('Set a default plan first');
    if (!steps[steps.length - 1].plan_ids.includes(String(defaultPlan._id))) {
      throw new Error(`${kind}: the last step must include the default plan (${defaultPlan.name})`);
    }
    result[kind] = steps;
  }

  if (requireDefault && !result.default) throw new Error('Add steps under "All rides" first');
  return result;
};

/** The steps for a kind of ride, or null when none are usable. */
export const stepsForKind = (config, kind) => {
  for (const key of [kind, 'default']) {
    const steps = (Array.isArray(config?.[key]) ? config[key] : [])
      .map(cleanStep)
      .filter((step) => step.plan_ids.length && step.minutes > 0);
    if (steps.length) return steps;
  }
  return null;
};

/** Plans that may take the ride in step `index`: a plan keeps access once its step has come. */
export const plansOpenAtStep = (steps = [], index = 0) => [
  ...new Set(steps.slice(0, Math.max(0, Number(index) || 0) + 1).flatMap((step) => step.plan_ids.map(String))),
];

/** Outstation and other rides keep separate steps and lead times. */
export const kindOfRide = (ride) =>
  String(ride?.serviceType || 'ride').toLowerCase() === 'intercity' ? 'outstation' : 'city';

/** Milliseconds left in a step that began at `startedAt`; 0 when it is over or the time is unknown. */
export const stepTimeLeftMs = (step, startedAt, now = Date.now()) => {
  const began = new Date(startedAt || 0).getTime();
  if (!step || !(began > 0)) return 0;
  return Math.max(0, began + Number(step.minutes) * 60 * 1000 - now);
};

const has = (ids, id) => (ids || []).some((item) => String(item) === String(id));

/**
 * Feed visibility of a customer ride while steps are on.
 * Asked drivers always see it; those who said no never do; a ride booked for
 * later stays hidden until its search starts; anyone else needs their plan's
 * turn and to be in the area (`inArea`).
 */
export const isRideInStepFeed = ({ ride, driverId, planId, inArea, searchStarted }) => {
  if (has(ride.requestRejectedDriverIds, driverId)) return false;
  if (has(ride.requestAskedDriverIds, driverId)) return true;
  if (!searchStarted || !inArea) return false;
  return plansOpenAtStep(ride.requestSteps || [], ride.tierPhaseIndex ?? 0).includes(String(planId));
};

/** True when everybody asked so far has said no. */
export const allAskedHaveRejected = (notified = [], rejected = []) =>
  notified.length > 0 && notified.every((id) => rejected.includes(id));
