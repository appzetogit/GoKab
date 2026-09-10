import mongoose from 'mongoose';

const advertisementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    type: {
      type: String,
      enum: ['FULL', 'CAROUSEL'],
      required: true,
      index: true,
    },
    position: {
      type: String,
      enum: ['HOME_TOP', 'HOME_BOTTOM'],
      required: true,
      index: true,
    },
    mediaType: {
      type: String,
      enum: ['IMAGE', 'VIDEO', 'GIF'],
      required: true,
    },
    media: {
      url: {
        type: String,
        required: true,
      },
      filename: {
        type: String,
        required: true,
      },
      storage: {
        type: String,
        default: 'LOCAL',
      },
      mimeType: {
        type: String,
        required: true,
      },
      size: {
        type: Number,
        required: true,
      },
    },
    thumbnailUrl: {
      type: String,
      default: '',
      trim: true,
    },
    actionType: {
      type: String,
      enum: ['NONE', 'URL', 'SCREEN'],
      default: 'NONE',
    },
    actionValue: {
      type: String,
      default: '',
      trim: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
      index: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

advertisementSchema.index({ status: 1, type: 1, displayOrder: 1, createdAt: -1 });

export const Advertisement = mongoose.models.TaxiAdvertisement || mongoose.model('TaxiAdvertisement', advertisementSchema);
export default Advertisement;
