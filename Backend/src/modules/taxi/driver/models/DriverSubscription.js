import mongoose from 'mongoose';

const driverSubscriptionSchema = new mongoose.Schema(
  {
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true, index: true },
    tier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiSubscriptionTier', required: true },
    billing_cycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled', 'pending_payment'],
      default: 'active',
      index: true,
    },
    queued_tier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiSubscriptionTier', default: null },
    queued_billing_cycle: { type: String, enum: ['monthly', 'yearly', null], default: null },
    suppress_renewal_reminders: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const DriverSubscription =
  mongoose.models.TaxiDriverSubscription || mongoose.model('TaxiDriverSubscription', driverSubscriptionSchema);
