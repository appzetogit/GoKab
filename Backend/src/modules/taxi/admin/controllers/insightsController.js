import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { Driver } from '../../driver/models/Driver.js';
import { DriverSubscription } from '../../driver/models/DriverSubscription.js';
import { User } from '../../user/models/User.js';
import { Ride } from '../../user/models/Ride.js';
import { SafetyAlert } from '../../common/models/SafetyAlert.js';
import { SupportTicket } from '../../support/models/SupportTicket.js';
import { DriverNeededDocument } from '../models/DriverNeededDocument.js';
import { FleetVehicle } from '../models/FleetVehicle.js';
import { ServiceLocation } from '../models/ServiceLocation.js';
import { SetPrice } from '../models/SetPrice.js';
import { Vehicle } from '../models/Vehicle.js';
import { WithdrawalRequest } from '../models/WithdrawalRequest.js';

// Read-only helpers for the admin dashboard and the global search. Nothing here changes data.

const count = (model, filter) => model.countDocuments(filter).catch(() => 0);

/**
 * GET /admin/insights/attention
 * Everything that is waiting for the admin, plus whether the first-time setup is complete.
 */
export const attentionSummaryController = async (req, res) => {
  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    pendingDrivers,
    pendingVehicles,
    pendingWithdrawals,
    negativeWallets,
    openTickets,
    activeSos,
    commercialWaiting,
    plansExpiring,
    driverDeletes,
    userDeletes,
    cities,
    vehicleTypes,
    setPrices,
    documents,
  ] = await Promise.all([
    count(Driver, { approve: false, deletedAt: null }),
    count(FleetVehicle, { status: 'pending' }),
    count(WithdrawalRequest, { status: 'pending' }),
    count(Driver, { 'wallet.balance': { $lt: 0 }, deletedAt: null }),
    count(SupportTicket, { status: 'pending' }),
    count(SafetyAlert, { status: 'active' }),
    count(Driver, { vehicle_usage_type: 'commercial', vehicle_usage_verified: { $ne: true }, deletedAt: null, approve: true }),
    count(DriverSubscription, { status: 'active', end_date: { $gte: now, $lte: inSevenDays } }),
    count(Driver, { 'deletionRequest.status': 'pending', deletedAt: null }),
    count(User, { 'deletionRequest.status': 'pending', deletedAt: null }),
    count(ServiceLocation, {}),
    count(Vehicle, { active: true }),
    count(SetPrice, {}),
    count(DriverNeededDocument, {}),
  ]);

  res.json({
    success: true,
    data: {
      attention: {
        active_sos: activeSos,
        pending_drivers: pendingDrivers,
        pending_withdrawals: pendingWithdrawals,
        negative_wallets: negativeWallets,
        open_tickets: openTickets,
        pending_vehicles: pendingVehicles,
        commercial_waiting: commercialWaiting,
        plans_expiring: plansExpiring,
        delete_requests: driverDeletes + userDeletes,
      },
      setup: { cities, vehicle_types: vehicleTypes, set_prices: setPrices, documents },
    },
  });
};

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /admin/insights/search?q=
 * Finds drivers, riders and a ride by its id from one box.
 */
export const globalSearchController = async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 3) throw new ApiError(400, 'Type at least 3 characters', null, 'QUERY_TOO_SHORT');

  const rx = new RegExp(escapeRegex(q), 'i');
  const digits = q.replace(/\D/g, '');
  const phoneRx = digits.length >= 3 ? new RegExp(escapeRegex(digits)) : null;

  const [drivers, users, ride] = await Promise.all([
    Driver.find({
      deletedAt: null,
      $or: [{ name: rx }, ...(phoneRx ? [{ phone: phoneRx }] : []), { referralCode: rx }, { vehicleNumber: rx }],
    })
      .select('name phone vehicleNumber driver_category approve status')
      .limit(6)
      .lean(),
    User.find({
      deletedAt: null,
      $or: [{ name: rx }, ...(phoneRx ? [{ phone: phoneRx }] : [])],
    })
      .select('name phone')
      .limit(6)
      .lean(),
    mongoose.isValidObjectId(q) && q.length === 24
      ? Ride.findById(q).select('status pickupAddress dropAddress fare createdAt').lean()
      : null,
  ]);

  res.json({
    success: true,
    data: {
      drivers: drivers.map((d) => ({
        id: String(d._id),
        name: d.name,
        phone: d.phone,
        vehicle: d.vehicleNumber || '',
        plan: d.driver_category || '',
        approved: d.approve !== false,
      })),
      users: users.map((u) => ({ id: String(u._id), name: u.name, phone: u.phone })),
      ride: ride
        ? {
            id: String(ride._id),
            status: ride.status,
            from: ride.pickupAddress || '',
            to: ride.dropAddress || '',
            fare: ride.fare || 0,
          }
        : null,
    },
  });
};
