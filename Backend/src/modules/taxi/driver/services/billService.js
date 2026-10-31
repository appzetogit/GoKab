import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { Ride } from '../../user/models/Ride.js';
import { DriverBill, DriverBillCounter } from '../models/DriverBill.js';

/**
 * Driver bills (invoices) stored on the server.
 *
 * The app keeps generating the PDF and WhatsApp text. The server stores the
 * data, assigns the bill number (GK-000042, per driver, never reused), and
 * recomputes every total from the line items: the client's grand total is
 * never trusted. Every query is scoped to the driver from the token.
 */

const TRIP_TYPES = ['One Way', 'Round Trip', 'Local', 'Outstation'];
const PAYMENT_METHODS = ['Cash', 'Online (UPI)'];
const PAYMENT_STATUSES = ['Paid', 'Pending'];
const IST_OFFSET = '+05:30';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_IMPORT = 200;
const CREATE_LIMIT_PER_MINUTE = 60;
const CREATE_LIMIT_PER_DAY = 500;

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

// Printed into a PDF and a WhatsApp message: strip control characters.
const cleanText = (value, max = 300) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatBillNo = (seq) => `GK-${String(seq).padStart(6, '0')}`;

/** A date-time without a zone is the driver's local (IST) time. */
const parseTripDate = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  const isoLike = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(raw);
  const normalized = !hasZone && isoLike ? `${raw.length === 10 ? `${raw}T00:00:00` : raw.replace(' ', 'T')}${IST_OFFSET}` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Bare YYYY-MM-DD bounds are IST calendar days. */
const parseDateBound = (value, field) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const date = parseTripDate(value);
  if (!date) throw new ApiError(422, `${field} must be a valid date`, { field }, 'INVALID_DATE_RANGE');
  return date;
};

const normalizePhone = (value) => {
  let digits = String(value ?? '').replace(/[\s\-()]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return digits;
};

const readAmount = (body, key, { max, code, fields, codes, label }) => {
  const raw = body[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0 || number > max) {
    fields[key] = `${label} must be between 0 and ${max}`;
    codes[key] = code;
    return 0;
  }
  return round2(number);
};

/**
 * Validates a bill body. Returns the normalised values, or throws 422
 * VALIDATION_FAILED with a `fields` map keyed by request field name.
 */
const validateBill = (body = {}, { lenient = false } = {}) => {
  const fields = {};
  const codes = {};
  const fail = (key, message, code) => {
    fields[key] = message;
    codes[key] = code;
  };

  const customerName = cleanText(body.customerName, 80);
  if (customerName.length < 2) fail('customerName', 'Customer name is required', 'INVALID_CUSTOMER_NAME');

  const customerPhone = normalizePhone(body.customerPhone);
  if (customerPhone && !/^[6-9]\d{9}$/.test(customerPhone)) {
    fail('customerPhone', 'Phone must be exactly 10 digits', 'INVALID_PHONE');
  }

  const companyGst = cleanText(body.companyGst, 121);
  if (companyGst.length > 120) fail('companyGst', 'Company / GST must be at most 120 characters', 'INVALID_COMPANY_GST');

  const pickupAddress = cleanText(body.pickupAddress, 301);
  const dropAddress = cleanText(body.dropAddress, 301);
  if (pickupAddress.length < 3 || pickupAddress.length > 300) fail('pickupAddress', 'Pickup address is required', 'INVALID_PICKUP');
  if (dropAddress.length < 3 || dropAddress.length > 300) {
    fail('dropAddress', 'Drop address is required', 'INVALID_DROP');
  } else if (pickupAddress && pickupAddress.toLowerCase() === dropAddress.toLowerCase()) {
    fail('dropAddress', 'Pickup and drop cannot be the same', 'PICKUP_DROP_SAME');
  }

  let distanceKm = 0;
  if (body.distanceKm !== undefined && body.distanceKm !== null && String(body.distanceKm).trim() !== '') {
    distanceKm = Number(body.distanceKm);
    if (!Number.isFinite(distanceKm) || distanceKm < 0 || distanceKm > 5000) {
      fail('distanceKm', 'Distance must be between 0 and 5000 km', 'INVALID_DISTANCE');
      distanceKm = 0;
    }
    distanceKm = round2(distanceKm);
  }

  const tripType = String(body.tripType ?? 'One Way').trim();
  if (!TRIP_TYPES.includes(tripType)) fail('tripType', `Trip type must be one of ${TRIP_TYPES.join(', ')}`, 'INVALID_TRIP_TYPE');

  const tripDate = parseTripDate(body.tripDate);
  if (!tripDate) {
    fail('tripDate', 'Trip date is required', 'INVALID_TRIP_DATE');
  } else if (!lenient) {
    const now = Date.now();
    if (tripDate.getTime() < now - 366 * DAY_MS || tripDate.getTime() > now + 30 * DAY_MS) {
      fail('tripDate', 'Trip date must be within the last year and the next 30 days', 'INVALID_TRIP_DATE');
    }
  }

  const driverName = cleanText(body.driverName, 80);
  if (driverName.length < 2) fail('driverName', 'Driver name is required', 'INVALID_DRIVER_NAME');

  const vehicleNumber = String(body.vehicleNumber ?? '').replace(/\s+/g, '').toUpperCase();
  if (vehicleNumber.length < 5 || vehicleNumber.length > 15 || /[\u0000-\u001f]/.test(vehicleNumber)) {
    fail('vehicleNumber', 'Vehicle number must be 5 to 15 characters', 'INVALID_VEHICLE_NUMBER');
  }

  const vehicleModel = cleanText(body.vehicleModel, 61);
  if (vehicleModel.length < 1 || vehicleModel.length > 60) fail('vehicleModel', 'Vehicle model is required', 'INVALID_VEHICLE_MODEL');

  const amountOptions = (code, label, max) => ({ max, code, fields, codes, label });
  const baseFare = readAmount(body, 'baseFare', amountOptions('INVALID_BASE_FARE', 'Base fare', 500000));
  const ratePerKm = readAmount(body, 'ratePerKm', amountOptions('INVALID_RATE_PER_KM', 'Rate per km', 500));
  const toll = readAmount(body, 'toll', amountOptions('INVALID_TOLL', 'Toll', 25000));
  const parking = readAmount(body, 'parking', amountOptions('INVALID_PARKING', 'Parking', 10000));
  const waiting = readAmount(body, 'waiting', amountOptions('INVALID_WAITING', 'Waiting', 20000));
  const nightDa = readAmount(body, 'nightDa', amountOptions('INVALID_NIGHT_DA', 'Night / driver allowance', 25000));
  const extra = readAmount(body, 'extra', amountOptions('INVALID_EXTRA', 'Extra', 50000));
  const discount = readAmount(body, 'discount', amountOptions('INVALID_AMOUNT', 'Discount', 1000000));

  if (!fields.baseFare && baseFare <= 0 && !(ratePerKm > 0 && distanceKm > 0)) {
    fail('baseFare', 'Enter a base fare, or a rate per km with a distance', 'INVALID_BASE_FARE');
  }

  const paymentMethod = String(body.paymentMethod ?? '').trim();
  if (!PAYMENT_METHODS.includes(paymentMethod)) fail('paymentMethod', 'Choose Cash or Online (UPI)', 'INVALID_PAYMENT_METHOD');
  const paymentStatus = String(body.paymentStatus ?? '').trim();
  if (!PAYMENT_STATUSES.includes(paymentStatus)) fail('paymentStatus', 'Choose Paid or Pending', 'INVALID_PAYMENT_STATUS');

  let rideId = null;
  if (body.rideId !== undefined && body.rideId !== null && String(body.rideId).trim() !== '') {
    if (!mongoose.isValidObjectId(body.rideId)) fail('rideId', 'rideId is invalid', 'BILL_RIDE_FORBIDDEN');
    else rideId = new mongoose.Types.ObjectId(String(body.rideId));
  }

  if (Object.keys(fields).length) {
    const error = new ApiError(422, 'Please fix the highlighted fields', { codes }, 'VALIDATION_FAILED');
    error.fields = fields;
    throw error;
  }

  // §Fare maths: the server's numbers are the bill's numbers.
  const distanceCharge = ratePerKm > 0 && distanceKm > 0 ? round2(ratePerKm * distanceKm) : 0;
  const subtotal = round2(baseFare + distanceCharge + toll + parking + waiting + nightDa + extra);
  if (discount > subtotal) {
    const error = new ApiError(422, 'Discount cannot be more than the subtotal', { subtotal }, 'DISCOUNT_EXCEEDS_SUBTOTAL');
    error.fields = { discount: 'Discount cannot be more than the subtotal' };
    throw error;
  }
  const grandTotal = round2(Math.max(subtotal - discount, 0));
  if (grandTotal <= 0) {
    throw new ApiError(422, 'The bill total must be more than zero', null, 'ZERO_TOTAL');
  }

  return {
    ride_id: rideId,
    customer_name: customerName,
    customer_phone: customerPhone,
    company_gst: companyGst,
    pickup_address: pickupAddress,
    drop_address: dropAddress,
    distance_km: distanceKm,
    trip_type: tripType,
    trip_date: tripDate,
    driver_name: driverName,
    vehicle_number: vehicleNumber,
    vehicle_model: vehicleModel,
    base_fare: baseFare,
    rate_per_km: ratePerKm,
    toll,
    parking,
    waiting,
    night_da: nightDa,
    extra,
    discount,
    distance_charge: distanceCharge,
    subtotal,
    grand_total: grandTotal,
    payment_method: paymentMethod,
    payment_status: paymentStatus,
  };
};

export const serializeBill = (bill) => ({
  id: String(bill._id),
  billNo: bill.bill_no,
  rideId: bill.ride_id ? String(bill.ride_id) : null,
  customerName: bill.customer_name,
  customerPhone: bill.customer_phone || '',
  companyGst: bill.company_gst || '',
  pickupAddress: bill.pickup_address,
  dropAddress: bill.drop_address,
  distanceKm: bill.distance_km || 0,
  tripType: bill.trip_type,
  tripDate: bill.trip_date,
  driverName: bill.driver_name,
  vehicleNumber: bill.vehicle_number,
  vehicleModel: bill.vehicle_model,
  baseFare: bill.base_fare || 0,
  ratePerKm: bill.rate_per_km || 0,
  distanceCharge: bill.distance_charge || 0,
  toll: bill.toll || 0,
  parking: bill.parking || 0,
  waiting: bill.waiting || 0,
  nightDa: bill.night_da || 0,
  extra: bill.extra || 0,
  discount: bill.discount || 0,
  subtotal: bill.subtotal || 0,
  grandTotal: bill.grand_total || 0,
  paymentMethod: bill.payment_method,
  paymentStatus: bill.payment_status,
  imported: Boolean(bill.imported),
  createdAt: bill.createdAt,
});

const readClientRef = (value) => {
  const ref = String(value ?? '').trim();
  return ref ? ref.slice(0, 100) : null;
};

/** The ride a bill links to must be one this driver drove, created or assigned. */
const assertRideBelongsToDriver = async (rideId, driverId) => {
  const ride = await Ride.findById(rideId).select('driverId created_by_driver_id assignment.assigned_by_driver_id').lean();
  const me = String(driverId);
  const mine =
    ride &&
    [ride.driverId, ride.created_by_driver_id, ride.assignment?.assigned_by_driver_id]
      .filter(Boolean)
      .some((id) => String(id) === me);
  if (!mine) throw new ApiError(403, 'That ride is not one of yours', null, 'BILL_RIDE_FORBIDDEN');
};

const nextBillNo = async (driverId) => {
  const counter = await DriverBillCounter.findOneAndUpdate(
    { driver_id: driverId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return formatBillNo(counter.seq);
};

const assertCreateRate = async (driverId) => {
  const now = Date.now();
  const [lastMinute, lastDay] = await Promise.all([
    DriverBill.countDocuments({ driver_id: driverId, imported: { $ne: true }, createdAt: { $gt: new Date(now - 60 * 1000) } }),
    DriverBill.countDocuments({ driver_id: driverId, imported: { $ne: true }, createdAt: { $gt: new Date(now - DAY_MS) } }),
  ]);
  if (lastMinute >= CREATE_LIMIT_PER_MINUTE || lastDay >= CREATE_LIMIT_PER_DAY) {
    throw new ApiError(429, 'Too many bills in a short time. Try again later.', null, 'RATE_LIMITED');
  }
};

/** POST /drivers/bills. Returns `{ bill, created }` (created=false on a replay). */
export const createBill = async ({ driverId, body = {} }) => {
  const clientRef = readClientRef(body.clientRef);
  if (clientRef) {
    const existing = await DriverBill.findOne({ driver_id: driverId, client_ref: clientRef, deleted_at: null }).lean();
    if (existing) return { bill: serializeBill(existing), created: false };
  }

  const values = validateBill(body);
  if (values.ride_id) await assertRideBelongsToDriver(values.ride_id, driverId);
  await assertCreateRate(driverId);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const bill = await DriverBill.create({
        ...values,
        driver_id: driverId,
        client_ref: clientRef || undefined,
        bill_no: await nextBillNo(driverId),
      });
      return { bill: serializeBill(bill.toObject()), created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // The same clientRef raced in from a retry: hand back that bill.
      if (clientRef && error?.keyPattern?.client_ref) {
        const existing = await DriverBill.findOne({ driver_id: driverId, client_ref: clientRef }).lean();
        if (existing) return { bill: serializeBill(existing), created: false };
      }
      // bill_no collided (e.g. an imported legacy number): take the next one.
      if (attempt === 1) throw new ApiError(409, 'Could not assign a bill number. Try again.', null, 'BILL_NUMBER_CONFLICT');
    }
  }
  throw new ApiError(409, 'Could not assign a bill number. Try again.', null, 'BILL_NUMBER_CONFLICT');
};

/** GET /drivers/bills */
export const listBills = async ({ driverId, page = 1, limit = 20, q, paymentStatus, from, to, rideId }) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const filter = { driver_id: driverId, deleted_at: null };

  const term = String(q ?? '').trim();
  if (term) {
    const pattern = new RegExp(escapeRegex(term.slice(0, 60)), 'i');
    filter.$or = [{ customer_name: pattern }, { customer_phone: pattern }, { bill_no: pattern }];
  }
  if (paymentStatus !== undefined && String(paymentStatus).trim() !== '') {
    if (!PAYMENT_STATUSES.includes(String(paymentStatus).trim())) {
      throw new ApiError(422, 'paymentStatus must be Paid or Pending', null, 'INVALID_PAYMENT_STATUS');
    }
    filter.payment_status = String(paymentStatus).trim();
  }
  const fromDate = parseDateBound(from, 'from');
  const toDate = parseDateBound(to, 'to');
  if (fromDate || toDate) {
    filter.trip_date = { ...(fromDate ? { $gte: fromDate } : {}), ...(toDate ? { $lt: toDate } : {}) };
  }
  if (rideId !== undefined && String(rideId).trim() !== '') {
    if (!mongoose.isValidObjectId(rideId)) return { results: [], total: 0, page: safePage, limit: safeLimit };
    filter.ride_id = new mongoose.Types.ObjectId(String(rideId));
  }

  const [bills, total] = await Promise.all([
    DriverBill.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    DriverBill.countDocuments(filter),
  ]);

  return { results: bills.map(serializeBill), total, page: safePage, limit: safeLimit };
};

const loadOwnBill = async (driverId, billId) => {
  if (!mongoose.isValidObjectId(billId)) throw new ApiError(404, 'Bill not found', null, 'BILL_NOT_FOUND');
  const bill = await DriverBill.findOne({ _id: billId, driver_id: driverId }).lean();
  if (!bill) throw new ApiError(404, 'Bill not found', null, 'BILL_NOT_FOUND');
  return bill;
};

/** GET /drivers/bills/:id */
export const getBill = async ({ driverId, billId }) => {
  const bill = await loadOwnBill(driverId, billId);
  if (bill.deleted_at) throw new ApiError(404, 'Bill not found', null, 'BILL_NOT_FOUND');
  return serializeBill(bill);
};

/** DELETE /drivers/bills/:id. Soft, idempotent; the number is never reused. */
export const deleteBill = async ({ driverId, billId }) => {
  const bill = await loadOwnBill(driverId, billId);
  if (!bill.deleted_at) {
    await DriverBill.updateOne({ _id: bill._id, deleted_at: null }, { $set: { deleted_at: new Date() } });
  }
  return { deleted: true, id: String(bill._id) };
};

/**
 * POST /drivers/bills/import: one-time upload of bills kept on the phone.
 * Lenient: a bad row is skipped, never fatal. Legacy numbers are kept (they
 * were already sent to customers), as is the original createdAt.
 */
export const importBills = async ({ driverId, bills }) => {
  if (!Array.isArray(bills)) throw new ApiError(422, 'bills must be an array', null, 'VALIDATION_FAILED');
  if (bills.length > MAX_IMPORT) {
    throw new ApiError(422, `At most ${MAX_IMPORT} bills per import`, { limit: MAX_IMPORT }, 'IMPORT_TOO_LARGE');
  }

  const items = [];
  let imported = 0;
  let skipped = 0;

  for (const raw of bills) {
    const body = raw && typeof raw === 'object' ? raw : {};
    const clientRef = readClientRef(body.clientRef) || (body.legacyId ? `legacy:${String(body.legacyId).trim()}` : null);
    if (!clientRef) {
      skipped += 1;
      items.push({ clientRef: null, status: 'skipped', reason: 'clientRef is required' });
      continue;
    }

    const existing = await DriverBill.findOne({ driver_id: driverId, client_ref: clientRef }).lean();
    if (existing) {
      items.push({ clientRef, status: 'exists', id: String(existing._id), billNo: existing.bill_no });
      continue;
    }

    let values;
    try {
      values = validateBill(body, { lenient: true });
      if (values.ride_id) {
        // A link we cannot confirm is dropped rather than failing the row.
        try {
          await assertRideBelongsToDriver(values.ride_id, driverId);
        } catch {
          values.ride_id = null;
        }
      }
    } catch (error) {
      skipped += 1;
      const firstField = error.fields ? Object.values(error.fields)[0] : null;
      items.push({ clientRef, status: 'skipped', reason: firstField || error.message });
      continue;
    }

    // The total already sent to the customer stands; flag when ours differs.
    const sentTotal = Number(body.grandTotal);
    const recomputedMismatch = Number.isFinite(sentTotal) && Math.abs(round2(sentTotal) - values.grand_total) > 0.01;
    if (recomputedMismatch) values.grand_total = round2(sentTotal);

    let billNo = String(body.legacyBillNo ?? body.billNo ?? '').trim().slice(0, 30);
    let renamed = false;
    if (!billNo) {
      billNo = await nextBillNo(driverId);
    } else if (await DriverBill.exists({ driver_id: driverId, bill_no: billNo })) {
      billNo = `${billNo}-L`;
      renamed = true;
    }

    const createdAt = body.createdAt && !Number.isNaN(new Date(body.createdAt).getTime()) ? new Date(body.createdAt) : new Date();
    try {
      const [doc] = await DriverBill.insertMany(
        [
          {
            ...values,
            driver_id: driverId,
            client_ref: clientRef,
            bill_no: billNo,
            imported: true,
            createdAt,
            updatedAt: new Date(),
          },
        ],
        { timestamps: false },
      );
      imported += 1;
      items.push({
        clientRef,
        status: 'imported',
        id: String(doc._id),
        billNo,
        ...(renamed ? { renamed: true } : {}),
        ...(recomputedMismatch ? { recomputedMismatch: true } : {}),
      });
    } catch (error) {
      skipped += 1;
      items.push({ clientRef, status: 'skipped', reason: error?.code === 11000 ? 'Duplicate bill' : 'Could not save' });
    }
  }

  return { imported, skipped, items };
};
