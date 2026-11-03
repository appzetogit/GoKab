import mongoose from 'mongoose';

const placeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  { _id: false },
);

/**
 * A rental offer a driver publishes to users. The driver sets the rental
 * price; the fee is what the driver pays GoKab to keep it live for
 * `covered_hours` (see offerService.computeOfferFee).
 */
const driverOfferSchema = new mongoose.Schema(
  {
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true, index: true },
    company: { type: String, required: true, trim: true, maxlength: 80 },
    from: { type: placeSchema, required: true },
    to: { type: placeSchema, required: true },
    stops: { type: [placeSchema], default: [] },
    location_type: { type: String, enum: ['fixed', 'additional'], default: 'fixed' },
    duration_type: { type: String, enum: ['h2', 'h4', 'h8', 'h16', 'day1', 'day2', 'custom'], required: true },
    custom_hours: { type: Number, default: null },
    offer_price: { type: Number, required: true, min: 1 },
    regular_price: { type: Number, default: null },
    car_types: { type: [String], default: [] },
    individual_prices: { type: Map, of: Number, default: {} },
    valid_from: { type: Date, required: true },
    valid_to: { type: Date, required: true },
    banner_url: { type: String, default: '' },

    // What the driver bought: the slab breakdown and the hours it covers.
    requested_hours: { type: Number, required: true },
    covered_hours: { type: Number, required: true },
    fee_amount: { type: Number, required: true },
    fee_breakdown: { type: [mongoose.Schema.Types.Mixed], default: [] },

    status: {
      type: String,
      enum: ['pending_payment', 'active', 'expired', 'deactivated'],
      default: 'pending_payment',
      index: true,
    },
    live_from: { type: Date, default: null },
    live_until: { type: Date, default: null, index: true },

    razorpay_order_id: { type: String, default: '', index: true },
    razorpay_payment_id: { type: String, default: '' },
    razorpay_signature: { type: String, default: '' },
    paid_at: { type: Date, default: null },
    deactivated_by: { type: String, enum: ['', 'driver', 'admin'], default: '' },
  },
  { timestamps: true },
);

driverOfferSchema.index({ status: 1, live_until: 1 });

export const DriverOffer = mongoose.models.TaxiDriverOffer || mongoose.model('TaxiDriverOffer', driverOfferSchema);
