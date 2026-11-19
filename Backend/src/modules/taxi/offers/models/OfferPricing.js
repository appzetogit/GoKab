import mongoose from 'mongoose';

/**
 * What the admin charges a driver to keep an offer on the user app. One
 * document; a rate of 0 means that slab is not offered.
 */
const offerPricingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    hour_rate: { type: Number, default: 0, min: 0 },
    day_rate: { type: Number, default: 0, min: 0 },
    week_rate: { type: Number, default: 0, min: 0 },
    month_rate: { type: Number, default: 0, min: 0 },
    max_live_hours: { type: Number, default: 2160, min: 1 },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const OfferPricing = mongoose.models.TaxiOfferPricing || mongoose.model('TaxiOfferPricing', offerPricingSchema);
