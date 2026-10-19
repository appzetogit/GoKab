import mongoose from 'mongoose';

const fleetVehicleSchema = new mongoose.Schema(
  {
    owner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiOwner',
      required: true,
      index: true,
    },
    service_location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiServiceLocation',
      required: true,
      index: true,
    },
    transport_type: {
      type: String,
      default: 'taxi',
      trim: true,
      index: true,
    },
    vehicle_type_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiVehicle',
      default: null,
      index: true,
    },
    car_brand: {
      type: String,
      required: true,
      trim: true,
    },
    car_model: {
      type: String,
      required: true,
      trim: true,
    },
    license_plate_number: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    car_color: {
      type: String,
      required: true,
      trim: true,
    },
    // Optional details the owner enters for the My Vehicles screen.
    fuel_type: {
      type: String,
      enum: ['petrol', 'diesel', 'cng', 'electric', 'hybrid', 'lpg', ''],
      default: '',
    },
    model_year: {
      type: Number,
      default: null,
    },
    // Typed by the owner. A fitness document with an expiry date, when the
    // admin has a template for one, takes precedence (see serializer).
    fitness_valid_till: {
      type: Date,
      default: null,
    },
    // Commercial (yellow plate / permit) vs private. Prime and Middle drivers
    // must hold at least one of each, so this drives category eligibility.
    usage_type: {
      type: String,
      enum: ['commercial', 'private'],
      default: 'private',
      required: true,
      index: true,
    },
    // Set by admin once the commercial permit document has actually been seen.
    usage_type_verified: {
      type: Boolean,
      default: false,
    },
    documents: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // { [documentKey]: <the expiresAt value a reminder was already sent for> }.
    // Keyed by the expiry itself, so renewing a document (a new expiry date)
    // re-arms its reminder instead of staying silenced forever.
    document_expiry_notified: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      trim: true,
      index: true,
    },
    reason: {
      type: String,
      default: '',
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

fleetVehicleSchema.index({ owner_id: 1, license_plate_number: 1 }, { unique: true });

export const FleetVehicle =
  mongoose.models.TaxiFleetVehicle || mongoose.model('TaxiFleetVehicle', fleetVehicleSchema);

