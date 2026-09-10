import mongoose from 'mongoose';

const userReferralRedemptionRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiUser',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    referenceKey: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    adminNote: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true },
);

userReferralRedemptionRequestSchema.index({ userId: 1, createdAt: -1 });
userReferralRedemptionRequestSchema.index({ status: 1, createdAt: -1 });

export const UserReferralRedemptionRequest =
  mongoose.models.UserReferralRedemptionRequest ||
  mongoose.model('UserReferralRedemptionRequest', userReferralRedemptionRequestSchema);
