import { Router } from 'express';
import { uploadImage } from '../../../../middleware/upload.middleware.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  cancelUserBooking,
  createBooking,
  listDriverBookings,
  listUserBookings,
  respondToBooking,
} from '../services/offerBookingService.js';
import {
  createOfferWithOrder,
  deactivateDriverOffer,
  getPricingForAdmin,
  getPricingForDriver,
  listDriverOffers,
  listOffersForAdmin,
  listOffersForUser,
  quote,
  updatePricing,
  verifyOfferPayment,
} from '../services/offerService.js';

export const offerModuleRouter = Router();

const ok = (res, data) => res.json({ success: true, data });
const driverId = (req) => req.auth?.sub;
const asNumber = (value) => (value === undefined || value === '' ? NaN : Number(value));

// Mounted ahead of the driver / user / admin routers so these concrete paths
// are not captured by their parameterised ones.

// ---- driver ----
offerModuleRouter.get('/drivers/offers/pricing', authenticate(['driver']), asyncHandler(async (_req, res) => ok(res, await getPricingForDriver())));
offerModuleRouter.post('/drivers/offers/quote', authenticate(['driver']), asyncHandler(async (req, res) => ok(res, await quote(req.body?.live_hours))));
offerModuleRouter.get('/drivers/offers/mine', authenticate(['driver']), asyncHandler(async (req, res) => ok(res, { results: await listDriverOffers(driverId(req)) })));

// multipart: `data` = the offer as JSON, `banner` = optional image.
offerModuleRouter.post(
  '/drivers/offers',
  authenticate(['driver']),
  uploadImage('advertisements', 'banner'),
  asyncHandler(async (req, res) => {
    let input = req.body;
    if (typeof req.body?.data === 'string') {
      try {
        input = JSON.parse(req.body.data);
      } catch {
        throw new ApiError(400, 'Offer data is not valid JSON');
      }
    }
    if (req.file && !String(req.file.mimetype).startsWith('image/')) throw new ApiError(415, 'Banner must be an image');
    ok(res, await createOfferWithOrder({ driverId: driverId(req), input, bannerUrl: req.fileUrl || '' }));
  }),
);

offerModuleRouter.post(
  '/drivers/offers/:id/verify-payment',
  authenticate(['driver']),
  asyncHandler(async (req, res) => ok(res, await verifyOfferPayment({ driverId: driverId(req), offerId: req.params.id, ...req.body }))),
);
offerModuleRouter.patch(
  '/drivers/offers/:id/deactivate',
  authenticate(['driver']),
  asyncHandler(async (req, res) => ok(res, await deactivateDriverOffer({ offerId: req.params.id, driverId: driverId(req), by: 'driver' }))),
);

// ---- users (public) ----
offerModuleRouter.get(
  '/users/offers',
  asyncHandler(async (req, res) => {
    const radius = asNumber(req.query.radius_km);
    ok(res, {
      results: await listOffersForUser({
        lat: asNumber(req.query.lat),
        lng: asNumber(req.query.lng),
        radiusKm: Number.isFinite(radius) && radius > 0 ? radius : 50,
      }),
    });
  }),
);

// ---- booking requests ----
offerModuleRouter.post(
  '/users/offers/:id/book',
  authenticate(['user']),
  asyncHandler(async (req, res) => ok(res, await createBooking({ userId: driverId(req), offerId: req.params.id, input: req.body }))),
);
offerModuleRouter.get(
  '/users/offers/bookings/mine',
  authenticate(['user']),
  asyncHandler(async (req, res) => ok(res, { results: await listUserBookings(driverId(req)) })),
);
offerModuleRouter.patch(
  '/users/offers/bookings/:id/cancel',
  authenticate(['user']),
  asyncHandler(async (req, res) => ok(res, await cancelUserBooking({ userId: driverId(req), bookingId: req.params.id }))),
);
offerModuleRouter.get(
  '/drivers/offers/bookings',
  authenticate(['driver']),
  asyncHandler(async (req, res) => ok(res, { results: await listDriverBookings({ driverId: driverId(req), status: String(req.query.status || '') }) })),
);
offerModuleRouter.patch(
  '/drivers/offers/bookings/:id',
  authenticate(['driver']),
  asyncHandler(async (req, res) => ok(res, await respondToBooking({ driverId: driverId(req), bookingId: req.params.id, status: req.body?.status }))),
);

// ---- admin ----
offerModuleRouter.use('/admin/offers', authenticate(['admin']));
offerModuleRouter.get('/admin/offers/pricing', asyncHandler(async (_req, res) => ok(res, await getPricingForAdmin())));
offerModuleRouter.put('/admin/offers/pricing', asyncHandler(async (req, res) => ok(res, await updatePricing(req.body))));
offerModuleRouter.get(
  '/admin/offers',
  asyncHandler(async (req, res) =>
    ok(res, await listOffersForAdmin({
      status: String(req.query.status || ''),
      page: Math.max(1, Number(req.query.page) || 1),
      limit: Math.min(100, Math.max(1, Number(req.query.limit) || 20)),
    })),
  ),
);
offerModuleRouter.patch(
  '/admin/offers/:id/deactivate',
  asyncHandler(async (req, res) => ok(res, await deactivateDriverOffer({ offerId: req.params.id, by: 'admin' }))),
);
