import mongoose from 'mongoose';

/**
 * Riders who share one cab to the same airport or railway station. Every rider
 * keeps a Ride of their own (fare, OTP, payment, history); this ties them
 * together so one driver takes all of them.
 *
 * `searching`: the lead ride is on dispatch, nobody has the group yet.
 * `accepted`:  a driver took it; later riders join only if the driver agrees.
 */
const carpoolGroupSchema = new mongoose.Schema(
  {
    // The ride that goes to drivers; the others ride along with it.
    leadRideId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', required: true, index: true },
    rideIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null, index: true },
    vehicleTypeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    status: {
      type: String,
      enum: ['searching', 'accepted', 'completed', 'cancelled'],
      default: 'searching',
      index: true,
    },
    kind: { type: String, enum: ['airport', 'railway'], default: 'airport' },
    direction: { type: String, enum: ['to_station'], default: 'to_station' },
    stationName: { type: String, default: '' },
    // [lng, lat]
    stationCoordinates: { type: [Number], default: [] },
    // The lead's pickup, which later riders are matched against.
    pickupCoordinates: { type: [Number], default: [] },
    scheduledAt: { type: Date, default: null },
    // scheduledAt, or the booking time for a ride wanted now.
    effectiveAt: { type: Date, default: Date.now },
    seatsTotal: { type: Number, default: 4, min: 1 },
    seatsUsed: { type: Number, default: 1, min: 0 },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const CarpoolGroup =
  mongoose.models.CarpoolGroup || mongoose.model('CarpoolGroup', carpoolGroupSchema);
