import mongoose from 'mongoose';

const subscriptionPaymentSchema = new mongoose.Schema(
  {
    driver_subscription_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriverSubscription', default: null },
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true, index: true },
    tier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiSubscriptionTier', required: true },
    billing_cycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    prorated_credit_applied: { type: Number, default: 0 },
    razorpay_order_id: { type: String, required: true, index: true },
    razorpay_payment_id: { type: String, default: '', index: true },
    razorpay_signature: { type: String, default: '' },
    status: {
      type: String,
      // `refund_due`: captured, but the plan could not be granted.
      enum: ['created', 'paid', 'failed', 'refunded', 'refund_due'],
      default: 'created',
      index: true,
    },
    verified_at: { type: Date, default: null },
  },
  { timestamps: true }
);

export const SubscriptionPayment =
  mongoose.models.TaxiSubscriptionPayment || mongoose.model('TaxiSubscriptionPayment', subscriptionPaymentSchema);
