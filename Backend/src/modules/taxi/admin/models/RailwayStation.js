import mongoose from 'mongoose';

const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

const railwayStationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', trim: true, uppercase: true },
    service_location_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiServiceLocation', default: null },
    address: { type: String, default: '', trim: true },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    location: { type: pointSchema, default: undefined },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

railwayStationSchema.index({ name: 1 });
railwayStationSchema.index({ code: 1 });
railwayStationSchema.index({ service_location_id: 1, status: 1 });
railwayStationSchema.index({ location: '2dsphere' });

export const RailwayStation =
  mongoose.models.TaxiRailwayStation || mongoose.model('TaxiRailwayStation', railwayStationSchema);
