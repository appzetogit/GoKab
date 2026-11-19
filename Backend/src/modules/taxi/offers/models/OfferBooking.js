import mongoose from 'mongoose';

/** A user's request to book a driver's offer; the driver accepts or declines. */
const offerBookingSchema = new mongoose.Schema(
  {
    offer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriverOffer', required: true, index: true },
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true, index: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiUser', required: true, index: true },
    user_name: { type: String, default: '' },
    user_phone: { type: String, default: '' },
    car_type: { type: String, default: '' },
    // Price at the time of booking (the driver's offer or per-car price).
    price: { type: Number, required: true },
    pickup_at: { type: Date, required: true },
    passengers: { type: Number, default: 1, min: 1, max: 50 },
    note: { type: String, default: '', maxlength: 300 },
    status: { type: String, enum: ['requested', 'accepted', 'rejected', 'cancelled'], default: 'requested', index: true },
    responded_at: { type: Date, default: null },
  },
  { timestamps: true },
);

export const OfferBooking = mongoose.models.TaxiOfferBooking || mongoose.model('TaxiOfferBooking', offerBookingSchema);
