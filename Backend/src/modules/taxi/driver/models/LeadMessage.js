import mongoose from 'mongoose';

const leadMessageSchema = new mongoose.Schema(
  {
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiLeadConversation',
      required: true,
      index: true,
    },
    sender_role: { type: String, enum: ['driver', 'user'], required: true },
    sender_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

leadMessageSchema.index({ conversation_id: 1, createdAt: -1 });

export const LeadMessage =
  mongoose.models.TaxiLeadMessage || mongoose.model('TaxiLeadMessage', leadMessageSchema);
