import mongoose from 'mongoose';

/**
 * A bill (invoice) a driver generated for a customer. The app still builds the
 * PDF and the WhatsApp text; the server stores the data, owns the bill number
 * and recomputes the totals.
 *
 * Bills are accounting records: never edited, only soft-deleted, and a bill
 * number is never reused.
 */
const driverBillSchema = new mongoose.Schema(
  {
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true },
    bill_no: { type: String, required: true, trim: true },
    // App-generated id of the save attempt; a retry with the same value
    // returns the bill already created instead of a second one.
    client_ref: { type: String, default: undefined, trim: true },
    ride_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRide', default: null },
    imported: { type: Boolean, default: false },

    customer_name: { type: String, required: true, trim: true },
    customer_phone: { type: String, default: '', trim: true },
    company_gst: { type: String, default: '', trim: true },

    pickup_address: { type: String, required: true, trim: true },
    drop_address: { type: String, required: true, trim: true },
    distance_km: { type: Number, default: 0 },
    trip_type: { type: String, enum: ['One Way', 'Round Trip', 'Local', 'Outstation'], required: true },
    trip_date: { type: Date, required: true },

    driver_name: { type: String, required: true, trim: true },
    vehicle_number: { type: String, required: true, trim: true },
    vehicle_model: { type: String, required: true, trim: true },

    base_fare: { type: Number, default: 0 },
    rate_per_km: { type: Number, default: 0 },
    toll: { type: Number, default: 0 },
    parking: { type: Number, default: 0 },
    waiting: { type: Number, default: 0 },
    night_da: { type: Number, default: 0 },
    extra: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },

    distance_charge: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    grand_total: { type: Number, default: 0 },

    payment_method: { type: String, enum: ['Cash', 'Online (UPI)'], required: true },
    payment_status: { type: String, enum: ['Paid', 'Pending'], required: true },

    deleted_at: { type: Date, default: null },
  },
  { timestamps: true },
);

driverBillSchema.index({ driver_id: 1, deleted_at: 1, createdAt: -1 });
driverBillSchema.index({ driver_id: 1, bill_no: 1 }, { unique: true });
driverBillSchema.index(
  { driver_id: 1, client_ref: 1 },
  { unique: true, partialFilterExpression: { client_ref: { $type: 'string' } } },
);
driverBillSchema.index({ driver_id: 1, customer_phone: 1 });
driverBillSchema.index({ ride_id: 1 }, { partialFilterExpression: { ride_id: { $type: 'objectId' } } });

export const DriverBill =
  mongoose.models.TaxiDriverBill || mongoose.model('TaxiDriverBill', driverBillSchema);

/** Per-driver bill number sequence (GK-000001, GK-000002, ...). */
const driverBillCounterSchema = new mongoose.Schema(
  {
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiDriver', required: true, unique: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const DriverBillCounter =
  mongoose.models.TaxiDriverBillCounter || mongoose.model('TaxiDriverBillCounter', driverBillCounterSchema);
