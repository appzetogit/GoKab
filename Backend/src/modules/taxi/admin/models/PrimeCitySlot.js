import mongoose from 'mongoose';

/**
 * One row per Prime seat in a city.
 *
 * The cap ("max 5 Prime drivers per city") cannot be enforced by counting rows
 * and then inserting — two drivers paying at the same moment would both read
 * 4 and both insert. Instead each seat is a numbered row and the unique index
 * on (service_location_id, slot_no) makes the database the arbiter: claiming a
 * seat means winning an insert, and the loser gets a duplicate-key error and
 * tries the next number.
 *
 * A seat is `reserved` while the driver is paying and becomes `active` once the
 * subscription is live. Abandoned checkouts are swept by
 * `releaseStalePrimeReservations`, so an unpaid reservation cannot hold a seat
 * hostage beyond `reserved_until`.
 */
const primeCitySlotSchema = new mongoose.Schema(
  {
    service_location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiServiceLocation',
      required: true,
    },
    slot_no: {
      type: Number,
      required: true,
      min: 1,
    },
    driver_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
    },
    subscription_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriverSubscription',
      default: null,
    },
    status: {
      type: String,
      enum: ['reserved', 'active'],
      default: 'reserved',
    },
    reserved_until: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

primeCitySlotSchema.index({ service_location_id: 1, slot_no: 1 }, { unique: true });
primeCitySlotSchema.index({ driver_id: 1 }, { unique: true });
primeCitySlotSchema.index({ status: 1, reserved_until: 1 });

export const PrimeCitySlot =
  mongoose.models.TaxiPrimeCitySlot || mongoose.model('TaxiPrimeCitySlot', primeCitySlotSchema);
