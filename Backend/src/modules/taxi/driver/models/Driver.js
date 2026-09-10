import mongoose from 'mongoose';
import { VEHICLE_TYPES } from '../../constants/index.js';

const geoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
      default: [0, 0],
    },
  },
  { _id: false },
);

const driverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      default: '',
      trim: true,
    },
    salary: {
      type: Number,
      default: 0,
      min: 0,
    },
    fcmTokenWeb: {
      type: String,
      default: '',
      trim: true,
    },
    fcmTokenMobile: {
      type: String,
      default: '',
      trim: true,
    },
    owner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiOwner',
      default: null,
      index: true,
    },
    is_self_drive_owner: {
      type: Boolean,
      default: false,
    },
    service_location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiServiceLocation',
      default: null,
      index: true,
    },
    country: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    profile_picture: {
      type: mongoose.Schema.Types.Mixed,
      default: '',
      get(val) {
        if (val && typeof val === 'object' && val.url) return val.url;
        return val;
      },
    },
    profileImage: {
      type: mongoose.Schema.Types.Mixed,
      default: '',
      get(val) {
        if (val && typeof val === 'object' && val.url) return val.url;
        return val;
      },
    },
    gender: {
      type: String,
      default: '',
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    onlineSelfie: {
      imageUrl: {
        type: String,
        default: '',
        trim: true,
      },
      capturedAt: {
        type: Date,
        default: null,
      },
      uploadedAt: {
        type: Date,
        default: null,
      },
      forDate: {
        type: String,
        default: '',
        trim: true,
      },
    },
    isOnRide: {
      type: Boolean,
      default: false,
    },
    socketId: {
      type: String,
      default: null,
    },
    vehicleType: {
      type: String,
      enum: VEHICLE_TYPES,
      required: true,
    },
    vehicleTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiVehicle',
      default: null,
    },
    vehicleIconType: {
      type: String,
      default: 'car',
      trim: true,
    },
    vehicleMake: {
      type: String,
      default: '',
      trim: true,
    },
    vehicleModel: {
      type: String,
      default: '',
      trim: true,
    },
    registerFor: {
      type: String,
      default: 'taxi',
      trim: true,
    },
    account_type: {
      type: String,
      enum: ['individual', 'vendor', 'super_fleet_owner'],
      default: 'individual',
      index: true,
    },
    account_type_created_at: {
      type: Date,
      default: Date.now,
    },
    grace_period_ends_at: {
      type: Date,
      default: null,
      index: true,
    },
    pooling_enabled: {
      type: Boolean,
      default: false,
    },
    delivery_enabled: {
      type: Boolean,
      default: false,
    },
    serviceCategories: {
      type: [String],
      default: [],
    },
    vehicleNumber: {
      type: String,
      default: '',
      trim: true,
    },
    vehicleColor: {
      type: String,
      default: '',
      trim: true,
    },
    vehicleImage: {
      type: mongoose.Schema.Types.Mixed,
      default: '',
      get(val) {
        if (val && typeof val === 'object' && val.url) return val.url;
        return val;
      },
    },
    city: {
      type: String,
      default: '',
      trim: true,
    },
    referralCode: {
      type: String,
      default: '',
      trim: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      default: null,
      index: true,
    },
    referralCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    referredRideCompletionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    referralRewardGrantedAt: {
      type: Date,
      default: null,
    },
    approve: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      default: 'approved',
      trim: true,
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalRatingScore: {
      type: Number,
      default: 0,
      min: 0,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    deletion_reason: {
      type: String,
      default: '',
      trim: true,
    },
    deletionRequest: {
      status: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none',
        index: true,
      },
      reason: {
        type: String,
        default: '',
        trim: true,
      },
      requestedAt: {
        type: Date,
        default: null,
      },
      reviewedAt: {
        type: Date,
        default: null,
      },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        default: null,
      },
      adminNote: {
        type: String,
        default: '',
        trim: true,
      },
    },
    wallet: {
      balance: {
        type: Number,
        default: 0,
      },
      cashLimit: {
        type: Number,
        default: 500,
        min: 0,
      },
      isBlocked: {
        type: Boolean,
        default: false,
      },
    },
    bankDetails: {
      accountHolderName: {
        type: String,
        default: '',
        trim: true,
      },
      upiId: {
        type: String,
        default: '',
        trim: true,
      },
      qrCodeImage: {
        type: String,
        default: '',
        trim: true,
      },
      accountNumber: {
        type: String,
        default: '',
        trim: true,
      },
      ifsc: {
        type: String,
        default: '',
        trim: true,
        uppercase: true,
      },
      branchName: {
        type: String,
        default: '',
        trim: true,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
    zoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiZone',
      default: null,
    },
    assignedFleetVehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiFleetVehicle',
      default: null,
      index: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
        default: [0, 0],
      },
    },
    routeBooking: {
      enabled: {
        type: Boolean,
        default: false,
      },
      anchorLocation: {
        type: geoPointSchema,
        default: null,
      },
      label: {
        type: String,
        default: '',
        trim: true,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
    documents: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    emergencyContacts: {
      type: [
        {
          name: {
            type: String,
            required: true,
            trim: true,
          },
          phone: {
            type: String,
            required: true,
            trim: true,
          },
          source: {
            type: String,
            enum: ['manual', 'device'],
            default: 'manual',
          },
        },
      ],
      default: [],
    },
    onboarding: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    incentiveTracking: {
      currentOnlineStartedAt: {
        type: Date,
        default: null,
      },
      dailyActivity: {
        type: [
          {
            date: { type: String, required: true },
            activeMinutes: { type: Number, default: 0 },
          },
        ],
        default: [],
      },
      claimedRewards: {
        type: [
          {
            rewardType: { type: String, default: '' },
            rewardKey: { type: String, default: '' },
            periodKey: { type: String, default: '' },
            amount: { type: Number, default: 0 },
            claimedAt: { type: Date, default: Date.now },
            metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
          },
        ],
        default: [],
      },
    },
    todaySummary: {
      dateKey: {
        type: String,
        default: '',
        trim: true,
      },
      rides: {
        type: Number,
        default: 0,
      },
      earnings: {
        type: Number,
        default: 0,
      },
      distanceMeters: {
        type: Number,
        default: 0,
      },
      activeMinutes: {
        type: Number,
        default: 0,
      },
      activeSeconds: {
        type: Number,
        default: 0,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
  },
  { 
    timestamps: true,
    toJSON: { getters: true },
    toObject: { getters: true },
  },
);

driverSchema.index({ 'deletionRequest.status': 1, deletedAt: 1 });
driverSchema.index({ deletedAt: 1, createdAt: -1 });
driverSchema.index({ approve: 1, deletedAt: 1, createdAt: -1 });
driverSchema.index({ status: 1, deletedAt: 1 });
driverSchema.index({ phone: 1, deletedAt: 1 });
driverSchema.index({ owner_id: 1, assignedFleetVehicleId: 1 });

driverSchema.index({ location: '2dsphere' });
driverSchema.index({ 'routeBooking.anchorLocation': '2dsphere' });

export const Driver = mongoose.models.TaxiDriver || mongoose.model('TaxiDriver', driverSchema);

