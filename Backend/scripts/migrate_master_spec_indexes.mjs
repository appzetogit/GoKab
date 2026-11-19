/**
 * Builds the indexes the driver-app master spec relies on. Production runs
 * with autoIndex off, so without this the unique indexes that make ride
 * requests and bill numbers safe under concurrent requests would not exist.
 *
 * Only creates missing indexes; never drops or rebuilds existing ones.
 *
 * Usage (from the Backend folder):
 *   node scripts/migrate_master_spec_indexes.mjs
 */

import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/database.js';
import { Ride } from '../src/modules/taxi/user/models/Ride.js';
import { RideRequest } from '../src/modules/taxi/driver/models/RideRequest.js';
import { DriverBill, DriverBillCounter } from '../src/modules/taxi/driver/models/DriverBill.js';

const run = async () => {
  await connectDatabase();

  for (const [name, model] of [
    ['TaxiRideRequest', RideRequest],
    ['TaxiDriverBill', DriverBill],
    ['TaxiDriverBillCounter', DriverBillCounter],
    ['TaxiRide', Ride],
  ]) {
    await model.createIndexes();
    const indexes = await model.collection.indexes();
    console.log(`${name}: ${indexes.length} index(es) present`);
  }

  console.log('indexes ok');
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
