import mongoose from 'mongoose';

const accountTypeAuditLogSchema = new mongoose.Schema(
  {
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true, index: true },
    old_account_type: { type: String, required: true },
    new_account_type: { type: String, required: true },
    reason: {
      type: String,
      enum: ['grace_period_reconciliation', 'instant_vehicle_promotion', 'admin_manual_override', 'migration_script', 'user_upgrade'],
      required: true,
    },
    actual_vehicle_count: { type: Number, default: 0 },
    performed_by: { type: String, default: 'system' }, // 'system', 'admin', 'migration', 'driver'
    details: { type: String, default: '' },
  },
  { timestamps: true }
);

export const AccountTypeAuditLog =
  mongoose.models.TaxiAccountTypeAuditLog || mongoose.model('TaxiAccountTypeAuditLog', accountTypeAuditLogSchema);
