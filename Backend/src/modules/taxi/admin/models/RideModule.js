import mongoose from 'mongoose';

const rideModuleSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    display_name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    is_active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const RideModule =
  mongoose.models.TaxiRideModule || mongoose.model('TaxiRideModule', rideModuleSchema);
