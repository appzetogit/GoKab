import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [] },
  },
  { _id: false },
);

/**
 * A rider's advertised future trip ("Indore to Bhopal, Friday 6 am"). Not a Ride:
 * it is never dispatched, only shown to drivers, who pay the lead-contact fee to
 * reach the rider. Open until `scheduledAt`, then it expires on its own.
 */
const tripPostSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiUser', required: true, index: true },
    pickupAddress: { type: String, required: true, trim: true },
    dropAddress: { type: String, required: true, trim: true },
    pickupLocation: { type: pointSchema, default: undefined },
    dropLocation: { type: pointSchema, default: undefined },
    scheduledAt: { type: Date, required: true },
    vehicleTypeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    passengers: { type: Number, default: 1, min: 1, max: 20 },
    budget: { type: Number, default: 0, min: 0 },
    note: { type: String, default: '', trim: true, maxlength: 300 },
    status: { type: String, enum: ['open', 'closed', 'expired'], default: 'open' },
    closed_at: { type: Date, default: null },
  },
  { timestamps: true },
);

tripPostSchema.index({ status: 1, scheduledAt: 1 });

export const TripPost = mongoose.models.TaxiTripPost || mongoose.model('TaxiTripPost', tripPostSchema);
