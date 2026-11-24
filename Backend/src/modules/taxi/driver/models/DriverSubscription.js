import mongoose from 'mongoose';
import { SubscriptionTier } from '../../admin/models/SubscriptionTier.js';
import { captureBenefits } from '../../services/planBenefits.js';

const driverSubscriptionSchema = new mongoose.Schema(
  {
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true, index: true },
    tier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiSubscriptionTier', required: true },
    billing_cycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true, index: true },
    status: {
      type: String,
      // `pending_refund`: paid for, but the thing it bought is no longer
      // available (a Prime seat taken while the payment was in flight).
      enum: ['active', 'expired', 'cancelled', 'pending_payment', 'pending_refund'],
      default: 'active',
      index: true,
    },
    queued_tier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiSubscriptionTier', default: null },
    queued_billing_cycle: { type: String, enum: ['monthly', 'yearly', null], default: null },
    suppress_renewal_reminders: { type: Boolean, default: false },
    // Which expiry reminder (in days before end_date) has already gone out,
    // so a cron running every few minutes does not resend it each pass.
    renewal_reminder_sent_for: { type: Number, default: null },
    // The plan's benefits on the day it was bought (planBenefits.js). Missing on
    // older subscriptions, which simply follow the plan as it is now.
    benefits_snapshot: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Here rather than at each place that creates a subscription, so none is missed.
driverSubscriptionSchema.pre('save', async function captureBoughtBenefits() {
  if (!this.isNew || this.benefits_snapshot) return;
  try {
    const tier = await SubscriptionTier.findById(this.tier_id).session(this.$session()).lean();
    if (tier) this.benefits_snapshot = captureBenefits(tier);
  } catch (error) {
    // Without a snapshot the driver follows the live plan; a paid purchase must not fail over it.
    console.error('[DriverSubscription] benefits snapshot failed:', error.message);
  }
});

export const DriverSubscription =
  mongoose.models.TaxiDriverSubscription || mongoose.model('TaxiDriverSubscription', driverSubscriptionSchema);
