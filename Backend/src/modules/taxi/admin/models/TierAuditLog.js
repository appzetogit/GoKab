import mongoose from 'mongoose';

const tierAuditLogSchema = new mongoose.Schema(
  {
    admin_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiAdmin', default: null },
    admin_email: { type: String, default: '' },
    tier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiSubscriptionTier', default: null },
    action: { type: String, required: true }, // 'create', 'update', 'delete', 'set_default'
    changes: [
      {
        field: String,
        old_value: mongoose.Schema.Types.Mixed,
        new_value: mongoose.Schema.Types.Mixed,
      },
    ],
    ip_address: { type: String, default: '' },
  },
  { timestamps: true }
);

export const TierAuditLog =
  mongoose.models.TaxiTierAuditLog || mongoose.model('TaxiTierAuditLog', tierAuditLogSchema);
