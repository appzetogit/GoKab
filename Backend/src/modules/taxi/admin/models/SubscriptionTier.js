import mongoose from 'mongoose';

const subscriptionTierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    is_default: { type: Boolean, default: false, index: true },
    display_order: { type: Number, default: 0 },
    priority_score: { type: Number, default: 0, index: true },
    price_monthly: { type: Number, default: 0, min: 0 },
    price_yearly: { type: Number, default: 0, min: 0 },
    commission_percent: { type: Number, default: 15, min: 0, max: 100 },
    search_radius_multiplier: { type: Number, default: 1.0, min: 0.1 },
    max_cash_debt_allowed: { type: Number, default: 0, min: 0 }, // e.g. 1000 means wallet can drop down to -1000
    free_cancellations_per_day: { type: Number, default: 0, min: 0 },
    cancellation_penalty_waived: { type: Boolean, default: false },
    support_channel_type_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiSupportChannelType', default: null },
    ride_module_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRideModule' }],
    map_icon_asset_url: { type: String, default: '' },
    badge_color_hex: { type: String, default: '#10B981' },
    is_active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const SubscriptionTier =
  mongoose.models.TaxiSubscriptionTier || mongoose.model('TaxiSubscriptionTier', subscriptionTierSchema);
