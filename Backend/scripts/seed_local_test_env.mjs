/**
 * Builds a self-contained local database for exercising the driver-network
 * module end to end. Everything here is synthetic — no production data is read
 * or copied — so it is safe to point at a throwaway local mongod.
 *
 * Usage:
 *   SEED_DB_URI=mongodb://127.0.0.1:27031 SEED_DB_NAME=gokab \
 *     node scripts/seed_local_test_env.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

import { Admin } from '../src/modules/taxi/admin/models/Admin.js';
import { AdminAppSetting } from '../src/modules/taxi/admin/models/AdminAppSetting.js';
import { AdminBusinessSetting } from '../src/modules/taxi/admin/models/AdminBusinessSetting.js';
import { Driver } from '../src/modules/taxi/driver/models/Driver.js';
import { FleetVehicle } from '../src/modules/taxi/admin/models/FleetVehicle.js';
import { Owner } from '../src/modules/taxi/admin/models/Owner.js';
import { RideModule } from '../src/modules/taxi/admin/models/RideModule.js';
import { ServiceLocation } from '../src/modules/taxi/admin/models/ServiceLocation.js';
import { SetPrice } from '../src/modules/taxi/admin/models/SetPrice.js';
import { User } from '../src/modules/taxi/user/models/User.js';
import { Vehicle } from '../src/modules/taxi/admin/models/Vehicle.js';
import { Zone } from '../src/modules/taxi/driver/models/Zone.js';
import { createDefaultAppSettings } from '../src/modules/taxi/admin/data/defaultAppSettings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const URI = process.env.SEED_DB_URI || 'mongodb://127.0.0.1:27031';
const DB_NAME = process.env.SEED_DB_NAME || 'gokab';
const PASSWORD = 'password';

const CITIES = [
  { name: 'Indore', lng: 75.8577, lat: 22.7196, box: [75.5, 22.4, 76.2, 23.0] },
  { name: 'Bhopal', lng: 77.4126, lat: 23.2599, box: [77.1, 23.0, 77.7, 23.5] },
];

const VEHICLES = [
  { name: 'GoKab Mini', icon_types: 'car', capacity: 4 },
  { name: 'GoKab Sedan', icon_types: 'car', capacity: 4 },
  { name: 'GoKab Auto', icon_types: 'auto', capacity: 3 },
];

const boxToPolygon = ([minLng, minLat, maxLng, maxLat]) => ({
  type: 'Polygon',
  coordinates: [[
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ]],
});

const upsertCity = async (city) => {
  const existing = await ServiceLocation.findOne({ name: city.name });
  if (existing) return existing;

  return ServiceLocation.create({
    name: city.name,
    service_location_name: city.name,
    latitude: city.lat,
    longitude: city.lng,
    location: { type: 'Point', coordinates: [city.lng, city.lat] },
    status: 'active',
    active: true,
  });
};

const upsertZone = async (city, serviceLocationId) => {
  const existing = await Zone.findOne({ name: `${city.name} Zone` });
  if (existing) return existing;

  return Zone.create({
    name: `${city.name} Zone`,
    service_location_id: serviceLocationId,
    unit: 'km',
    active: true,
    status: 'active',
    boundary_mode: 'polygon',
    geometry: boxToPolygon(city.box),
  });
};

const upsertVehicle = async (vehicle) => {
  const existing = await Vehicle.findOne({ name: vehicle.name });
  if (existing) return existing;

  return Vehicle.create({
    name: vehicle.name,
    short_description: vehicle.name,
    description: vehicle.name,
    transport_type: 'taxi',
    dispatch_type: 'normal',
    icon_types: vehicle.icon_types,
    capacity: vehicle.capacity,
    size: 'Small',
    is_taxi: 'taxi',
    status: 1,
    active: true,
    image: `${vehicle.name.toLowerCase().replace(/\s+/g, '-')}.webp`,
  });
};

const upsertSetPrice = async ({ zone, serviceLocationId, vehicles }) => {
  const existing = await SetPrice.findOne({ zone_id: zone._id, transport_type: 'taxi' });
  if (existing) return existing;

  return SetPrice.create({
    zone_id: zone._id,
    service_location_id: serviceLocationId,
    transport_type: 'taxi',
    vehicle_type: vehicles[0]._id,
    active: 1,
    status: 'active',
    admin_commission_type_from_driver: 1,
    admin_commission_from_driver: 15,
    prices: vehicles.map((vehicle) => ({
      vehicle_type: vehicle._id,
      base_price: 50,
      free_distance: 1,
      distance_price: 12,
      free_time: 2,
      time_price: 1,
      admin_commision_type: 1,
      admin_commision: 15,
      admin_commission_type_from_driver: 1,
      admin_commission_from_driver: 15,
    })),
  });
};

const upsertDriver = async ({
  name,
  phone,
  city,
  vehicle,
  usageType,
  ownerId = null,
  walletBalance = 0,
  coordinates,
}) => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await Driver.findOne({ phone });

  const payload = {
    name,
    phone,
    password: passwordHash,
    service_location_id: city.serviceLocationId,
    zoneId: city.zoneId,
    vehicleType: vehicle.icon_types === 'auto' ? 'auto' : 'car',
    vehicleTypeId: vehicle._id,
    vehicleIconType: vehicle.icon_types,
    vehicleNumber: `MP09${name.slice(0, 2).toUpperCase()}${String(phone).slice(-4)}`,
    vehicleMake: 'Maruti',
    vehicleModel: 'Dzire',
    vehicleColor: 'White',
    vehicle_usage_type: usageType,
    owner_id: ownerId,
    city: city.name,
    approve: true,
    status: 'approved',
    isOnline: true,
    isOnRide: false,
    location: { type: 'Point', coordinates },
    wallet: { balance: walletBalance, cashLimit: 500, isBlocked: false, frozenBalance: 0 },
  };

  if (existing) {
    Object.assign(existing, payload);
    await existing.save();
    return existing;
  }

  return Driver.create(payload);
};

const run = async () => {
  await mongoose.connect(URI, { dbName: DB_NAME, serverSelectionTimeoutMS: 20000, directConnection: true });
  console.log(`Connected to "${mongoose.connection.name}"\n`);

  // --- Settings -------------------------------------------------------
  await AdminAppSetting.updateOne(
    { scope: 'default' },
    { $setOnInsert: { scope: 'default', ...createDefaultAppSettings() } },
    { upsert: true },
  );
  await AdminBusinessSetting.updateOne(
    { scope: 'default' },
    { $setOnInsert: { scope: 'default' } },
    { upsert: true },
  );
  console.log('Settings ready');

  // --- Admin ----------------------------------------------------------
  await Admin.collection.updateOne(
    { email: 'admin@gmail.com' },
    {
      $set: {
        name: 'Super Admin',
        email: 'admin@gmail.com',
        phone: '9999999999',
        password: await bcrypt.hash(PASSWORD, 10),
        role: 'superadmin',
        admin_type: 'superadmin',
        permissions: ['*'],
        active: true,
        status: 'active',
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  console.log('Admin ready: admin@gmail.com / password');

  // --- Cities, zones, vehicles, pricing -------------------------------
  const cities = {};
  for (const city of CITIES) {
    const serviceLocation = await upsertCity(city);
    const zone = await upsertZone(city, serviceLocation._id);
    cities[city.name] = {
      name: city.name,
      serviceLocationId: serviceLocation._id,
      zoneId: zone._id,
      zone,
      lng: city.lng,
      lat: city.lat,
    };
    console.log(`City ready: ${city.name}`);
  }

  const vehicles = [];
  for (const vehicle of VEHICLES) {
    vehicles.push(await upsertVehicle(vehicle));
  }
  console.log(`Vehicles ready: ${vehicles.map((v) => v.name).join(', ')}`);

  for (const city of Object.values(cities)) {
    await upsertSetPrice({ zone: city.zone, serviceLocationId: city.serviceLocationId, vehicles });
  }
  console.log('Pricing ready');

  // --- Ride modules ---------------------------------------------------
  for (const mod of [
    { code: 'city', display_name: 'City Taxi' },
    { code: 'outstation', display_name: 'Outstation Intercity' },
    { code: 'airport', display_name: 'Airport Transfer' },
    { code: 'parcel', display_name: 'Parcel Delivery' },
  ]) {
    const existing = await RideModule.findOne({ code: mod.code });
    if (!existing) await RideModule.create(mod);
  }
  console.log('Ride modules ready');

  // --- Organisation owned by the Prime driver --------------------------
  const indore = cities.Indore;
  let owner = await Owner.findOne({ mobile: '9000000001' });
  if (!owner) {
    owner = await Owner.create({
      company_name: 'Ram Travels',
      owner_name: 'Ramesh Verma',
      name: 'Ramesh Verma',
      mobile: '9000000001',
      email: 'ramtravels@example.test',
      password: await bcrypt.hash(PASSWORD, 10),
      service_location_id: indore.serviceLocationId,
      transport_type: 'taxi',
      approve: true,
      active: true,
    });
  }
  console.log(`Organisation ready: ${owner.company_name}`);

  // --- Drivers ---------------------------------------------------------
  const ramesh = await upsertDriver({
    name: 'Ramesh Verma',
    phone: '9000000001',
    city: indore,
    vehicle: vehicles[1],
    usageType: 'private',
    ownerId: owner._id,
    walletBalance: 10000,
    coordinates: [75.8577, 22.7196],
  });
  ramesh.is_self_drive_owner = true;
  await ramesh.save();

  const suresh = await upsertDriver({
    name: 'Suresh Kumar',
    phone: '9000000002',
    city: indore,
    vehicle: vehicles[0],
    usageType: 'commercial',
    ownerId: owner._id,
    walletBalance: 2000,
    coordinates: [75.8600, 22.7250],
  });

  const vikas = await upsertDriver({
    name: 'Vikas Singh',
    phone: '9000000003',
    city: indore,
    vehicle: vehicles[1],
    usageType: 'private',
    walletBalance: 2500,
    coordinates: [75.8700, 22.7300],
  });

  const mohan = await upsertDriver({
    name: 'Mohan Lal',
    phone: '9000000004',
    city: indore,
    vehicle: vehicles[0],
    usageType: 'private',
    walletBalance: 500,
    coordinates: [75.8400, 22.7100],
  });

  console.log(
    `Drivers ready: ${[ramesh, suresh, vikas, mohan].map((d) => `${d.name} (${d.phone})`).join(', ')}`,
  );

  // One commercial + one private vehicle under Ram Travels, so Ramesh clears
  // the Prime/Middle vehicle rule.
  for (const vehicleSpec of [
    { plate: 'MP09CM0001', usage: 'commercial' },
    { plate: 'MP09PV0001', usage: 'private' },
  ]) {
    const existing = await FleetVehicle.findOne({
      owner_id: owner._id,
      license_plate_number: vehicleSpec.plate,
    });
    if (existing) {
      existing.usage_type = vehicleSpec.usage;
      existing.status = 'approved';
      existing.active = true;
      await existing.save();
      continue;
    }
    await FleetVehicle.create({
      owner_id: owner._id,
      service_location_id: indore.serviceLocationId,
      transport_type: 'taxi',
      vehicle_type_id: vehicles[1]._id,
      car_brand: 'Maruti',
      car_model: 'Dzire',
      license_plate_number: vehicleSpec.plate,
      car_color: 'White',
      usage_type: vehicleSpec.usage,
      usage_type_verified: true,
      status: 'approved',
      active: true,
    });
  }
  console.log('Fleet vehicles ready (1 commercial + 1 private under Ram Travels)');

  // --- Rider ------------------------------------------------------------
  const riderExists = await User.findOne({ phone: '9100000001' });
  if (!riderExists) {
    await User.create({
      name: 'Amit Sharma',
      phone: '9100000001',
      email: 'amit@example.test',
    });
  }
  console.log('Rider ready: Amit Sharma (9100000001)');

  console.log('\nLocal test environment seeded.');
};

run()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
