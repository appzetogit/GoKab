import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { RIDE_STATUS } from '../../constants/index.js';
import { getDriverPermissions } from '../../services/driverCategoryService.js';
import { Ride } from '../../user/models/Ride.js';
import { Driver } from '../models/Driver.js';
import { SavedContact } from '../models/SavedContact.js';
import { toPublicImageUrl } from './publisherCardService.js';

/**
 * Saved Contacts (plan §7.2).
 *
 * Two drivers have "worked together" when one created a ride and the other
 * drove it. Only those drivers can be saved, and a saved contact can then be
 * handed rides directly (see networkRideService.validateAssignTarget).
 *
 * Gated on the tier permission `can_use_contacts`. Without it the lists still
 * load — flagged `locked: true` — so a downgrade never loses anyone's data;
 * adding a contact and assigning to one are what's refused.
 */

const WORKED_STATUSES = [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING, RIDE_STATUS.COMPLETED];
const DRIVER_CARD_FIELDS = 'name phone profileImage vehicleNumber vehicleType rating driver_category deletedAt';

const toObjectId = (value, field) => {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `${field} is invalid`, null, 'INVALID_ID');
  }
  return new mongoose.Types.ObjectId(String(value));
};

const contactLocked = () =>
  new ApiError(
    403,
    'Saved Contacts are not included in your current plan',
    { required: 'can_use_contacts' },
    'CONTACTS_LOCKED',
  );

const serializeDriverCard = (driver) =>
  driver
    ? {
        id: String(driver._id),
        name: driver.name || '',
        phone: driver.phone || '',
        profile_image: toPublicImageUrl(driver.profileImage),
        vehicle_number: driver.vehicleNumber || '',
        vehicle_type: driver.vehicleType || '',
        rating: driver.rating || 0,
        category: driver.driver_category || 'lower',
        active: !driver.deletedAt,
      }
    : null;

/** A ride both drivers took part in (one created it, the other drove it). */
export const findSharedRide = async (driverA, driverB, { rideId = null } = {}) => {
  const a = toObjectId(driverA, 'driverId');
  const b = toObjectId(driverB, 'driverId');
  return Ride.findOne({
    ...(rideId ? { _id: toObjectId(rideId, 'source_ride_id') } : {}),
    status: { $in: WORKED_STATUSES },
    $or: [
      { created_by_driver_id: a, driverId: b },
      { created_by_driver_id: b, driverId: a },
    ],
  })
    .select('_id')
    .sort({ createdAt: -1 })
    .lean();
};

export const isSavedContact = async (ownerDriverId, contactDriverId) =>
  Boolean(
    await SavedContact.exists({
      owner_driver_id: toObjectId(ownerDriverId, 'driverId'),
      contact_driver_id: toObjectId(contactDriverId, 'driverId'),
    }),
  );

const lockedFor = async (driverId) => !(await getDriverPermissions(driverId)).can_use_contacts;

/** Everyone this driver has shared a ride with, most recent first. */
export const listWorkedWith = async ({ driverId, page = 1, limit = 20 }) => {
  const me = toObjectId(driverId, 'driverId');
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

  const grouped = await Ride.aggregate([
    {
      $match: {
        status: { $in: WORKED_STATUSES },
        $or: [
          { created_by_driver_id: me, driverId: { $nin: [null, me] } },
          { driverId: me, created_by_driver_id: { $nin: [null, me] } },
        ],
      },
    },
    {
      $project: {
        counterpart: { $cond: [{ $eq: ['$driverId', me] }, '$created_by_driver_id', '$driverId'] },
        i_drove: { $eq: ['$driverId', me] },
        at: { $ifNull: ['$completedAt', '$createdAt'] },
      },
    },
    { $sort: { at: -1 } },
    {
      $group: {
        _id: '$counterpart',
        rides_together: { $sum: 1 },
        i_drove_for_them: { $sum: { $cond: ['$i_drove', 1, 0] } },
        last_ride_at: { $first: '$at' },
        last_ride_id: { $first: '$_id' },
      },
    },
    { $sort: { last_ride_at: -1 } },
    {
      $facet: {
        page: [{ $skip: (safePage - 1) * safeLimit }, { $limit: safeLimit }],
        total: [{ $count: 'count' }],
      },
    },
  ]);

  const rows = grouped[0]?.page || [];
  const total = grouped[0]?.total?.[0]?.count || 0;
  const counterpartIds = rows.map((row) => row._id);

  const [drivers, saved, locked] = await Promise.all([
    Driver.find({ _id: { $in: counterpartIds } }).select(DRIVER_CARD_FIELDS).lean(),
    SavedContact.find({ owner_driver_id: me, contact_driver_id: { $in: counterpartIds } })
      .select('_id contact_driver_id')
      .lean(),
    lockedFor(driverId),
  ]);
  const driverMap = new Map(drivers.map((driver) => [String(driver._id), driver]));
  const savedMap = new Map(saved.map((row) => [String(row.contact_driver_id), String(row._id)]));

  return {
    locked,
    results: rows
      .filter((row) => driverMap.has(String(row._id)))
      .map((row) => ({
        driver: serializeDriverCard(driverMap.get(String(row._id))),
        rides_together: row.rides_together,
        they_drove_for_me: row.rides_together - row.i_drove_for_them,
        i_drove_for_them: row.i_drove_for_them,
        last_ride_at: row.last_ride_at,
        last_ride_id: String(row.last_ride_id),
        is_saved: savedMap.has(String(row._id)),
        contact_id: savedMap.get(String(row._id)) || null,
      })),
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 },
  };
};

const serializeContact = (contact, driver) => ({
  id: String(contact._id),
  nickname: contact.nickname || '',
  source_ride_id: contact.source_ride_id ? String(contact.source_ride_id) : null,
  driver: serializeDriverCard(driver),
  createdAt: contact.createdAt,
});

export const listContacts = async ({ driverId, page = 1, limit = 50 }) => {
  const me = toObjectId(driverId, 'driverId');
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));

  const [contacts, total, locked] = await Promise.all([
    SavedContact.find({ owner_driver_id: me })
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    SavedContact.countDocuments({ owner_driver_id: me }),
    lockedFor(driverId),
  ]);

  const drivers = await Driver.find({ _id: { $in: contacts.map((row) => row.contact_driver_id) } })
    .select(DRIVER_CARD_FIELDS)
    .lean();
  const driverMap = new Map(drivers.map((driver) => [String(driver._id), driver]));

  return {
    locked,
    results: contacts.map((row) => serializeContact(row, driverMap.get(String(row.contact_driver_id)) || null)),
    pagination: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) || 1 },
  };
};

/**
 * Saves a driver this one has shared a ride with. Idempotent: saving someone
 * already saved returns the existing row (with the nickname updated if sent).
 */
export const addContact = async ({ driverId, contactDriverId, sourceRideId = null, nickname }) => {
  if (await lockedFor(driverId)) throw contactLocked();

  const me = toObjectId(driverId, 'driverId');
  const contactId = toObjectId(contactDriverId, 'driver_id');
  if (String(me) === String(contactId)) {
    throw new ApiError(422, 'You cannot save yourself as a contact', null, 'INVALID_CONTACT');
  }

  const contactDriver = await Driver.findOne({ _id: contactId, deletedAt: null }).select(DRIVER_CARD_FIELDS).lean();
  if (!contactDriver) throw new ApiError(404, 'Driver not found', null, 'DRIVER_NOT_FOUND');

  const shared = await findSharedRide(me, contactId, { rideId: sourceRideId });
  if (!shared) {
    throw new ApiError(
      403,
      sourceRideId
        ? 'You did not share that ride with this driver'
        : 'You can only save drivers you have shared a ride with',
      null,
      'NO_SHARED_RIDE',
    );
  }

  const cleanNickname = nickname === undefined ? undefined : String(nickname || '').trim().slice(0, 60);
  const existing = await SavedContact.findOne({ owner_driver_id: me, contact_driver_id: contactId });
  if (existing) {
    if (cleanNickname !== undefined && cleanNickname !== existing.nickname) {
      existing.nickname = cleanNickname;
      await existing.save();
    }
    return { created: false, contact: serializeContact(existing.toObject(), contactDriver) };
  }

  try {
    const contact = await SavedContact.create({
      owner_driver_id: me,
      contact_driver_id: contactId,
      source_ride_id: shared._id,
      nickname: cleanNickname || '',
    });
    return { created: true, contact: serializeContact(contact.toObject(), contactDriver) };
  } catch (error) {
    // Lost a race with a simultaneous save of the same contact: same outcome.
    if (error?.code === 11000) {
      const row = await SavedContact.findOne({ owner_driver_id: me, contact_driver_id: contactId }).lean();
      return { created: false, contact: serializeContact(row, contactDriver) };
    }
    throw error;
  }
};

/** Removing your own contact is always allowed, even while the feature is locked. */
export const removeContact = async ({ driverId, contactId }) => {
  const result = await SavedContact.deleteOne({
    _id: toObjectId(contactId, 'contactId'),
    owner_driver_id: toObjectId(driverId, 'driverId'),
  });
  if (!result.deletedCount) throw new ApiError(404, 'Contact not found', null, 'CONTACT_NOT_FOUND');
  return { deleted: true, id: String(contactId) };
};
