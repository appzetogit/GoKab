import mongoose from 'mongoose';

/**
 * One row per (ride, interested driver).
 *
 * The unique index is the charging rule: a driver pays the contact fee once per
 * ride, after which both chat and call are unlocked for that lead. Without it a
 * driver would be billed again every time they reopened the conversation.
 */
const leadContactSchema = new mongoose.Schema(
  {
    ride_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiRide',
      required: true,
    },
    requester_driver_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
    },
    lead_type: {
      type: String,
      enum: ['driver', 'customer'],
      required: true,
    },
    target_role: {
      type: String,
      enum: ['driver', 'user', 'offline_customer'],
      required: true,
    },
    target_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    channels_used: [{ type: String, enum: ['chat', 'call'] }],
    fee_charged: { type: Number, default: 0 },
    wallet_txn_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiLeadConversation',
      default: null,
    },
  },
  { timestamps: true },
);

leadContactSchema.index({ ride_id: 1, requester_driver_id: 1 }, { unique: true });
leadContactSchema.index({ requester_driver_id: 1, createdAt: -1 });

export const LeadContact =
  mongoose.models.TaxiLeadContact || mongoose.model('TaxiLeadContact', leadContactSchema);
