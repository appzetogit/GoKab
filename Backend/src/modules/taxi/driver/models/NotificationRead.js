import mongoose from 'mongoose';

/**
 * Per-account read state for admin broadcast notifications.
 *
 * A `TaxiNotification` is one document shared by every driver in its audience,
 * so "read" cannot live on it. One row here means that account has read that
 * notification; no row means unread.
 */
const notificationReadSchema = new mongoose.Schema(
  {
    account_role: {
      type: String,
      enum: ['driver', 'owner'],
      required: true,
    },
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    notification_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiNotification',
      required: true,
    },
    read_at: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false },
);

notificationReadSchema.index({ account_role: 1, account_id: 1, notification_id: 1 }, { unique: true });

export const NotificationRead =
  mongoose.models.TaxiNotificationRead ||
  mongoose.model('TaxiNotificationRead', notificationReadSchema);
