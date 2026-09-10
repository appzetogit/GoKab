import { PoolingVehicle } from '../models/PoolingVehicle.js';
import { PoolingBooking } from '../models/PoolingBooking.js';
import { PoolingRoute } from '../models/PoolingRoute.js';
import { PoolingSeatReservation } from '../models/PoolingSeatReservation.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { uploadDataUrlToCloudinary } from '../../../../utils/cloudinaryUpload.js';
import { mediaService } from '../../../../services/media.service.js';

const ok = (res, data, message) => res.status(200).json({ success: true, data, message });
const created = (res, data, message) => res.status(201).json({ success: true, data, message });

// --- Pooling Vehicles ---

export const getPoolingVehicles = asyncHandler(async (req, res) => {
  const query = {};
  const approveQuery = String(req.query.approve ?? '').trim().toLowerCase();
  const statusQuery = String(req.query.status ?? '').trim().toLowerCase();
  const search = String(req.query.search || '').trim();

  if (approveQuery === 'true') {
    query.approve = true;
  } else if (approveQuery === 'false') {
    query.approve = false;
  }

  if (statusQuery) {
    query.status = statusQuery;
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { vehicleModel: { $regex: search, $options: 'i' } },
      { vehicleNumber: { $regex: search, $options: 'i' } },
      { driverName: { $regex: search, $options: 'i' } },
      { driverPhone: { $regex: search, $options: 'i' } },
    ];
  }

  const vehicles = await PoolingVehicle.find(query).sort({ createdAt: -1 });
  return ok(res, vehicles, 'Pooling vehicles fetched successfully');
});

export const createPoolingVehicle = asyncHandler(async (req, res) => {
  const vehicle = await PoolingVehicle.create({
    approve: true,
    ...req.body,
    approve: req.body?.approve ?? true,
  });
  return created(res, vehicle, 'Pooling vehicle created successfully');
});

export const updatePoolingVehicle = asyncHandler(async (req, res) => {
  const vehicle = await PoolingVehicle.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!vehicle) throw new ApiError(404, 'Vehicle not found');
  return ok(res, vehicle, 'Pooling vehicle updated successfully');
});

export const deletePoolingVehicle = asyncHandler(async (req, res) => {
  const vehicle = await PoolingVehicle.findByIdAndDelete(req.params.id);
  if (!vehicle) throw new ApiError(404, 'Vehicle not found');
  return ok(res, null, 'Pooling vehicle deleted successfully');
});

export const approvePoolingVehicle = asyncHandler(async (req, res) => {
  const vehicle = await PoolingVehicle.findByIdAndUpdate(
    req.params.id,
    {
      approve: true,
      status: 'active',
      poolingEnabled: true,
    },
    { new: true },
  );

  if (!vehicle) {
    throw new ApiError(404, 'Vehicle not found');
  }

  return ok(res, vehicle, 'Pooling vehicle approved successfully');
});

// --- Pooling Bookings ---

export const getPoolingBookings = asyncHandler(async (req, res) => {
  const bookings = await PoolingBooking.find()
    .populate('user', 'name phone email')
    .populate('route', 'routeName originLabel destinationLabel')
    .populate('vehicle', 'name vehicleNumber driverName driverPhone')
    .sort({ createdAt: -1 });
  return ok(res, bookings, 'Pooling bookings fetched successfully');
});

export const updatePoolingBookingStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const booking = await PoolingBooking.findByIdAndUpdate(
    req.params.id,
    { bookingStatus: status },
    { new: true }
  );
  if (!booking) throw new ApiError(404, 'Booking not found');

  if (['cancelled', 'no_show'].includes(String(status || '').toLowerCase())) {
    await PoolingSeatReservation.deleteMany({ booking: booking._id });
  }

  return ok(res, booking, 'Booking status updated successfully');
});

// --- Routes & Stops (Already mostly handled, but adding placeholders for consistency) ---

export const getPoolingRoutes = asyncHandler(async (req, res) => {
  const routes = await PoolingRoute.find().sort({ createdAt: -1 });
  return ok(res, routes, 'Pooling routes fetched successfully');
});

// --- Common Upload ---

export const uploadImage = asyncHandler(async (req, res) => {
  const { image } = req.body;
  if (!image) throw new ApiError(400, 'Image data is required');

  const result = await mediaService.uploadMedia(image, 'vehicles', '', req);

  return ok(res, { url: result.url }, 'Image uploaded successfully');
});
