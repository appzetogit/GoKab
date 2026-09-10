import mongoose from 'mongoose';

const driverLoginSessionSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
    },
    accountRole: {
      type: String,
      enum: ['driver', 'owner', 'vendor', 'super_fleet_owner', 'bus_driver', 'service_center', 'service_center_staff', 'pooling_driver'],
      default: 'driver',
      required: true,
    },
    otpHash: {
      type: String,
      required: true,
      select: false,
    },
    otpExpiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    lastOtpSentAt: {
      type: Date,
      default: null,
    },
    otpSendCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    otpAttemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

driverLoginSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DriverLoginSession =
  mongoose.models.TaxiDriverLoginSession ||
  mongoose.model('TaxiDriverLoginSession', driverLoginSessionSchema);
