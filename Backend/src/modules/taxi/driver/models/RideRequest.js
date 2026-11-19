import mongoose from 'mongoose';

/**
 * A driver asking the publisher for a published ride. Nobody gets the ride
 * until the publisher approves one request (see rideRequestService).
 *
 * Kept as its own collection rather than an array on the ride: applicant
 * phone numbers stay out of every endpoint that returns the whole ride, the
 * per-driver rate limit and "rides I applied to" are plain indexed queries,
 * and the unique index makes "one request per driver per publish" atomic.
 *
 * `published_at` is the ride's `publish.published_at` when the request was
 * made, so requests from an earlier publish never count against a republish.
 */
const vehicleSnapshotSchema = new mongoose.Schema(
  {
    number: { type: String, default: '' },
    model: { type: String, default: '' },
    type: { type: String, default: '' },
  },
  { _id: false },
);

const rideRequestSchema = new mongoose.Schema(
  {
    ride_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRide', required: true },
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true },
    publisher_driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true },
    published_at: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'withdrawn'],
      default: 'pending',
    },
    // Why it was rejected: publisher_rejected | ride_taken | ride_expired |
    // ride_cancelled | insufficient_wallet | driver_unavailable.
    reason: { type: String, default: '' },
    reason_text: { type: String, trim: true, maxlength: 200, default: '' },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    requested_at: { type: Date, default: Date.now },
    reviewed_at: { type: Date, default: null },
    // Taken when the request is made so the publisher sees stable data and the
    // ride can be stamped with the applicant's vehicle on approval.
    snapshot: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      avatar: { type: String, default: '' },
      rating: { type: Number, default: null },
      trips: { type: Number, default: 0 },
      vehicle: { type: vehicleSnapshotSchema, default: () => ({}) },
    },
  },
  { timestamps: true },
);

rideRequestSchema.index({ ride_id: 1, driver_id: 1, published_at: 1 }, { unique: true });
rideRequestSchema.index({ ride_id: 1, published_at: 1, status: 1, requested_at: 1 });
rideRequestSchema.index({ driver_id: 1, requested_at: -1 });
rideRequestSchema.index({ driver_id: 1, status: 1 });

export const RideRequest =
  mongoose.models.TaxiRideRequest || mongoose.model('TaxiRideRequest', rideRequestSchema);
