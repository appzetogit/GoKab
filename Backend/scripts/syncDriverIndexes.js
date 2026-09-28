/**
 * Script to build/sync Driver indexes (specifically 2dsphere indexes required by $geoNear query).
 * 
 * When NODE_ENV=production, Mongoose autoIndex is disabled. If collection is created in production
 * or indexes were not built, running this script syncs the schema indexes (including `location` and
 * `routeBooking.anchorLocation` 2dsphere indexes).
 * 
 * Usage:
 *   node scripts/syncDriverIndexes.js
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectDatabase } from '../src/config/database.js';
import { Driver } from '../src/modules/taxi/driver/models/Driver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const syncIndexes = async () => {
  console.log('Connecting to database...');
  await connectDatabase();

  console.log('\n--- Current Indexes on `taxidrivers` ---');
  try {
    const existingIndexes = await Driver.collection.getIndexes();
    console.log(JSON.stringify(existingIndexes, null, 2));
  } catch (err) {
    console.log('Could not fetch existing indexes (collection might not exist yet):', err.message);
  }

  console.log('\nSyncing indexes for Driver model...');
  await Driver.syncIndexes();
  console.log('Driver indexes successfully synced.');

  console.log('\n--- Updated Indexes on `taxidrivers` ---');
  const updatedIndexes = await Driver.collection.getIndexes();
  console.log(JSON.stringify(updatedIndexes, null, 2));

  // Verify critical 2dsphere indexes exist
  const hasLocation2d = 'location_2dsphere' in updatedIndexes;
  const hasAnchor2d = 'routeBooking.anchorLocation_2dsphere' in updatedIndexes;

  console.log('\n--- 2dsphere Index Verification ---');
  console.log(`- location (2dsphere): ${hasLocation2d ? 'PRESENT' : 'MISSING'}`);
  console.log(`- routeBooking.anchorLocation (2dsphere): ${hasAnchor2d ? 'PRESENT' : 'MISSING'}`);

  if (hasLocation2d && hasAnchor2d) {
    console.log('\nSUCCESS: All required 2dsphere indexes are built and verified.');
  } else {
    console.warn('\nWARNING: One or more required 2dsphere indexes appear to be missing.');
  }
};

syncIndexes()
  .catch((err) => {
    console.error('Error syncing driver indexes:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    mongoose.disconnect();
  });
