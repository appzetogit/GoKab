import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const VEHICLE_ICON_TYPES = [
  'car',
  'bike',
  'auto',
  'truck',
  'ehcb',
  'HCV',
  'LCV',
  'MCV',
  'Luxary',
  'premium',
  'suv',
];

const vehicleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    short_description: {
      type: String,
      default: '',
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    transport_type: {
      type: String,
      enum: ['taxi', 'delivery', 'pooling', 'both'],
      required: true,
      trim: true,
    },
    dispatch_type: {
      type: String,
      enum: ['normal', 'bidding', 'both'],
      default: 'normal',
      trim: true,
    },
    icon_types: {
      type: String,
      enum: VEHICLE_ICON_TYPES,
      default: 'car',
      trim: true,
    },
    capacity: {
      type: Number,
      default: 0,
    },
    size: {
      type: String,
      default: '',
    },
    is_taxi: {
      type: String,
      enum: ['taxi', 'delivery', 'pooling', 'both'],
      default: 'taxi',
    },
    is_accept_share_ride: {
      type: Number,
      enum: [0, 1],
      default: 0,
    },
    image: {
      type: String,
      default: '',
      trim: true,
    },
    icon: {
      type: String,
      default: '',
      trim: true,
    },
    map_icon: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: Number,
      enum: [0, 1],
      default: 1,
    },
    active: {
      type: Boolean,
      default: true,
    },
    airport: {
      type: Boolean,
      default: false,
    },
    supported_other_vehicle_types: {
      type: [ObjectId],
      ref: 'TaxiVehicle',
      default: [],
    },
    vehicle_preference: {
      type: [ObjectId],
      ref: 'TaxiPreference',
      default: [],
    },
  },
  { timestamps: true },
);

vehicleSchema.pre('save', function syncActiveStatus() {
  if (this.isModified('status')) {
    this.active = this.status === 1;
  } else if (this.isModified('active')) {
    this.status = this.active ? 1 : 0;
  }
});

vehicleSchema.index({ name: 1 });
vehicleSchema.index({ transport_type: 1, status: 1 });

export const Vehicle = mongoose.models.TaxiVehicle || mongoose.model('TaxiVehicle', vehicleSchema);
