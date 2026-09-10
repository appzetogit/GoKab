import mongoose from 'mongoose';

const supportChannelTypeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const SupportChannelType =
  mongoose.models.TaxiSupportChannelType || mongoose.model('TaxiSupportChannelType', supportChannelTypeSchema);
