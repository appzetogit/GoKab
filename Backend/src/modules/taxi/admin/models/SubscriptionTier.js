import mongoose from 'mongoose';

const subscriptionTierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    is_default: { type: Boolean, default: false, index: true },
    display_order: { type: Number, default: 0 },
    priority_score: { type: Number, default: 0, index: true },
    price_monthly: { type: Number, default: 0, min: 0 },
    price_yearly: { type: Number, default: 0, min: 0 },
    commission_percent: { type: Number, default: 15, min: 0, max: 100 },
    search_radius_multiplier: { type: Number, default: 1.0, min: 0.1 },
    max_cash_debt_allowed: { type: Number, default: 0, min: 0 }, // e.g. 1000 means wallet can drop down to -1000
    free_cancellations_per_day: { type: Number, default: 0, min: 0 },
    cancellation_penalty_waived: { type: Boolean, default: false },
    support_channel_type_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiSupportChannelType', default: null },
    ride_module_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxiRideModule' }],
    map_icon_asset_url: { type: String, default: '' },
    badge_color_hex: { type: String, default: '#10B981' },
    is_active: { type: Boolean, default: true, index: true },

    // --- Driver network (Prime / Middle / Lower) ---
    // The recharge a driver buys *is* the tier, so the network category and the
    // permissions that come with it live here rather than on the driver. The
    // driver's own `driver_category` is only a denormalised copy of this,
    // refreshed whenever a subscription activates or expires.
    driver_category: {
      type: String,
      enum: ['prime', 'middle', 'lower'],
      default: 'lower',
      index: true,
    },
    can_create_rides: { type: Boolean, default: false },
    can_manage_fleet: { type: Boolean, default: false },
    can_publish_rides: { type: Boolean, default: false },
    // The *ongoing* rule: once on Middle/Prime, a lapse into only one vehicle
    // type starts the grace window (driverCategoryService.recheckCategoryVehicleRule).
    requires_commercial_and_private: { type: Boolean, default: false },
    // The *purchase-time* rule, checked once at checkout. Deliberately looser
    // than the ongoing rule above: a driver only has their onboarding vehicle
    // at that point, so demanding both types up front is a rule a one-vehicle
    // driver could never satisfy (they can't add a second vehicle before
    // buying a plan that unlocks fleet ownership). Requiring commercial only
    // here, with private required afterwards under the ongoing rule's grace
    // period, is what makes Middle/Prime reachable at all.
    requires_commercial_at_purchase: { type: Boolean, default: false },
    max_routes: { type: Number, default: 2, min: 0 },
    max_fleet_drivers: { type: Number, default: 0, min: 0 },
    // How many vehicles this tier may hold under its own organisation, once
    // one exists (0 = unlimited). Only meaningful for a tier that does not
    // already cap fleet size via `can_manage_fleet`/`max_fleet_drivers` — set
    // on Lower so that being allowed to add a second vehicle at all (needed to
    // ever qualify for Middle/Prime) doesn't become a way to build a free fleet.
    max_vehicles: { type: Number, default: 0, min: 0 },
    // Contacting a lead costs the driver this much, once per ride. Driver-published
    // leads are free for everyone by default; customer leads are charged to Lower.
    customer_lead_contact_fee: { type: Number, default: 0, min: 0 },
    driver_lead_contact_fee: { type: Number, default: 0, min: 0 },
    customer_ride_accept_fee: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export const SubscriptionTier =
  mongoose.models.TaxiSubscriptionTier || mongoose.model('TaxiSubscriptionTier', subscriptionTierSchema);
