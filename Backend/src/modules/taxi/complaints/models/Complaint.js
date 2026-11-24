import mongoose from 'mongoose';

const person = { name: { type: String, default: '' }, phone: { type: String, default: '' } };

/**
 * One complaint after a ride: a rider about the driver, or the driver about the
 * rider. Names, owner and ride are copied as they were then, so a driver who
 * changes team later does not move old complaints to a new owner.
 */
const complaintSchema = new mongoose.Schema(
  {
    // `<ride id>:<direction>`: one complaint per ride and side, with no extra index.
    _id: { type: String },
    direction: { type: String, enum: ['user_on_driver', 'driver_on_user'], required: true },
    ride_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRide', required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiUser', required: true, index: true },
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true, index: true },
    service_location_id: { type: mongoose.Schema.Types.ObjectId, default: null },

    user: person,
    driver: { ...person, vehicle: { type: String, default: '' }, plan: { type: String, default: '' } },
    owner: {
      kind: { type: String, enum: ['self', 'lead', 'company'], default: 'self' },
      key: { type: String, default: '', index: true },
      driver_id: { type: mongoose.Schema.Types.ObjectId, default: null },
      owner_id: { type: mongoose.Schema.Types.ObjectId, default: null },
      ...person,
      org: { type: String, default: '' },
      plan: { type: String, default: '' },
    },
    // Who put the ride up, when another driver did (published or assigned rides).
    ride_by: { driver_id: { type: mongoose.Schema.Types.ObjectId, default: null }, ...person },
    ride: {
      pickup: { type: String, default: '' },
      drop: { type: String, default: '' },
      fare: { type: Number, default: 0 },
      status: { type: String, default: '' },
      service: { type: String, default: '' },
      at: { type: Date, default: null },
    },

    reason: { type: String, required: true },
    safety: { type: Boolean, default: false },
    message: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: ['new', 'reviewing', 'resolved'], default: 'new' },
    // Every admin step, newest last. Never shown to the rider or the driver.
    notes: [
      {
        _id: false,
        admin: { type: String, default: '' },
        text: { type: String, default: '' },
        status: { type: String, default: '' },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

complaintSchema.index({ direction: 1, status: 1, createdAt: -1 });

export const Complaint = mongoose.models.TaxiComplaint || mongoose.model('TaxiComplaint', complaintSchema);
