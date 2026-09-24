import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { SubscriptionTier } from './src/modules/taxi/admin/models/SubscriptionTier.js';
import { RideModule } from './src/modules/taxi/admin/models/RideModule.js';
import { SupportChannelType } from './src/modules/taxi/admin/models/SupportChannelType.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.MONGODB_DB_NAME || 'gokab';

const DEFAULT_RIDE_MODULES = [
  { code: 'city', display_name: 'City Taxi', description: 'Standard local city rides' },
  { code: 'outstation', display_name: 'Outstation Intercity', description: 'Long-distance intercity trips' },
  { code: 'airport', display_name: 'Airport Transfer', description: 'Priority airport pickups and drop-offs' },
  { code: 'parcel', display_name: 'Parcel & Goods Delivery', description: 'Local package courier delivery' },
  { code: 'carpool', display_name: 'Carpool & Shared Rides', description: 'Seat-based route sharing' },
];

const DEFAULT_SUPPORT_CHANNELS = [
  { code: 'chat', name: 'In-app Chat Support', description: 'Standard in-app ticketing and support chat' },
  { code: 'fast_track', name: 'Fast-Track Email & Priority Chat', description: 'Priority queue email and fast chat support' },
  { code: 'phone_247', name: '24/7 Priority Phone Hotline', description: 'Direct 24/7 VIP phone line for instant resolution' },
];

async function seedTierSystem() {
  try {
    console.log(`Connecting to MongoDB database: ${dbName}...`);
    await mongoose.connect(MONGODB_URI, { dbName });
    console.log('Connected successfully!');

    // 1. Seed Ride Modules
    console.log('Seeding Ride Modules...');
    const seededModules = {};
    for (const mod of DEFAULT_RIDE_MODULES) {
      let doc = await RideModule.findOne({ code: mod.code });
      if (!doc) {
        doc = await RideModule.create(mod);
        console.log(`+ Created Ride Module: ${doc.display_name} (${doc.code})`);
      } else {
        console.log(`= Existing Ride Module: ${doc.display_name}`);
      }
      seededModules[doc.code] = doc._id;
    }

    // 2. Seed Support Channel Types
    console.log('Seeding Support Channel Types...');
    const seededChannels = {};
    for (const chan of DEFAULT_SUPPORT_CHANNELS) {
      let doc = await SupportChannelType.findOne({ code: chan.code });
      if (!doc) {
        doc = await SupportChannelType.create(chan);
        console.log(`+ Created Support Channel: ${doc.name} (${doc.code})`);
      } else {
        console.log(`= Existing Support Channel: ${doc.name}`);
      }
      seededChannels[doc.code] = doc._id;
    }

    // 3. Seed Subscription Tiers
    console.log('Seeding Subscription Tiers...');

    const TIERS_TO_SEED = [
      {
        name: 'Basic',
        is_default: true, // Singleton Default Fallback Tier
        display_order: 1,
        priority_score: 10,
        price_monthly: 99,
        price_yearly: 1000,
        commission_percent: 15.0,
        search_radius_multiplier: 1.0,
        max_cash_debt_allowed: 0,
        free_cancellations_per_day: 0,
        cancellation_penalty_waived: false,
        support_channel_type_id: seededChannels['chat'],
        // This app is taxi-only: "Taxi" covers local and intercity rides
        // alike (there is no separate service category the driver picks),
        // so every tier a taxi driver can hold needs city AND outstation —
        // city alone meant this tier's drivers never received an intercity
        // request. No parcel/carpool: there is no delivery/pooling product
        // for drivers of this app.
        ride_module_ids: [seededModules['city'], seededModules['outstation']],
        badge_color_hex: '#6B7280',
        is_active: true,
      },
      {
        name: 'Premium',
        is_default: false,
        display_order: 2,
        priority_score: 50,
        price_monthly: 1000,
        price_yearly: 10000,
        commission_percent: 5.0,
        search_radius_multiplier: 2.0,
        max_cash_debt_allowed: 1000,
        free_cancellations_per_day: 1,
        cancellation_penalty_waived: false,
        support_channel_type_id: seededChannels['fast_track'],
        // No parcel: see the note on Basic above.
        ride_module_ids: [seededModules['city'], seededModules['outstation'], seededModules['airport']],
        badge_color_hex: '#3B82F6',
        is_active: true,
      },
      {
        name: 'Super Premium',
        is_default: false,
        display_order: 3,
        priority_score: 100,
        price_monthly: 5000,
        price_yearly: 50000,
        commission_percent: 0.0, // 0% COMMISSION!
        search_radius_multiplier: 3.0,
        max_cash_debt_allowed: 3000,
        free_cancellations_per_day: 5,
        cancellation_penalty_waived: true,
        support_channel_type_id: seededChannels['phone_247'],
        // No parcel/carpool: see the note on Basic above.
        ride_module_ids: [seededModules['city'], seededModules['outstation'], seededModules['airport']],
        badge_color_hex: '#10B981',
        is_active: true,
      },
    ];

    for (const tierData of TIERS_TO_SEED) {
      let tier = await SubscriptionTier.findOne({ name: tierData.name });
      if (!tier) {
        tier = await SubscriptionTier.create(tierData);
        console.log(`+ Created Subscription Tier: ${tier.name} (Priority: ${tier.priority_score}, Comm: ${tier.commission_percent}%)`);
      } else {
        await SubscriptionTier.updateOne({ _id: tier._id }, { $set: tierData });
        console.log(`= Updated Subscription Tier: ${tier.name} (Priority: ${tierData.priority_score}, Comm: ${tierData.commission_percent}%)`);
      }
    }

    // Enforce Singleton Default
    await SubscriptionTier.updateMany({ name: { $ne: 'Basic' } }, { $set: { is_default: false } });

    console.log('\n--- SYSTEM SUBSCRIPTION TIERS IN GOKAB DB ---');
    const allTiers = await SubscriptionTier.find().populate('ride_module_ids').populate('support_channel_type_id').lean();
    for (const t of allTiers) {
      console.log(`- [${t.name}] ${t.is_default ? '(DEFAULT FALLBACK)' : ''} | Priority Score: ${t.priority_score} | Commission: ${t.commission_percent}% | Max Debt: ₹${t.max_cash_debt_allowed} | Modules: ${t.ride_module_ids.map((m) => m.display_name).join(', ')}`);
    }

    console.log('\nSeed tier system completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seed tier system error:', error);
    process.exit(1);
  }
}

seedTierSystem();
