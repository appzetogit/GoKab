import Razorpay from 'razorpay';
import { ApiError } from '../../../../utils/ApiError.js';
import { Driver } from '../../driver/models/Driver.js';
import { isValidRazorpayPaymentSignature } from '../../services/razorpaySecurity.js';
import { DriverOffer } from '../models/DriverOffer.js';
import { OfferPricing } from '../models/OfferPricing.js';

const SLABS = [
  { unit: 'hour', hours: 1, key: 'hour_rate' },
  { unit: 'day', hours: 24, key: 'day_rate' },
  { unit: 'week', hours: 168, key: 'week_rate' },
  { unit: 'month', hours: 720, key: 'month_rate' },
];
const DURATION_TYPES = ['h2', 'h4', 'h8', 'h16', 'day1', 'day2', 'custom'];
const CAR_TYPES = ['sedan', 'suv', 'muv', 'hatchback', 'premium', 'luxury', 'other'];
const MAX_STOPS = { fixed: 10, additional: 3 };

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

const razorpayKeys = () => {
  const key_id = String(process.env.RAZORPAY_KEY_ID || '').trim();
  const key_secret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();
  if (!key_id || !key_secret) {
    throw new ApiError(503, 'Payments are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
  }
  return { key_id, key_secret };
};

// ---------- pricing ----------

export const getPricing = async () =>
  OfferPricing.findOneAndUpdate({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true, new: true });

const serializePricing = (p) => ({
  hour_rate: p.hour_rate,
  day_rate: p.day_rate,
  week_rate: p.week_rate,
  month_rate: p.month_rate,
  max_live_hours: p.max_live_hours,
  enabled: p.enabled,
  // Slabs the driver can pick as one-tap presets.
  presets: SLABS.filter((s) => p[s.key] > 0).map((s) => ({ unit: s.unit, hours: s.hours, price: p[s.key] })),
});

export const getPricingForDriver = async () => serializePricing(await getPricing());
export const getPricingForAdmin = getPricingForDriver;

export const updatePricing = async (payload = {}) => {
  const pricing = await getPricing();
  for (const field of ['hour_rate', 'day_rate', 'week_rate', 'month_rate']) {
    if (payload[field] === undefined) continue;
    const value = Number(payload[field]);
    if (!Number.isFinite(value) || value < 0) throw new ApiError(400, `${field} must be 0 or more`);
    pricing[field] = round2(value);
  }
  if (payload.max_live_hours !== undefined) {
    const value = Math.floor(Number(payload.max_live_hours));
    if (!Number.isFinite(value) || value < 1 || value > 8760) throw new ApiError(400, 'max_live_hours must be 1 to 8760');
    pricing.max_live_hours = value;
  }
  if (payload.enabled !== undefined) pricing.enabled = Boolean(payload.enabled);
  await pricing.save();
  return serializePricing(pricing);
};

/**
 * Cheapest way to keep an offer live for at least `liveHours`, from the admin's
 * hour / day / week / month rates. A bigger slab can cover the hours for less
 * than many small ones (23 h may cost less as 1 day), so the driver is charged
 * that and gets the hours the slab covers.
 */
export const computeOfferFee = (pricing, liveHours) => {
  const slabs = SLABS.map((s) => ({ ...s, price: Number(pricing[s.key]) || 0 })).filter((s) => s.price > 0);
  if (!pricing.enabled || slabs.length === 0) {
    throw new ApiError(409, 'Offer publishing is not available right now', null, 'OFFER_PRICING_NOT_SET');
  }
  const hours = Math.ceil(Number(liveHours));
  if (!Number.isFinite(hours) || hours < 1) throw new ApiError(400, 'Choose how long the offer should stay live');
  if (hours > pricing.max_live_hours) {
    throw new ApiError(400, `An offer can stay live for at most ${pricing.max_live_hours} hours`, null, 'LIVE_HOURS_TOO_LONG');
  }

  const cost = new Array(hours + 1).fill(Infinity);
  const via = new Array(hours + 1).fill(null);
  cost[0] = 0;
  for (let h = 1; h <= hours; h += 1) {
    for (const slab of slabs) {
      const prev = Math.max(0, h - slab.hours);
      const candidate = cost[prev] + slab.price;
      if (candidate < cost[h]) {
        cost[h] = candidate;
        via[h] = { slab, prev };
      }
    }
  }

  const counts = new Map();
  for (let h = hours; h > 0; h = via[h].prev) {
    const { slab } = via[h];
    counts.set(slab.unit, { slab, count: (counts.get(slab.unit)?.count || 0) + 1 });
  }
  const breakdown = [...counts.values()]
    .sort((a, b) => b.slab.hours - a.slab.hours)
    .map(({ slab, count }) => ({ unit: slab.unit, count, unit_price: slab.price, amount: round2(slab.price * count) }));
  const coveredHours = breakdown.reduce((sum, row) => sum + row.count * SLABS.find((s) => s.unit === row.unit).hours, 0);

  return { fee: round2(cost[hours]), requested_hours: hours, covered_hours: Math.max(coveredHours, hours), breakdown };
};

export const quote = async (liveHours) => computeOfferFee(await getPricing(), liveHours);

// ---------- serialization ----------

const discountPercent = (offer) =>
  offer.regular_price && offer.regular_price > offer.offer_price
    ? Math.round(((offer.regular_price - offer.offer_price) / offer.regular_price) * 100)
    : null;

const base = (o) => ({
  id: String(o._id),
  company: o.company,
  from: o.from,
  to: o.to,
  stops: o.stops || [],
  location_type: o.location_type,
  duration_type: o.duration_type,
  custom_hours: o.custom_hours,
  offer_price: o.offer_price,
  regular_price: o.regular_price,
  discount_percent: discountPercent(o),
  car_types: o.car_types || [],
  individual_prices: o.individual_prices instanceof Map ? Object.fromEntries(o.individual_prices) : o.individual_prices || {},
  valid_from: o.valid_from,
  valid_to: o.valid_to,
  banner_url: o.banner_url || '',
  live_until: o.live_until,
});

const forDriver = (o) => ({
  ...base(o),
  status: o.status,
  fee_amount: o.fee_amount,
  fee_breakdown: o.fee_breakdown,
  requested_hours: o.requested_hours,
  covered_hours: o.covered_hours,
  live_from: o.live_from,
  created_at: o.createdAt,
});

const forUser = (o, driver, distanceKm) => ({
  ...base(o),
  driver: { name: driver?.name || '', phone: driver?.phone || '' },
  distance_km: distanceKm,
});

// ---------- lifecycle ----------

/** Offers whose paid time ran out. Run before reads instead of a cron. */
export const expireOffers = () =>
  DriverOffer.updateMany({ status: 'active', live_until: { $lte: new Date() } }, { $set: { status: 'expired' } });

const cleanPlace = (value, label) => {
  const name = String(value?.name || '').trim();
  if (!name) throw new ApiError(400, `${label} is required`);
  return { name, lat: num(value?.lat), lng: num(value?.lng) };
};

const validateOffer = (input) => {
  const company = String(input.company || '').trim();
  if (!company) throw new ApiError(400, 'Company name is required');
  const locationType = input.location_type === 'additional' ? 'additional' : 'fixed';
  const stops = (Array.isArray(input.stops) ? input.stops : []).map((s, i) => cleanPlace(s, `Stop ${i + 1}`));
  if (stops.length > MAX_STOPS[locationType]) {
    throw new ApiError(400, `You can add at most ${MAX_STOPS[locationType]} stops`);
  }
  if (!DURATION_TYPES.includes(input.duration_type)) throw new ApiError(400, 'Choose a rental duration');
  const customHours = input.duration_type === 'custom' ? Math.floor(Number(input.custom_hours)) : null;
  if (input.duration_type === 'custom' && !(customHours > 0)) throw new ApiError(400, 'Enter the custom rental hours');

  const offerPrice = Number(input.offer_price);
  if (!Number.isFinite(offerPrice) || offerPrice < 1) throw new ApiError(400, 'Enter the offer price');
  const regularPrice = num(input.regular_price);
  if (regularPrice !== null && !(regularPrice > 0)) throw new ApiError(400, 'Regular price is invalid');

  const carTypes = [...new Set((Array.isArray(input.car_types) ? input.car_types : []).map((c) => String(c).toLowerCase()))];
  if (carTypes.length === 0 || carTypes.some((c) => !CAR_TYPES.includes(c))) throw new ApiError(400, 'Choose the car types');
  const individual = {};
  for (const [carType, price] of Object.entries(input.individual_prices || {})) {
    const key = String(carType).toLowerCase();
    if (!carTypes.includes(key)) continue;
    if (!(Number(price) > 0)) throw new ApiError(400, `Enter a price for ${key}`);
    individual[key] = Math.round(Number(price));
  }

  const validFrom = new Date(input.valid_from);
  const validTo = new Date(input.valid_to);
  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime()) || validTo < validFrom) {
    throw new ApiError(400, 'Valid-from and valid-to dates are invalid');
  }

  return {
    company,
    from: cleanPlace(input.from, 'From'),
    to: cleanPlace(input.to, 'To'),
    stops,
    location_type: locationType,
    duration_type: input.duration_type,
    custom_hours: customHours,
    offer_price: Math.round(offerPrice),
    regular_price: regularPrice === null ? null : Math.round(regularPrice),
    car_types: carTypes,
    individual_prices: individual,
    valid_from: validFrom,
    valid_to: validTo,
  };
};

/** Saves the offer unpublished and opens a Razorpay order for the fee. */
export const createOfferWithOrder = async ({ driverId, input, bannerUrl = '' }) => {
  const fields = validateOffer(input);
  const pricing = await getPricing();
  const priced = computeOfferFee(pricing, input.live_hours);

  const keys = razorpayKeys();
  const offer = await DriverOffer.create({
    ...fields,
    driver_id: driverId,
    banner_url: bannerUrl,
    requested_hours: priced.requested_hours,
    covered_hours: priced.covered_hours,
    fee_amount: priced.fee,
    fee_breakdown: priced.breakdown,
    status: 'pending_payment',
  });

  const order = await new Razorpay(keys).orders.create({
    amount: Math.round(priced.fee * 100),
    currency: 'INR',
    receipt: `offer_${offer._id}`.slice(0, 40),
    notes: { driverId: String(driverId), offerId: String(offer._id) },
  });
  offer.razorpay_order_id = order.id;
  await offer.save();

  return { offer: forDriver(offer), orderId: order.id, amount: priced.fee, currency: 'INR', keyId: keys.key_id };
};

export const verifyOfferPayment = async ({ driverId, offerId, razorpay_order_id, razorpay_payment_id, razorpay_signature }) => {
  const offer = await DriverOffer.findOne({ _id: offerId, driver_id: driverId });
  if (!offer) throw new ApiError(404, 'Offer not found');
  if (offer.status === 'active') return forDriver(offer);
  if (offer.status !== 'pending_payment' || offer.razorpay_order_id !== razorpay_order_id) {
    throw new ApiError(409, 'This offer cannot be paid for any more');
  }

  const valid = isValidRazorpayPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
    keySecret: razorpayKeys().key_secret,
  });
  if (!valid) throw new ApiError(400, 'Razorpay payment signature verification failed');

  const now = new Date();
  offer.status = 'active';
  offer.razorpay_payment_id = razorpay_payment_id;
  offer.razorpay_signature = razorpay_signature;
  offer.paid_at = now;
  offer.live_from = now;
  offer.live_until = new Date(now.getTime() + offer.covered_hours * 3600 * 1000);
  await offer.save();
  return forDriver(offer);
};

export const listDriverOffers = async (driverId) => {
  await expireOffers();
  const offers = await DriverOffer.find({ driver_id: driverId, status: { $ne: 'pending_payment' } })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return offers.map(forDriver);
};

export const deactivateDriverOffer = async ({ offerId, driverId = null, by }) => {
  const filter = { _id: offerId, status: 'active' };
  if (driverId) filter.driver_id = driverId;
  const offer = await DriverOffer.findOneAndUpdate(filter, { $set: { status: 'deactivated', deactivated_by: by } }, { new: true });
  if (!offer) throw new ApiError(404, 'Active offer not found');
  return forDriver(offer);
};

// ---------- users ----------

const toRad = (deg) => (deg * Math.PI) / 180;
const distanceKm = (aLat, aLng, bLat, bLng) => {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/**
 * Live offers for the user app. With a location, only offers with a city
 * (from / stops / to) within `radiusKm` of the user, nearest first.
 */
// ponytail: filters in memory (<= 200 live offers); add a 2dsphere index if that ever grows.
export const listOffersForUser = async ({ lat = null, lng = null, radiusKm = 50 }) => {
  await expireOffers();
  const now = new Date();
  const offers = await DriverOffer.find({
    status: 'active',
    live_until: { $gt: now },
    valid_from: { $lte: now },
    valid_to: { $gte: new Date(now.getTime() - 24 * 3600 * 1000) },
  })
    .sort({ live_from: -1 })
    .limit(200)
    .lean();

  const drivers = await Driver.find({ _id: { $in: offers.map((o) => o.driver_id) } }).select('name phone').lean();
  const driverMap = new Map(drivers.map((d) => [String(d._id), d]));
  const located = Number.isFinite(lat) && Number.isFinite(lng);

  const rows = [];
  for (const offer of offers) {
    let nearest = null;
    if (located) {
      const points = [offer.from, ...(offer.stops || []), offer.to].filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
      if (points.length) {
        nearest = Math.min(...points.map((p) => distanceKm(lat, lng, p.lat, p.lng)));
        if (nearest > radiusKm) continue;
      }
    }
    rows.push(forUser(offer, driverMap.get(String(offer.driver_id)), nearest === null ? null : Math.round(nearest * 10) / 10));
  }
  if (located) rows.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
  return rows;
};

// ---------- admin ----------

export const listOffersForAdmin = async ({ status = '', page = 1, limit = 20 }) => {
  await expireOffers();
  const filter = status ? { status } : { status: { $ne: 'pending_payment' } };
  const skip = (Math.max(1, page) - 1) * limit;
  const [offers, total, revenue] = await Promise.all([
    DriverOffer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    DriverOffer.countDocuments(filter),
    DriverOffer.aggregate([{ $match: { paid_at: { $ne: null } } }, { $group: { _id: null, total: { $sum: '$fee_amount' }, count: { $sum: 1 } } }]),
  ]);
  const drivers = await Driver.find({ _id: { $in: offers.map((o) => o.driver_id) } }).select('name phone').lean();
  const driverMap = new Map(drivers.map((d) => [String(d._id), d]));
  return {
    results: offers.map((o) => ({
      ...forDriver(o),
      driver: { name: driverMap.get(String(o.driver_id))?.name || '', phone: driverMap.get(String(o.driver_id))?.phone || '' },
    })),
    total,
    page,
    limit,
    revenue: { total: round2(revenue[0]?.total || 0), paid_offers: revenue[0]?.count || 0 },
  };
};
