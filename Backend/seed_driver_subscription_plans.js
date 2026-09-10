import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI is missing in .env');
  process.exit(1);
}

const subscriptionPlanSchema = new mongoose.Schema(
  {
    audience: { type: String, enum: ['driver', 'user'], default: 'driver', index: true },
    name: { type: String, required: true },
    description: String,
    amount: { type: Number, required: true },
    duration: { type: Number, required: true }, // in days
    transport_type: { type: String, default: 'all' },
    vehicle_type_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxiVehicle' },
    benefit_type: { type: String, enum: ['standard', 'limited', 'unlimited'], default: 'standard' },
    ride_limit: { type: Number, default: 0, min: 0 },
    how_it_works: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const SubscriptionPlan = mongoose.models.TaxiSubscriptionPlan || mongoose.model('TaxiSubscriptionPlan', subscriptionPlanSchema);

const adminBusinessSettingSchema = new mongoose.Schema(
  {
    scope: { type: String, default: 'default', unique: true },
    customization: { type: mongoose.Schema.Types.Mixed, default: {} },
    general: { type: mongoose.Schema.Types.Mixed, default: {} },
    transport_ride: { type: mongoose.Schema.Types.Mixed, default: {} },
    driver_subscriptions: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, strict: false }
);

const AdminBusinessSetting = mongoose.models.TaxiAdminBusinessSetting || mongoose.model('TaxiAdminBusinessSetting', adminBusinessSettingSchema);

const SEED_PLANS = [
  {
    audience: 'driver',
    name: 'Basic (Monthly)',
    description: 'Basic driver subscription plan - ₹99 per month',
    amount: 99,
    duration: 30,
    transport_type: 'all',
    benefit_type: 'standard',
    how_it_works: 'Pay ₹99 per month to access platform orders.',
    active: true,
  },
  {
    audience: 'driver',
    name: 'Basic (Yearly)',
    description: 'Basic driver subscription plan - ₹1,000 per year (1-time annual purchase)',
    amount: 1000,
    duration: 365,
    transport_type: 'all',
    benefit_type: 'standard',
    how_it_works: 'Pay ₹1,000 for full 1 year driver access.',
    active: true,
  },
  {
    audience: 'driver',
    name: 'Premium (Monthly)',
    description: 'Premium driver subscription plan - ₹1,000 per month',
    amount: 1000,
    duration: 30,
    transport_type: 'all',
    benefit_type: 'unlimited',
    how_it_works: 'Pay ₹1,000 per month for premium driver benefits and priority ride dispatch.',
    active: true,
  },
  {
    audience: 'driver',
    name: 'Premium (Yearly)',
    description: 'Premium driver subscription plan - ₹10,000 per year (1-time annual purchase)',
    amount: 10000,
    duration: 365,
    transport_type: 'all',
    benefit_type: 'unlimited',
    how_it_works: 'Pay ₹10,000 for 1 full year of premium driver benefits.',
    active: true,
  },
  {
    audience: 'driver',
    name: 'Super Premium (Monthly)',
    description: 'Super Premium driver subscription plan - ₹5,000 per month',
    amount: 5000,
    duration: 30,
    transport_type: 'all',
    benefit_type: 'unlimited',
    how_it_works: 'Pay ₹5,000 per month for top-tier VIP status, maximum order priority, and 0% commission.',
    active: true,
  },
  {
    audience: 'driver',
    name: 'Super Premium (Yearly)',
    description: 'Super Premium driver subscription plan - ₹50,000 per year (1-time annual purchase)',
    amount: 50000,
    duration: 365,
    transport_type: 'all',
    benefit_type: 'unlimited',
    how_it_works: 'Pay ₹50,000 for 1 full year of VIP Super Premium driver status.',
    active: true,
  },
];

async function runSeed() {
  try {
    const dbName = process.env.MONGODB_DB_NAME || 'gokab';
    console.log(`Connecting to MongoDB database: ${dbName}...`);
    await mongoose.connect(MONGODB_URI, { dbName });
    console.log(`Connected successfully to database "${dbName}"!`);

    console.log('Seeding driver subscription plans...');

    for (const plan of SEED_PLANS) {
      const existing = await SubscriptionPlan.findOne({ name: plan.name, audience: 'driver' });
      if (existing) {
        await SubscriptionPlan.updateOne({ _id: existing._id }, { $set: plan });
        console.log(`Updated plan: ${plan.name} (Amount: ₹${plan.amount}, Duration: ${plan.duration} days)`);
      } else {
        const created = await SubscriptionPlan.create(plan);
        console.log(`Created plan: ${created.name} (ID: ${created._id}, Amount: ₹${created.amount})`);
      }
    }

    // Update settings mode to allow subscriptions ('both' or 'subscriptionOnly')
    const settings = await AdminBusinessSetting.findOne({ scope: 'default' });
    if (settings) {
      settings.driver_subscriptions = {
        ...(settings.driver_subscriptions || {}),
        mode: 'both',
      };
      await settings.save();
      console.log('Updated driver subscription mode to "both" (Commission + Subscriptions active).');
    }

    const allPlans = await SubscriptionPlan.find({ audience: 'driver' }).sort({ amount: 1 });
    console.log('\n--- ALL DRIVER SUBSCRIPTION PLANS IN DATABASE ---');
    allPlans.forEach((p) => {
      console.log(`- [${p.name}] Amount: ₹${p.amount} | Duration: ${p.duration} days | Active: ${p.active}`);
    });

    console.log('\nSeed completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

runSeed();
