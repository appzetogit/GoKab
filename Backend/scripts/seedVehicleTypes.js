import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { getStoragePath, getPublicUrl } from '../src/utils/storage.util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VEHICLES_TO_SEED = [
  {
    name: 'GoKab Auto',
    short_description: 'Affordable city rides',
    description: 'Standard auto rickshaw service for quick and affordable city transportation.',
    transport_type: 'taxi',
    dispatch_type: 'normal',
    icon_types: 'auto',
    capacity: 3,
    size: 'Small',
    is_taxi: 'taxi',
    is_accept_share_ride: 0,
    airport: false,
    status: 1,
    active: true,
    asset: 'gokab-auto.webp'
  },
  {
    name: 'GoKab Mini',
    short_description: 'Budget friendly city rides',
    description: 'Compact hatchback rides suitable for affordable everyday travel.',
    transport_type: 'taxi',
    dispatch_type: 'normal',
    icon_types: 'car',
    capacity: 4,
    size: 'Small',
    is_taxi: 'taxi',
    is_accept_share_ride: 1,
    airport: false,
    status: 1,
    active: true,
    asset: 'gokab-mini.webp'
  },
  {
    name: 'GoKab Sedan',
    short_description: 'Comfortable everyday rides',
    description: 'Comfortable sedan rides for office travel, family trips, and daily commuting.',
    transport_type: 'taxi',
    dispatch_type: 'normal',
    icon_types: 'car',
    capacity: 4,
    size: 'Medium',
    is_taxi: 'taxi',
    is_accept_share_ride: 1,
    airport: true,
    status: 1,
    active: true,
    asset: 'gokab-sedan.webp'
  },
  {
    name: 'GoKab SUV',
    short_description: 'Spacious family rides',
    description: 'Premium SUV rides with extra comfort and space for families.',
    transport_type: 'taxi',
    dispatch_type: 'normal',
    icon_types: 'suv',
    capacity: 5,
    size: 'Large',
    is_taxi: 'taxi',
    is_accept_share_ride: 1,
    airport: true,
    status: 1,
    active: true,
    asset: 'gokab-suv.webp'
  },
  {
    name: 'GoKab XL',
    short_description: 'Large group travel',
    description: 'Spacious 6-7 seater vehicles for families and group transportation.',
    transport_type: 'taxi',
    dispatch_type: 'normal',
    icon_types: 'suv',
    capacity: 6,
    size: 'Large',
    is_taxi: 'taxi',
    is_accept_share_ride: 1,
    airport: true,
    status: 1,
    active: true,
    asset: 'gokab-xl.webp'
  },
  {
    name: 'GoKab Premium',
    short_description: 'Luxury executive rides',
    description: 'Premium luxury vehicles for corporate travel and high comfort rides.',
    transport_type: 'taxi',
    dispatch_type: 'normal',
    icon_types: 'premium',
    capacity: 4,
    size: 'Premium',
    is_taxi: 'taxi',
    is_accept_share_ride: 0,
    airport: true,
    status: 1,
    active: true,
    asset: 'gokab-premium.webp'
  }
];

const seedVehicleTypes = async () => {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(env.mongoUri, {
      autoIndex: env.nodeEnv !== 'production',
      dbName: env.mongoDbName
    });
    console.log('Connected to MongoDB');

    const sourceDir = path.resolve(__dirname, '../assets/vehicle-types/images');

    // Filter which need to be created and which are skipped
    const toCreate = [];
    const skipped = [];

    for (const v of VEHICLES_TO_SEED) {
      const existing = await Vehicle.findOne({ name: v.name });
      if (existing) {
        skipped.push(v);
      } else {
        toCreate.push(v);
      }
    }

    if (skipped.length > 0) {
      console.log('\nSkipped:');
      for (const v of skipped) {
        console.log(`* ${v.name} already exists`);
      }
    }

    if (toCreate.length > 0) {
      console.log('\nUploading vehicle images...');
      console.log('Created:');
      
      const { absoluteDir, relativePath } = getStoragePath('vehicles/images');

      for (const v of toCreate) {
        const sourcePath = path.join(sourceDir, v.asset);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`Source image file not found: ${sourcePath}`);
        }

        const destinationPath = path.join(absoluteDir, v.asset);
        fs.copyFileSync(sourcePath, destinationPath);

        const imageUrl = getPublicUrl(relativePath, v.asset);

        await Vehicle.create({
          name: v.name,
          short_description: v.short_description,
          description: v.description,
          transport_type: v.transport_type,
          dispatch_type: v.dispatch_type,
          icon_types: v.icon_types,
          capacity: v.capacity,
          size: v.size,
          is_taxi: v.is_taxi,
          is_accept_share_ride: v.is_accept_share_ride,
          airport: v.airport,
          status: v.status,
          active: v.active,
          image: imageUrl,
          icon: '',
          map_icon: '',
          supported_other_vehicle_types: [],
          vehicle_preference: [],
          delivery_category: '',
          delivery_distance_pricing: {
            enabled: false,
            base_price: 0,
            free_distance: 0,
            distance_price: 0,
            free_time: 0,
            time_price: 0
          }
        });

        console.log(`* ${v.name}`);
      }
    }

    console.log('\nDatabase seeding completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding vehicle types:', error);
    process.exit(1);
  }
};

seedVehicleTypes();
