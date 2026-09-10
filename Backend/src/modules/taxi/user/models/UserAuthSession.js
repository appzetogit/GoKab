import mongoose from 'mongoose';

const userAuthSessionSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
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
    otpVerifiedAt: {
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

userAuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UserAuthSession =
  mongoose.models.TaxiUserAuthSession ||
  mongoose.model('TaxiUserAuthSession', userAuthSessionSchema);
