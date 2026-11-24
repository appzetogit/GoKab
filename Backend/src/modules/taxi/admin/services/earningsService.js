import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { RIDE_STATUS } from '../../constants/index.js';
import { Driver } from '../../driver/models/Driver.js';
import { DriverSubscription } from '../../driver/models/DriverSubscription.js';
import { SubscriptionPayment } from '../../driver/models/SubscriptionPayment.js';
import { WalletTransaction } from '../../driver/models/WalletTransaction.js';
import { DriverOffer } from '../../offers/models/DriverOffer.js';
import { Ride } from '../../user/models/Ride.js';
import { ServiceLocation } from '../models/ServiceLocation.js';
import { SubscriptionTier } from '../models/SubscriptionTier.js';
import { WithdrawalRequest } from '../models/WithdrawalRequest.js';
import { changePercent, earningsRange, planAt, roundMoney, trendPoints } from './earningsRules.js';

/**
 * What the company earned, read only: plans sold, ride commission and fees. Each
 * amount belongs to a driver, and takes the driver's state (from their city) and
 * the plan they were on then. Plans given free by an admin are counted, not earned.
 * Totals are net: a refunded plan counts as sold, and its refund is taken off.
 */

const FEE_TYPES = ['lead_contact_fee', 'feed_accept_fee'];
const DRIVERS_PER_PAGE = 20;
const MAX_DRIVER_ENTRIES = 200;
const MAX_EXPORT_ENTRIES = 20000;
const MAX_WALLET_ROWS = 50;
const REFUNDED = ['refunded', 'refund_due'];
const PARTS = ['sales', 'commission', 'fees'];

/** Every amount in the period, as { part, amount, driverId, at, planId? }. */
const loadEntries = async (start, end) => {
  const period = { $gte: start, $lt: end };
  const [payments, refunds, rides, fees, offers] = await Promise.all([
    SubscriptionPayment.find({
      status: { $in: ['paid', ...REFUNDED] },
      $or: [{ verified_at: period }, { verified_at: null, createdAt: period }],
    }).select('driver_id tier_id amount verified_at createdAt').lean(),
    SubscriptionPayment.find({ status: { $in: REFUNDED }, updatedAt: period }).select('driver_id tier_id amount updatedAt').lean(),
    Ride.find({ status: RIDE_STATUS.COMPLETED, completedAt: period })
      .select('driverId commissionAmount completedAt paymentMethod fare')
      .lean(),
    WalletTransaction.find({ type: { $in: FEE_TYPES }, createdAt: period }).select('driverId amount type createdAt').lean(),
    DriverOffer.find({ paid_at: period }).select('driver_id fee_amount paid_at').lean(),
  ]);

  return [
    ...payments.map((item) => ({
      part: 'sales', kind: 'plan', amount: item.amount, driverId: item.driver_id, at: item.verified_at || item.createdAt, planId: String(item.tier_id),
    })),
    ...refunds.map((item) => ({
      part: 'refunds', kind: 'plan_refund', amount: item.amount, driverId: item.driver_id, at: item.updatedAt, planId: String(item.tier_id),
    })),
    ...rides.map((item) => ({ part: 'commission', kind: 'ride', rideId: String(item._id), amount: item.commissionAmount, driverId: item.driverId, at: item.completedAt, isRide: true,
      paymentMethod: item.paymentMethod === 'cash' ? 'cash' : 'online', fare: item.fare })),
    // A fee leaves the driver's wallet, so it is stored negative; a refund gives it back.
    ...fees.map((item) => ({ part: 'fees', kind: item.type, amount: -Number(item.amount || 0), driverId: item.driverId, at: item.createdAt })),
    ...offers.map((item) => ({ part: 'fees', kind: 'paid_offer', amount: item.fee_amount, driverId: item.driver_id, at: item.paid_at })),
  ];
};

const emptyRow = (extra) => ({ ...extra, drivers: 0, sales: 0, sales_count: 0, free_count: 0, commission: 0, rides: 0, fees: 0, refunds: 0, total: 0 });

/** What an entry adds to the net: a refund takes away. */
const netOf = (entry) => (entry.part === 'refunds' ? -1 : 1) * Number(entry.amount || 0);

const addEntry = (row, entry) => {
  const amount = Number(entry.amount || 0);
  row[entry.part] += amount;
  row.total += netOf(entry);
  if (entry.part === 'sales') row.sales_count += 1;
  if (entry.isRide) row.rides += 1;
};

const finishRow = (row) => {
  for (const key of [...PARTS, 'refunds', 'total']) row[key] = roundMoney(row[key]);
  return row;
};

export const getEarningsSummary = async ({ from, to, state = '', cityId = '', planId = '', driverId = '', search = '', page = 1, exportAll = false }) => {
  const range = earningsRange(from, to);
  if (!range) throw new ApiError(400, 'Choose a valid from and to date', null, 'INVALID_RANGE');
  for (const [value, field] of [[cityId, 'cityId'], [planId, 'planId'], [driverId, 'driverId']]) {
    if (value && !mongoose.isValidObjectId(value)) throw new ApiError(400, `${field} is invalid`, null, 'INVALID_ID');
  }

  const [entries, tiers, cities, subscriptions, paidSubscriptions, withdrawalRequests] = await Promise.all([
    // The period before is loaded too, for the change against it.
    loadEntries(range.previousStart, range.end),
    SubscriptionTier.find({}).select('name badge_color_hex price_monthly is_active is_default').lean(),
    ServiceLocation.find({}).select('name service_location_name state').sort({ name: 1 }).lean(),
    DriverSubscription.find({}).select('driver_id tier_id status start_date end_date updatedAt').lean(),
    SubscriptionPayment.distinct('driver_subscription_id', {
      status: { $in: ['paid', ...REFUNDED] },
      driver_subscription_id: { $ne: null },
    }),
    WithdrawalRequest.find({ createdAt: { $gte: range.start, $lt: range.end } }).select('driver_id amount status createdAt').lean(),
  ]);
  // ponytail: driver, subscription and ride rows are joined in memory; move to Mongo aggregation past ~50k rides a period.
  const drivers = await Driver.find({}).select('name phone service_location_id deletedAt wallet.balance wallet.frozenBalance').lean();

  const cityById = new Map(cities.map((city) => [String(city._id), city]));
  const driverById = new Map(drivers.map((driver) => [String(driver._id), driver]));
  const subscriptionsBy = new Map();
  for (const item of subscriptions) {
    const key = String(item.driver_id);
    subscriptionsBy.set(key, [...(subscriptionsBy.get(key) || []), item]);
  }
  const defaultPlan = tiers.find((tier) => tier.is_default);
  const now = new Date();

  const cityOf = (driverId) => String(driverById.get(String(driverId || ''))?.service_location_id || '');
  const stateOf = (driverId) => cityById.get(cityOf(driverId))?.state || '';
  const planOf = (driverId, at) => (driverId ? planAt(subscriptionsBy.get(String(driverId)), at, defaultPlan?._id) : '');
  const inFilters = (id, plan) =>
    (!driverId || String(id || '') === String(driverId)) &&
    (!state || stateOf(id) === (state === 'none' ? '' : state)) &&
    (!cityId || cityOf(id) === String(cityId)) &&
    (!planId || plan === String(planId));

  const plans = new Map(
    tiers
      .sort((a, b) => Number(b.price_monthly || 0) - Number(a.price_monthly || 0))
      .map((tier) => [
        String(tier._id),
        emptyRow({ id: String(tier._id), name: tier.name, color: tier.badge_color_hex || '#10B981', is_active: Boolean(tier.is_active) }),
      ]),
  );
  const states = new Map();
  const planRow = (id) => {
    if (!plans.has(id)) plans.set(id, emptyRow({ id, name: id ? 'Deleted plan' : 'No driver', color: '#94A3B8', is_active: false }));
    return plans.get(id);
  };
  const stateRow = (name) => {
    if (!states.has(name)) states.set(name, emptyRow({ id: name || 'none', name: name || 'State not set' }));
    return states.get(name);
  };

  const { unit, keys, keyOf } = trendPoints(from, to);
  const trend = new Map(keys.map((key) => [key, emptyRow({ id: key })]));
  const driverRows = new Map();
  const driverRow = (id) => {
    const key = String(id || '');
    if (!driverRows.has(key)) {
      const driver = driverById.get(key);
      const planNow = driver ? plans.get(planOf(key, now))?.name || '' : '';
      driverRows.set(
        key,
        emptyRow({
          id: key,
          name: driver?.name || (key ? 'Deleted driver' : 'No driver'),
          phone: driver?.phone || '',
          plan: planNow,
          city: cityById.get(cityOf(key))?.name || '',
        }),
      );
    }
    return driverRows.get(key);
  };
  const driverEntries = [];
  const exportEntries = [];
  const payment = { cash: { rides: 0, fare: 0, commission: 0 }, online: { rides: 0, fare: 0, commission: 0 } };
  const summary = emptyRow({});
  let previousTotal = 0;
  const previousByPlan = new Map();
  const previousByState = new Map();
  const addTo = (map, key, amount) => map.set(key, (map.get(key) || 0) + amount);
  for (const entry of entries) {
    const plan = entry.planId || planOf(entry.driverId, entry.at);
    if (!inFilters(entry.driverId, plan)) continue;
    if (new Date(entry.at) < range.start) {
      previousTotal += netOf(entry);
      addTo(previousByPlan, plan, netOf(entry));
      addTo(previousByState, stateOf(entry.driverId) || 'none', netOf(entry));
      continue;
    }
    addEntry(summary, entry);
    addEntry(planRow(plan), entry);
    addEntry(stateRow(stateOf(entry.driverId)), entry);
    const point = trend.get(keyOf(entry.at));
    if (point) addEntry(point, entry);
    if (entry.amount || entry.isRide) addEntry(driverRow(entry.driverId), entry);
    if (entry.isRide) {
      const way = payment[entry.paymentMethod];
      way.rides += 1;
      way.fare += Number(entry.fare || 0);
      way.commission += Number(entry.amount || 0);
    }
    if (exportAll && entry.amount) {
      const driver = driverById.get(String(entry.driverId || ''));
      exportEntries.push({
        at: entry.at,
        kind: entry.kind,
        driver: driver?.name || '',
        phone: driver?.phone || '',
        state: stateOf(entry.driverId),
        plan: plans.get(plan)?.name || '',
        ride_id: entry.rideId || '',
        payment_method: entry.paymentMethod || '',
        amount: roundMoney(netOf(entry)),
      });
    }
    if (driverId && entry.amount) {
      driverEntries.push({
        at: entry.at,
        part: entry.part,
        kind: entry.kind,
        plan: plans.get(plan)?.name || '',
        ride_id: entry.rideId || null,
        amount: roundMoney(netOf(entry)),
      });
    }
  }

  // Money between the company and drivers as it stands now, whatever the dates above.
  const wallets = { to_drivers: 0, from_drivers: 0, on_hold: 0 };
  const walletRows = [];
  const addWallet = (driver, plan) => {
    const balance = Number(driver.wallet?.balance || 0);
    if (balance > 0) wallets.to_drivers += balance;
    else wallets.from_drivers -= balance;
    wallets.on_hold += Number(driver.wallet?.frozenBalance || 0);
    if (balance) {
      walletRows.push({
        id: String(driver._id), name: driver.name || '', phone: driver.phone || '', plan: plans.get(plan)?.name || '', balance: roundMoney(balance),
      });
    }
  };

  // Drivers as they are now; a deleted driver's past earnings still count above.
  for (const driver of drivers) {
    if (driver.deletedAt) continue;
    const plan = planOf(driver._id, now);
    if (!inFilters(driver._id, plan)) continue;
    addWallet(driver, plan);
    summary.drivers += 1;
    planRow(plan).drivers += 1;
    stateRow(stateOf(driver._id)).drivers += 1;
  }

  const paid = new Set(paidSubscriptions.map(String));
  for (const item of subscriptions) {
    const at = new Date(item.start_date);
    const plan = String(item.tier_id);
    if (paid.has(String(item._id)) || item.status === 'pending_payment' || at < range.start || at >= range.end) continue;
    if (!inFilters(item.driver_id, plan)) continue;
    summary.free_count += 1;
    planRow(plan).free_count += 1;
    stateRow(stateOf(item.driver_id)).free_count += 1;
  }

  const withdrawals = Object.fromEntries(['pending', 'completed', 'cancelled'].map((status) => [status, { count: 0, amount: 0 }]));
  const anyFilter = state || cityId || planId || driverId;
  for (const item of withdrawalRequests) {
    // An owner's request has no driver, so it belongs to no state or plan.
    if (item.driver_id ? !inFilters(item.driver_id, planOf(item.driver_id, item.createdAt)) : anyFilter) continue;
    const group = withdrawals[item.status];
    if (!group) continue;
    group.count += 1;
    group.amount += Number(item.amount || 0);
  }
  for (const group of Object.values(withdrawals)) group.amount = roundMoney(group.amount);
  for (const key of Object.keys(wallets)) wallets[key] = roundMoney(wallets[key]);
  for (const way of Object.values(payment)) {
    way.fare = roundMoney(way.fare);
    way.commission = roundMoney(way.commission);
  }
  walletRows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

  const term = String(search || '').trim().toLowerCase().slice(0, 60);
  const rankedDrivers = [...driverRows.values()]
    .map(finishRow)
    .filter((row) => !term || row.name.toLowerCase().includes(term) || row.phone.includes(term))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const totalPages = Math.max(1, Math.ceil(rankedDrivers.length / DRIVERS_PER_PAGE));
  const safePage = Math.min(totalPages, Math.max(1, Math.floor(Number(page)) || 1));
  const chosen = driverId ? driverById.get(String(driverId)) : null;

  const withChange = (map) => (row) => ({ ...finishRow(row), change_percent: changePercent(row.total, map.get(row.id) || 0) });
  const hasSomething = (row) => row.total || row.drivers || row.rides || row.free_count;
  finishRow(summary);
  return {
    from,
    to,
    summary: { ...summary, previous_total: roundMoney(previousTotal), change_percent: changePercent(summary.total, previousTotal) },
    plans: [...plans.values()].filter((row) => hasSomething(row) || (row.is_active && !planId)).map(withChange(previousByPlan)),
    states: [...states.values()].filter(hasSomething).map(withChange(previousByState)).sort((a, b) => b.total - a.total || b.drivers - a.drivers),
    trend: { unit, points: [...trend.values()].map(finishRow) },
    drivers: {
      results: rankedDrivers.slice((safePage - 1) * DRIVERS_PER_PAGE, safePage * DRIVERS_PER_PAGE),
      pagination: { page: safePage, total: rankedDrivers.length, totalPages },
    },
    driver: driverId
      ? {
          id: String(driverId),
          name: chosen?.name || 'Deleted driver',
          phone: chosen?.phone || '',
          entries: driverEntries.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, MAX_DRIVER_ENTRIES),
          entries_total: driverEntries.length,
        }
      : null,
    payment,
    settlement: { wallets, withdrawals, rows: walletRows.slice(0, MAX_WALLET_ROWS), rows_total: walletRows.length },
    export: exportAll
      ? {
          drivers: rankedDrivers,
          entries: exportEntries.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, MAX_EXPORT_ENTRIES),
          entries_total: exportEntries.length,
        }
      : null,
    options: {
      plans: tiers.map((tier) => ({ id: String(tier._id), name: tier.name })),
      states: [...new Set(cities.map((city) => city.state).filter(Boolean))].sort(),
      cities: cities.map((city) => ({ id: String(city._id), name: city.name || city.service_location_name || '', state: city.state || '' })),
    },
    test_payments: String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_test'),
  };
};
