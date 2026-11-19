import { ApiError } from '../../../../utils/ApiError.js';
import { Driver } from '../../driver/models/Driver.js';
import { sendPushNotificationToEntities } from '../../services/pushNotificationService.js';
import { User } from '../../user/models/User.js';
import { DriverOffer } from '../models/DriverOffer.js';
import { OfferBooking } from '../models/OfferBooking.js';

const place = (p) => String(p?.name || '').trim();
const routeOf = (offer) => `${place(offer.from)} → ${place(offer.to)}`;

const push = (target, title, body, data) =>
  sendPushNotificationToEntities({ ...target, title, body, data }).catch((error) =>
    console.error('[offerBooking] push failed:', error.message),
  );

const serialize = (b, offer, extra = {}) => ({
  id: String(b._id),
  offer_id: String(b.offer_id),
  company: offer?.company || '',
  route: offer ? routeOf(offer) : '',
  car_type: b.car_type,
  price: b.price,
  pickup_at: b.pickup_at,
  passengers: b.passengers,
  note: b.note,
  status: b.status,
  created_at: b.createdAt,
  ...extra,
});

export const createBooking = async ({ userId, offerId, input = {} }) => {
  const offer = await DriverOffer.findById(offerId).lean();
  const now = new Date();
  if (!offer || offer.status !== 'active' || !offer.live_until || offer.live_until <= now) {
    throw new ApiError(404, 'This offer is no longer available', null, 'OFFER_NOT_AVAILABLE');
  }

  const cars = offer.car_types || [];
  const carType = String(input.car_type || (cars.length === 1 ? cars[0] : '')).toLowerCase();
  if (!cars.includes(carType)) throw new ApiError(400, 'Choose a car type');

  const pickupAt = new Date(input.pickup_at);
  if (Number.isNaN(pickupAt.getTime()) || pickupAt <= now) throw new ApiError(400, 'Choose a pickup date and time in the future');

  const passengers = Math.floor(Number(input.passengers) || 1);
  if (passengers < 1 || passengers > 50) throw new ApiError(400, 'Passengers must be between 1 and 50');

  if (await OfferBooking.exists({ offer_id: offerId, user_id: userId, status: 'requested' })) {
    throw new ApiError(409, 'You already have a pending request for this offer', null, 'BOOKING_EXISTS');
  }

  const individual = offer.individual_prices || {};
  const price = Number(individual[carType]) > 0 ? Number(individual[carType]) : offer.offer_price;
  const user = await User.findById(userId).select('name phone').lean();

  const booking = await OfferBooking.create({
    offer_id: offer._id,
    driver_id: offer.driver_id,
    user_id: userId,
    user_name: user?.name || '',
    user_phone: user?.phone || '',
    car_type: carType,
    price,
    pickup_at: pickupAt,
    passengers,
    note: String(input.note || '').trim().slice(0, 300),
  });

  await push(
    { driverIds: [String(offer.driver_id)] },
    'New offer booking request',
    `${user?.name || 'A customer'} wants to book ${routeOf(offer)} (${carType}) · ₹${price}`,
    { type: 'offer_booking', bookingId: String(booking._id), offerId: String(offer._id) },
  );
  return serialize(booking, offer);
};

export const listUserBookings = async (userId) => {
  const bookings = await OfferBooking.find({ user_id: userId }).sort({ createdAt: -1 }).limit(100).lean();
  const offers = await DriverOffer.find({ _id: { $in: bookings.map((b) => b.offer_id) } }).lean();
  const map = new Map(offers.map((o) => [String(o._id), o]));
  return bookings.map((b) => serialize(b, map.get(String(b.offer_id))));
};

export const cancelUserBooking = async ({ userId, bookingId }) => {
  const booking = await OfferBooking.findOneAndUpdate(
    { _id: bookingId, user_id: userId, status: 'requested' },
    { $set: { status: 'cancelled', responded_at: new Date() } },
    { new: true },
  );
  if (!booking) throw new ApiError(404, 'Pending booking not found');
  return serialize(booking, await DriverOffer.findById(booking.offer_id).lean());
};

export const listDriverBookings = async ({ driverId, status = '' }) => {
  const filter = { driver_id: driverId };
  if (status) filter.status = status;
  const bookings = await OfferBooking.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  const offers = await DriverOffer.find({ _id: { $in: bookings.map((b) => b.offer_id) } }).lean();
  const map = new Map(offers.map((o) => [String(o._id), o]));
  return bookings.map((b) => serialize(b, map.get(String(b.offer_id)), { user: { name: b.user_name, phone: b.user_phone } }));
};

export const respondToBooking = async ({ driverId, bookingId, status }) => {
  if (!['accepted', 'rejected'].includes(status)) throw new ApiError(400, "status must be 'accepted' or 'rejected'");
  const booking = await OfferBooking.findOneAndUpdate(
    { _id: bookingId, driver_id: driverId, status: 'requested' },
    { $set: { status, responded_at: new Date() } },
    { new: true },
  );
  if (!booking) throw new ApiError(404, 'Pending booking not found');

  const [offer, driver] = await Promise.all([
    DriverOffer.findById(booking.offer_id).lean(),
    Driver.findById(driverId).select('name phone').lean(),
  ]);
  const accepted = status === 'accepted';
  await push(
    { userIds: [String(booking.user_id)] },
    accepted ? 'Booking accepted' : 'Booking declined',
    accepted
      ? `${driver?.name || 'The driver'} accepted your booking for ${offer ? routeOf(offer) : 'the offer'}${driver?.phone ? `. Call ${driver.phone}` : ''}`
      : `${driver?.name || 'The driver'} could not take your booking for ${offer ? routeOf(offer) : 'the offer'}`,
    { type: 'offer_booking_update', bookingId: String(booking._id), status },
  );
  return serialize(booking, offer, { user: { name: booking.user_name, phone: booking.user_phone } });
};
