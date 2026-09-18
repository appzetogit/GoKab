import mongoose from 'mongoose';

const stopSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
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
      },
    },
  },
  { _id: false },
);

/**
 * A corridor a driver is willing to work: an ordered list of stops plus the
 * polyline between them. While a route is the driver's active one they only
 * receive rides whose pickup *and* drop fall inside `corridor_km` of that line
 * (and, unless `bidirectional`, only in the stop order given).
 *
 * This is deliberately separate from `PoolingRoute`: those are admin-defined
 * seat-sharing services with fares and schedules, whereas this is only a
 * matching filter owned by one driver.
 */
const driverRouteSchema = new mongoose.Schema(
  {
    driver_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    stops: {
      type: [stopSchema],
      validate: {
        validator: (value) => Array.isArray(value) && value.length >= 2 && value.length <= 10,
        message: 'A route needs between 2 and 10 stops',
      },
    },
    path: {
      type: {
        type: String,
        enum: ['LineString'],
        default: 'LineString',
      },
      coordinates: {
        type: [[Number]],
        required: true,
      },
    },
    path_source: {
      type: String,
      enum: ['google', 'straight'],
      default: 'straight',
    },
    distance_meters: {
      type: Number,
      default: 0,
    },
    corridor_km: {
      type: Number,
      default: 10,
      min: 1,
      max: 50,
    },
    bidirectional: {
      type: Boolean,
      default: false,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

driverRouteSchema.index({ path: '2dsphere' });
driverRouteSchema.index({ driver_id: 1, deletedAt: 1 });

export const DriverRoute =
  mongoose.models.TaxiDriverRoute || mongoose.model('TaxiDriverRoute', driverRouteSchema);
