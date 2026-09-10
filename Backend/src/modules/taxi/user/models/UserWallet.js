import mongoose from 'mongoose';

const walletTransactionSchema = new mongoose.Schema(
  {
    walletType: {
      type: String,
      enum: ['main', 'refund', 'referral'],
      default: 'main',
      index: true,
    },
    kind: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    title: {
      type: String,
      default: '',
      trim: true,
    },
    counterpartyPhone: {
      type: String,
      default: '',
      trim: true,
    },
    provider: {
      type: String,
      default: '',
      trim: true,
    },
    providerOrderId: {
      type: String,
      default: '',
      trim: true,
    },
    providerPaymentId: {
      type: String,
      default: '',
      trim: true,
    },
    referenceKey: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['completed', 'pending', 'rejected'],
      default: 'completed',
    },
  },
  { _id: true, timestamps: true },
);

// A fee the rider owes but could not pay at the time it was charged, because
// `balance` is deliberately non-negative. Kept until the wallet can cover it,
// so the charge is never silently dropped and the driver still gets paid once
// it clears.
const walletDueSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      default: 'ride_cancellation_fee',
      trim: true,
    },
    title: {
      type: String,
      default: '',
      trim: true,
    },
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiRide',
      default: null,
    },
    // Set when the collected fee is owed onward to a driver rather than the platform.
    payeeDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      default: null,
    },
    referenceKey: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: true, timestamps: true },
);

const userWalletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiUser',
      required: true,
    },
    outstandingDues: {
      type: [walletDueSchema],
      default: [],
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
    refundWallet: {
      type: Number,
      default: 0,
      min: 0,
    },
    referralWallet: {
      type: Number,
      default: 0,
      min: 0,
    },
    lockedReferralAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    transactions: {
      type: [walletTransactionSchema],
      default: [],
    },
  },
  { timestamps: true },
);

userWalletSchema.index({ userId: 1 }, { unique: true });

export const UserWallet = mongoose.models.TaxiUserWallet || mongoose.model('TaxiUserWallet', userWalletSchema);
