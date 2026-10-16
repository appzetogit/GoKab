import mongoose from 'mongoose';

/**
 * A driver another driver has chosen to keep, so rides can be assigned to them
 * directly without publishing to the whole network.
 *
 * Only drivers who have actually shared a ride can be saved (`source_ride_id`
 * records which one). Rows survive a downgrade to a tier without
 * `can_use_contacts`: the list is shown as locked, not deleted.
 */
const savedContactSchema = new mongoose.Schema(
  {
    owner_driver_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
    },
    contact_driver_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
    },
    source_ride_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiRide',
      default: null,
    },
    nickname: {
      type: String,
      default: '',
      trim: true,
      maxlength: 60,
    },
  },
  { timestamps: true },
);

savedContactSchema.index({ owner_driver_id: 1, contact_driver_id: 1 }, { unique: true });
savedContactSchema.index({ owner_driver_id: 1, createdAt: -1 });

export const SavedContact =
  mongoose.models.TaxiSavedContact || mongoose.model('TaxiSavedContact', savedContactSchema);
