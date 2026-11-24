import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { AdminBusinessSetting } from '../../admin/models/AdminBusinessSetting.js';
import { Owner } from '../../admin/models/Owner.js';
import { ServiceLocation } from '../../admin/models/ServiceLocation.js';
import { Driver } from '../../driver/models/Driver.js';
import { getDriverNetworkSettings } from '../../services/appSettingsService.js';
import { subscriptionTierService } from '../../services/subscriptionTierService.js';
import { Ride } from '../../user/models/Ride.js';
import { User } from '../../user/models/User.js';
import { Complaint } from '../models/Complaint.js';
import { COMPLAINT_STATUSES, DIRECTIONS, ownerOf, reasonsFrom, validateReasons, whyNotAllowed } from './complaintRules.js';

const DUPLICATE_KEY = 11000;
const safe = (value) => String(value ?? '').trim();
const cleanMessage = (value) =>
  safe(value).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').slice(0, 1000);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const planNameOf = async (driverId) => (driverId ? (await subscriptionTierService.getEffectiveDriverTier(driverId))?.name || '' : '');

export const getComplaintReasons = async () => reasonsFrom((await getDriverNetworkSettings()).complaint_reasons);

export const saveComplaintReasons = async (raw) => {
  let next;
  try {
    next = validateReasons(raw);
  } catch (error) {
    throw new ApiError(400, error.message, null, 'INVALID_REASONS');
  }
  await AdminBusinessSetting.updateOne({ scope: 'default' }, { $set: { 'driver_network.complaint_reasons': next } }, { upsert: true });
  return next;
};

/** Everything the admin needs about the ride's people, as it is now. Read only. */
export const buildComplaintSnapshot = async (ride) => {
  const [user, driver] = await Promise.all([
    User.findById(ride.userId).select('name phone').lean(),
    Driver.findById(ride.driverId)
      .select('name phone vehicleMake vehicleModel vehicleNumber owner_id is_self_drive_owner service_location_id')
      .lean(),
  ]);
  if (!user || !driver) throw new ApiError(409, 'This account no longer exists', null, 'ACCOUNT_GONE');

  const creatorId = ride.created_by_driver_id && String(ride.created_by_driver_id) !== String(driver._id) ? ride.created_by_driver_id : null;
  const [lead, company, creator] = await Promise.all([
    driver.owner_id && driver.is_self_drive_owner !== true
      ? Driver.findOne({ owner_id: driver.owner_id, is_self_drive_owner: true, deletedAt: null }).select('name phone').lean()
      : null,
    driver.owner_id ? Owner.findById(driver.owner_id).select('company_name owner_name name mobile phone').lean() : null,
    creatorId ? Driver.findById(creatorId).select('name phone business_name').lean() : null,
  ]);
  const owner = ownerOf({ driver, lead, company });
  const [driverPlan, ownerPlan] = await Promise.all([
    planNameOf(driver._id),
    owner.kind === 'company' ? '' : planNameOf(owner.driver_id),
  ]);

  return {
    service_location_id: driver.service_location_id || null,
    user: { name: safe(user.name), phone: safe(user.phone) },
    driver: {
      name: safe(driver.name),
      phone: safe(driver.phone),
      vehicle: [driver.vehicleMake, driver.vehicleModel, ride.assignment?.vehicle?.number || driver.vehicleNumber].map(safe).filter(Boolean).join(' '),
      plan: driverPlan,
    },
    owner: { ...owner, plan: ownerPlan },
    ride_by: creator
      ? { driver_id: creator._id, name: safe(creator.business_name) || safe(creator.name), phone: safe(creator.phone) }
      : { driver_id: null, name: '', phone: '' },
    ride: {
      pickup: safe(ride.pickupAddress),
      drop: safe(ride.dropAddress),
      fare: Number(ride.fare || 0),
      status: safe(ride.status),
      service: safe(ride.serviceType) || 'ride',
      at: ride.scheduledAt || ride.acceptedAt || ride.createdAt || null,
    },
  };
};

/** What the person who complained may see of it: never the other side's details or the admin's notes. */
const forReporter = (item) => ({
  id: String(item._id),
  rideId: String(item.ride_id),
  reason: item.reason,
  message: item.message || '',
  status: item.status,
  createdAt: item.createdAt,
});

/** `role` is user or driver, taken from the token. */
export const createComplaint = async ({ role, accountId, rideId, reason, message }) => {
  if (!mongoose.isValidObjectId(rideId)) throw new ApiError(400, 'rideId is invalid', null, 'INVALID_ID');
  const ride = await Ride.findById(rideId)
    .select('userId driverId status completedAt updatedAt createdAt acceptedAt scheduledAt pickupAddress dropAddress fare serviceType created_by_driver_id assignment.vehicle')
    .lean();
  const refusal = whyNotAllowed({ ride, role, accountId });
  if (refusal) throw new ApiError(refusal.status, refusal.message, null, refusal.code);

  const chosen = (await getComplaintReasons())[role].find((item) => item.text === safe(reason));
  if (!chosen) throw new ApiError(422, 'Choose a reason from the list', null, 'INVALID_REASON');

  const direction = DIRECTIONS[role];
  try {
    const created = await Complaint.create({
      ...(await buildComplaintSnapshot(ride)),
      _id: `${ride._id}:${direction}`,
      direction,
      ride_id: ride._id,
      user_id: ride.userId,
      driver_id: ride.driverId,
      reason: chosen.text,
      safety: chosen.safety,
      message: cleanMessage(message),
    });
    return forReporter(created);
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) throw new ApiError(409, 'You have already reported this ride', null, 'ALREADY_REPORTED');
    throw error;
  }
};

export const listMyComplaints = async ({ role, accountId }) => {
  const items = await Complaint.find({ direction: DIRECTIONS[role], [role === 'user' ? 'user_id' : 'driver_id']: accountId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return items.map(forReporter);
};

// ---- admin ----

const countBy = async (field, values, match = {}) => {
  const list = [...new Map(values.filter(Boolean).map((value) => [String(value), value])).values()];
  if (!list.length) return new Map();
  const rows = await Complaint.aggregate([{ $match: { ...match, [field]: { $in: list } } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
  return new Map(rows.map((row) => [String(row._id), row.n]));
};

const forAdmin = (item, extra) => ({
  id: String(item._id),
  direction: item.direction,
  ride_id: String(item.ride_id),
  user: { id: String(item.user_id), ...item.user },
  driver: { id: String(item.driver_id), ...item.driver },
  owner: item.owner,
  ride_by: item.ride_by?.driver_id ? item.ride_by : null,
  ride: item.ride,
  reason: item.reason,
  safety: Boolean(item.safety),
  message: item.message || '',
  status: item.status,
  notes: item.notes || [],
  createdAt: item.createdAt,
  ...extra,
});

export const listComplaints = async ({ direction, status = '', state = '', reason = '', search = '', page = 1, limit = 20 }) => {
  if (!Object.values(DIRECTIONS).includes(direction)) throw new ApiError(400, 'direction is invalid', null, 'INVALID_DIRECTION');
  const safePage = Math.max(1, Math.floor(Number(page)) || 1);
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit)) || 20));
  const cities = await ServiceLocation.find({}).select('state').lean();

  const filter = { direction };
  if (COMPLAINT_STATUSES.includes(status)) filter.status = status;
  if (safe(reason)) filter.reason = safe(reason);
  if (safe(state) === 'none') filter.service_location_id = { $nin: cities.filter((city) => city.state).map((city) => city._id) };
  else if (safe(state)) filter.service_location_id = { $in: cities.filter((city) => city.state === safe(state)).map((city) => city._id) };
  const term = safe(search).slice(0, 60);
  if (term) {
    const pattern = new RegExp(escapeRegex(term), 'i');
    filter.$or = ['user.name', 'user.phone', 'driver.name', 'driver.phone', 'driver.vehicle', 'owner.name', 'owner.phone', 'owner.org'].map((field) => ({ [field]: pattern }));
    if (/^[0-9a-f]{24}$/i.test(term)) filter.$or.push({ ride_id: new mongoose.Types.ObjectId(term) });
  }

  // Open ones first, safety on top of those, then newest.
  const [found, openCounts, total] = await Promise.all([
    Complaint.aggregate([
      { $match: filter },
      { $addFields: { done: { $eq: ['$status', 'resolved'] } } },
      { $sort: { done: 1, safety: -1, createdAt: -1, _id: 1 } },
      { $skip: (safePage - 1) * safeLimit },
      { $limit: safeLimit },
    ]),
    Complaint.aggregate([{ $match: { status: { $ne: 'resolved' } } }, { $group: { _id: '$direction', n: { $sum: 1 } } }]),
    Complaint.countDocuments(filter),
  ]);

  const against = { direction };
  const [byDriver, byUser, byOwner] = await Promise.all([
    countBy('driver_id', found.map((item) => item.driver_id), against),
    countBy('user_id', found.map((item) => item.user_id), against),
    countBy('owner.key', found.map((item) => item.owner?.key), against),
  ]);

  return {
    results: found.map((item) =>
      forAdmin(item, {
        counts: {
          // How often the person complained about has been complained about, this one included.
          person: (direction === 'user_on_driver' ? byDriver.get(String(item.driver_id)) : byUser.get(String(item.user_id))) || 0,
          owner: direction === 'user_on_driver' ? byOwner.get(item.owner?.key) || 0 : 0,
        },
      }),
    ),
    open: Object.fromEntries(Object.values(DIRECTIONS).map((key) => [key, openCounts.find((row) => row._id === key)?.n || 0])),
    states: [...new Set(cities.map((city) => city.state).filter(Boolean))].sort(),
    reasons: await getComplaintReasons(),
    pagination: { page: safePage, total, totalPages: Math.max(1, Math.ceil(total / safeLimit)) },
  };
};

export const updateComplaint = async ({ id, status, note, adminName }) => {
  const text = cleanMessage(note);
  if (status !== undefined && !COMPLAINT_STATUSES.includes(status)) throw new ApiError(400, 'status is invalid', null, 'INVALID_STATUS');
  if (status === undefined && !text) throw new ApiError(400, 'Write a note or choose a status', null, 'NOTHING_TO_SAVE');
  const updated = await Complaint.findByIdAndUpdate(
    String(id),
    {
      ...(status === undefined ? {} : { $set: { status } }),
      $push: { notes: { $each: [{ admin: safe(adminName) || 'Admin', text, status: status || '', at: new Date() }], $slice: -100 } },
    },
    { new: true },
  ).lean();
  if (!updated) throw new ApiError(404, 'Complaint not found', null, 'COMPLAINT_NOT_FOUND');
  return forAdmin(updated, {});
};
