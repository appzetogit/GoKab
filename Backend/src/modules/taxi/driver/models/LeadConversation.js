import mongoose from 'mongoose';

const participantSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['driver', 'user'], required: true },
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    last_read_at: { type: Date, default: null },
  },
  { _id: false },
);

/**
 * A pre-acceptance conversation about one lead. Separate from `Ride.messages`,
 * which only exists between the rider and the driver who actually won the ride.
 *
 * Closed once the ride is taken, expired or unpublished, so losing bidders stop
 * messaging a lead that no longer exists.
 */
const leadConversationSchema = new mongoose.Schema(
  {
    ride_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiRide',
      required: true,
      index: true,
    },
    participants: { type: [participantSchema], default: [] },
    last_message: { type: String, default: '' },
    last_message_at: { type: Date, default: null, index: true },
    closed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

leadConversationSchema.index({ ride_id: 1, 'participants.id': 1 });

export const LeadConversation =
  mongoose.models.TaxiLeadConversation ||
  mongoose.model('TaxiLeadConversation', leadConversationSchema);
