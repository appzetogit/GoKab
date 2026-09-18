import mongoose from 'mongoose';

const walletTransactionSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
      index: true,
    },
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiRide',
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'ride_earning',
        'commission_deduction',
        'top_up',
        'adjustment',
        // Driver network. `escrow_hold`/`escrow_release` move only frozen money
        // (amount 0, balance unchanged); the `escrow_transfer_*` pair is the
        // one that actually moves balance between publisher and acceptor.
        'escrow_hold',
        'escrow_release',
        'escrow_transfer_in',
        'escrow_transfer_out',
        'lead_contact_fee',
        'feed_accept_fee',
      ],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    cashLimit: {
      type: Number,
      required: true,
    },
    isBlockedAfter: {
      type: Boolean,
      required: true,
    },
    frozenBefore: {
      type: Number,
      default: 0,
    },
    frozenAfter: {
      type: Number,
      default: 0,
    },
    // Where an escrow credit came from. A driver-to-driver settlement has a
    // matching debit somewhere; a 'platform' one does not, because the customer
    // paid the app. Reports that try to balance the ledger need to tell them
    // apart.
    settlementSource: {
      type: String,
      enum: ['driver', 'platform', null],
      default: null,
    },
    // The other driver in a publisher↔acceptor escrow movement.
    counterpartyDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      default: null,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

walletTransactionSchema.index({ driverId: 1, createdAt: -1 });

export const WalletTransaction =
  mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', walletTransactionSchema);
