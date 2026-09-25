import mongoose from 'mongoose';

const driverNeededDocumentSchema = new mongoose.Schema(
  {
    template_type: {
      type: String,
      enum: ['document', 'vehicle_field'],
      default: 'document',
      index: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    account_type: {
      type: String,
      enum: ['individual', 'fleet_drivers', 'both'],
      default: 'individual',
      trim: true,
    },
    // What this document is *about*, not who uploads it (that's account_type
    // above — a fleet-hired driver vs an individual). A `document`-type
    // template with no `applies_to` was being treated as required on every
    // POST /drivers/fleet/vehicles call, meaning adding a vehicle demanded
    // the driver's own licence/ID/photo all over again — documents already
    // collected at registration and unrelated to the vehicle. Only templates
    // explicitly marked `vehicle` (RC, insurance, ...) apply there now.
    applies_to: {
      type: String,
      enum: ['driver', 'vehicle'],
      default: 'driver',
      trim: true,
    },
    // '' (default) = required regardless. 'commercial' | 'private' = only
    // when the driver's chosen vehicle_usage_type matches — e.g. the
    // Commercial Permit template, which used to be asked of every driver at
    // registration even though it's meaningless for someone registering a
    // private vehicle.
    applies_when_usage_type: {
      type: String,
      enum: ['', 'commercial', 'private'],
      default: '',
      trim: true,
    },
    image_type: {
      type: String,
      enum: ['front_back', 'front', 'back', 'image'],
      default: 'front_back',
      trim: true,
    },
    has_expiry_date: {
      type: Boolean,
      default: false,
    },
    has_identify_number: {
      type: Boolean,
      default: false,
    },
    identify_number_key: {
      type: String,
      default: '',
      trim: true,
    },
    is_editable: {
      type: Boolean,
      default: false,
    },
    is_required: {
      type: Boolean,
      default: false,
    },
    key: {
      type: String,
      default: '',
      trim: true,
    },
    front_key: {
      type: String,
      default: '',
      trim: true,
    },
    back_key: {
      type: String,
      default: '',
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    field_key: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    field_type: {
      type: String,
      default: 'text',
      trim: true,
    },
    field_group: {
      type: String,
      default: '',
      trim: true,
    },
    placeholder: {
      type: String,
      default: '',
      trim: true,
    },
    help_text: {
      type: String,
      default: '',
      trim: true,
    },
    sort_order: {
      type: Number,
      default: 0,
    },
    options: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

driverNeededDocumentSchema.index({ name: 1 });
driverNeededDocumentSchema.index({ active: 1, image_type: 1 });

export const DriverNeededDocument =
  mongoose.models.TaxiDriverNeededDocument || mongoose.model('TaxiDriverNeededDocument', driverNeededDocumentSchema);
