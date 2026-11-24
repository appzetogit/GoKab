// How an amount is dated and given to a plan. Free of imports so it can be checked
// without a database:  node scripts/check_earnings.mjs

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const startOfIndianDay = (day) => {
  const at = DAY_PATTERN.test(String(day || '')) ? Date.parse(`${day}T00:00:00+05:30`) : NaN;
  // Date.parse rolls some impossible days over (31 Feb); refuse those.
  return Number.isFinite(at) && new Date(at + IST_MS).toISOString().slice(0, 10) === day ? at : NaN;
};

/**
 * Two Indian calendar days (both included) as instants, with the equally long
 * period just before them. Null when the days are not a usable range.
 */
export const earningsRange = (from, to) => {
  const start = startOfIndianDay(from);
  const end = startOfIndianDay(to) + DAY_MS;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 3660 * DAY_MS) return null;
  return { start: new Date(start), end: new Date(end), previousStart: new Date(start - (end - start)) };
};

const time = (value) => new Date(value || 0).getTime();

/** When a subscription really stopped: an upgrade or an admin can end it before its own end date. */
const endedAt = (subscription) => {
  const planned = time(subscription.end_date);
  return ['expired', 'cancelled'].includes(subscription.status) && subscription.updatedAt
    ? Math.min(planned, time(subscription.updatedAt))
    : planned;
};

/** The plan a driver was on at a moment: the newest subscription running then, else the default plan. */
export const planAt = (subscriptions = [], at, defaultPlanId = '') => {
  const moment = time(at);
  const running = subscriptions
    .filter(
      (item) =>
        ['active', 'expired', 'cancelled'].includes(item.status) && time(item.start_date) <= moment && moment < endedAt(item),
    )
    .sort((a, b) => time(b.start_date) - time(a.start_date));
  return String(running[0]?.tier_id || defaultPlanId || '');
};

const MAX_DAILY_POINTS = 62;

/** One point per Indian day, or per month when the range is long. `keyOf` says which point an instant belongs to. */
export const trendPoints = (from, to) => {
  const range = earningsRange(from, to);
  if (!range) return { unit: 'day', keys: [], keyOf: () => '' };
  const days = Math.round((range.end - range.start) / DAY_MS);
  const unit = days <= MAX_DAILY_POINTS ? 'day' : 'month';
  const size = unit === 'day' ? 10 : 7;
  const keyOf = (at) => new Date(time(at) + IST_MS).toISOString().slice(0, size);
  const keys = [];
  for (let i = 0; i < days; i += 1) {
    const key = keyOf(new Date(range.start.getTime() + i * DAY_MS));
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return { unit, keys, keyOf };
};

export const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

/** Percent change, or null when there is nothing to compare with. */
export const changePercent = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
