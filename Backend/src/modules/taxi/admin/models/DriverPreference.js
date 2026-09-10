import mongoose from 'mongoose';

const driverPreferenceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  key: { type: String, required: true, unique: true },
  icon: { type: String, default: '' },
  active: { type: Boolean, default: true }
}, { timestamps: true });

export const DriverPreference = mongoose.models.TaxiDriverPreference || mongoose.model('TaxiDriverPreference', driverPreferenceSchema);
