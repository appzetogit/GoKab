import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { RIDE_STATUS } from '../../constants/index.js';
import { Ride } from '../../user/models/Ride.js';
import { Driver } from '../models/Driver.js';
import { WalletTransaction } from '../models/WalletTransaction.js';

/**
 * Driver earnings, split into the two ways a driver makes money:
 *  - ride earnings: trips they drove themselves
 *  - commission earnings: their cut on rides they published and someone else drove
 *
 * Both are derived from completed rides (not from wallet rows), because an
 * unsecure ride is settled offline and never touches the wallet. The only thing
 * read from the wallet is the platform's cut on a commission paid online.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_DAYS = 366;

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const istDayKey = (date) => new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** UTC instant of 00:00 IST on the IST day containing `date`. */
const istDayStart = (date) => {
  const key = istDayKey(date);
  return new Date(new Date(`${key}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
};

const parseBound = (value, field) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // A bare date means that IST calendar day, not UTC midnight.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(new Date(`${raw}T00:00:00.000Z`).getTime() - IST_OFFSET_MS)
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(422, `${field} must be a valid date`, { field }, 'INVALID_DATE_RANGE');
  }
  return parsed;
};

/**
 * `range`: today | week (last 7 IST days) | month (last 30 IST days) | custom.
 * `custom` takes `from` (inclusive) and `to` (exclusive for timestamps; a bare
 * `YYYY-MM-DD` `to` includes that whole day).
 */
export const resolveEarningsRange = ({ range = 'week', from, to, now = new Date() } = {}) => {
  const key = String(range || 'week').trim().toLowerCase();
  const todayStart = istDayStart(now);
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);

  if (key === 'today') return { range: 'today', from: todayStart, to: tomorrowStart };
  if (key === 'week') return { range: 'week', from: new Date(tomorrowStart.getTime() - 7 * DAY_MS), to: tomorrowStart };
  if (key === 'month') return { range: 'month', from: new Date(tomorrowStart.getTime() - 30 * DAY_MS), to: tomorrowStart };

  if (key !== 'custom') {
    throw new ApiError(422, "range must be 'today', 'week', 'month' or 'custom'", { range }, 'INVALID_RANGE');
  }

  const fromDate = parseBound(from, 'from');
  let toDate = parseBound(to, 'to');
  if (!fromDate || !toDate) {
    throw new ApiError(422, 'custom range needs both from and to', null, 'INVALID_DATE_RANGE');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(to).trim())) toDate = new Date(toDate.getTime() + DAY_MS);
  if (fromDate >= toDate) {
    throw new ApiError(422, 'from must be earlier than to', { from, to }, 'INVALID_DATE_RANGE');
  }
  if (toDate.getTime() - fromDate.getTime() > MAX_CUSTOM_DAYS * DAY_MS) {
    throw new ApiError(422, `A custom range can cover at most ${MAX_CUSTOM_DAYS} days`, null, 'INVALID_DATE_RANGE');
  }
  return { range: 'custom', from: fromDate, to: toDate };
};

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

/** What the driver earned for a ride they drove. */
const rideEarningFor = (ride, driverId) =>
  ride.publish?.taken_by_driver_id && String(ride.publish.taken_by_driver_id) === String(driverId)
    ? round2(ride.publish.driver_payout)
    : round2(ride.driverEarnings);

const findDrivenRides = (driverId, { from, to }) =>
  Ride.find({
    driverId: toObjectId(driverId),
    status: RIDE_STATUS.COMPLETED,
    completedAt: { $gte: from, $lt: to },
  })
    .select('completedAt driverEarnings publish.taken_by_driver_id publish.driver_payout')
    .lean();

const commissionFilter = (driverId, { from, to }) => ({
  created_by_driver_id: toObjectId(driverId),
  status: RIDE_STATUS.COMPLETED,
  'publish.taken_by_driver_id': { $nin: [null, toObjectId(driverId)] },
  completedAt: { $gte: from, $lt: to },
});

/** Platform fee withheld from commissions paid online, per ride. */
const loadPlatformCuts = async (driverId, rideIds) => {
  if (!rideIds.length) return new Map();
  const rows = await WalletTransaction.find({
    driverId: toObjectId(driverId),
    rideId: { $in: rideIds },
    'metadata.platformFee': { $gt: 0 },
  })
    .select('rideId metadata.platformFee')
    .lean();
  const cuts = new Map();
  for (const row of rows) {
    const key = String(row.rideId);
    cuts.set(key, round2((cuts.get(key) || 0) + Number(row.metadata?.platformFee || 0)));
  }
  return cuts;
};

const serializeCommissionRow = (ride, platformCut, acceptor) => {
  const isSecure = ride.publish?.is_secure !== false;
  const ownerCommission = round2(ride.publish?.owner_commission);
  const cut = isSecure ? round2(platformCut) : 0;
  return {
    ride_id: String(ride._id),
    date: ride.completedAt,
    pickup: ride.pickupAddress || '',
    drop: ride.dropAddress || '',
    total_fare: round2(ride.publish?.total_fare || ride.fare),
    driver_payout: round2(ride.publish?.driver_payout),
    owner_commission: ownerCommission,
    platform_cut: cut,
    net_earned: round2(ownerCommission - cut),
    acceptor: acceptor
      ? { id: String(acceptor._id), name: acceptor.name || '', phone: acceptor.phone || '' }
      : { id: String(ride.publish.taken_by_driver_id), name: '', phone: '' },
    is_secure: isSecure,
    settlement: isSecure ? 'escrow' : 'offline',
    settlement_label: isSecure ? 'Settled via wallet' : 'Settled offline',
    escrow_state: ride.escrow?.state || 'none',
    collected_by: ride.escrow?.collected_by || null,
  };
};

const loadCommissionRows = async (driverId, window, { skip = 0, limit = 0 } = {}) => {
  let query = Ride.find(commissionFilter(driverId, window))
    .select('completedAt fare pickupAddress dropAddress publish escrow.state escrow.collected_by')
    .sort({ completedAt: -1 });
  if (skip) query = query.skip(skip);
  if (limit) query = query.limit(limit);
  const rides = await query.lean();

  const [cuts, acceptors] = await Promise.all([
    loadPlatformCuts(driverId, rides.map((ride) => ride._id)),
    Driver.find({ _id: { $in: rides.map((ride) => ride.publish.taken_by_driver_id) } })
      .select('name phone')
      .lean(),
  ]);
  const acceptorMap = new Map(acceptors.map((item) => [String(item._id), item]));

  return rides.map((ride) =>
    serializeCommissionRow(ride, cuts.get(String(ride._id)) || 0, acceptorMap.get(String(ride.publish.taken_by_driver_id))),
  );
};

export const getEarningsSummary = async ({ driverId, range, from, to }) => {
  const window = resolveEarningsRange({ range, from, to });
  const [driven, commissions] = await Promise.all([
    findDrivenRides(driverId, window),
    loadCommissionRows(driverId, window),
  ]);

  const days = new Map();
  for (let t = istDayStart(window.from).getTime(); t < window.to.getTime(); t += DAY_MS) {
    const key = istDayKey(t);
    days.set(key, { date: key, ride_earnings: 0, commission_earnings: 0, rides: 0, commission_rides: 0 });
  }
  const bucket = (date) => days.get(istDayKey(date));

  let rideEarnings = 0;
  for (const ride of driven) {
    const amount = rideEarningFor(ride, driverId);
    rideEarnings += amount;
    const day = bucket(ride.completedAt);
    if (day) {
      day.ride_earnings = round2(day.ride_earnings + amount);
      day.rides += 1;
    }
  }

  let commissionEarnings = 0;
  for (const row of commissions) {
    commissionEarnings += row.net_earned;
    const day = bucket(row.date);
    if (day) {
      day.commission_earnings = round2(day.commission_earnings + row.net_earned);
      day.commission_rides += 1;
    }
  }

  return {
    range: window.range,
    from: window.from,
    to: window.to,
    ride_earnings: round2(rideEarnings),
    commission_earnings: round2(commissionEarnings),
    total_earnings: round2(rideEarnings + commissionEarnings),
    rides: driven.length,
    commission_rides: commissions.length,
    daily: [...days.values()],
  };
};

export const listCommissionEarnings = async ({ driverId, range, from, to, page = 1, limit = 20 }) => {
  const window = resolveEarningsRange({ range, from, to });
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

  const [results, total, all] = await Promise.all([
    loadCommissionRows(driverId, window, { skip: (safePage - 1) * safeLimit, limit: safeLimit }),
    Ride.countDocuments(commissionFilter(driverId, window)),
    loadCommissionRows(driverId, window),
  ]);

  return {
    range: window.range,
    from: window.from,
    to: window.to,
    totals: {
      owner_commission: round2(all.reduce((sum, row) => sum + row.owner_commission, 0)),
      platform_cut: round2(all.reduce((sum, row) => sum + row.platform_cut, 0)),
      net_earned: round2(all.reduce((sum, row) => sum + row.net_earned, 0)),
      rides: total,
    },
    results,
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 },
  };
};
