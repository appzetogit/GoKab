import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { mediaService } from '../src/services/media.service.js';

dotenv.config();

const getCategoryFromCollection = (collectionName) => {
  const name = collectionName.toLowerCase();
  if (name.includes('user')) return 'users';
  if (name.includes('driver')) return 'drivers';
  if (name.includes('vehicle')) return 'vehicles';
  if (name.includes('banner') || name.includes('advertisement') || name.includes('promo')) return 'advertisements';
  if (name.includes('logo') || name.includes('branding')) return 'logos';
  return 'documents';
};

// Check if a field supports storing the full metadata object
const shouldStoreFullMetadata = (collectionName, fieldPath) => {
  const col = collectionName.toLowerCase();
  const path = fieldPath.toLowerCase();

  if (col.includes('user') && path === 'profileimage') return true;
  if (col.includes('driver')) {
    if (path === 'profile_picture' || path === 'profileimage' || path === 'vehicleimage') return true;
  }
  if (col.includes('banner') && path === 'image') return true;
  if (col.includes('advertisement') && path === 'mediaurl') return true;

  return false;
};

// Download file from Cloudinary and save to VPS storage
const migrateUrl = async (cloudinaryUrl, category, storeFullMetadata, collectionName, fieldPath) => {
  try {
    console.log(`Downloading: ${cloudinaryUrl}`);
    const response = await fetch(cloudinaryUrl);
    if (!response.ok) {
      throw new Error(`Failed to download: HTTP ${response.status}`);
    }

    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());

    console.log(`Uploading locally as category "${category}" (Mime: ${mimeType})...`);
    const metadata = await mediaService.uploadMedia(buffer, category, mimeType);
    console.log(`Uploaded successfully! Local URL: ${metadata.url}`);

    if (storeFullMetadata) {
      return metadata; // Returns full metadata object { url, filename, storage, etc. }
    }
    return metadata.url; // Returns plain URL string
  } catch (error) {
    console.error(`Migration failed for URL: ${cloudinaryUrl}`, error.message);
    return null; // Return null so we don't update the record with bad data
  }
};

// Recursively scan object fields for Cloudinary URLs
const scanAndMigrateFields = async (doc, collectionName, currentPath = '') => {
  let updated = false;

  for (const [key, value] of Object.entries(doc)) {
    const fieldPath = currentPath ? `${currentPath}.${key}` : key;

    if (typeof value === 'string' && value.includes('cloudinary.com')) {
      const category = getCategoryFromCollection(collectionName);
      const storeMetadata = shouldStoreFullMetadata(collectionName, fieldPath);
      const migrated = await migrateUrl(value, category, storeMetadata, collectionName, fieldPath);
      
      if (migrated) {
        doc[key] = migrated;
        updated = true;
      }
    } else if (value && typeof value === 'object') {
      // Handle array of strings or nested objects
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] === 'string' && value[i].includes('cloudinary.com')) {
            const category = getCategoryFromCollection(collectionName);
            // Array items usually expect URLs (strings), not metadata objects
            const migrated = await migrateUrl(value[i], category, false, collectionName, `${fieldPath}[${i}]`);
            if (migrated) {
              value[i] = migrated;
              updated = true;
            }
          } else if (value[i] && typeof value[i] === 'object') {
            const subUpdated = await scanAndMigrateFields(value[i], collectionName, `${fieldPath}[${i}]`);
            if (subUpdated) updated = true;
          }
        }
      } else {
        const subUpdated = await scanAndMigrateFields(value, collectionName, fieldPath);
        if (subUpdated) updated = true;
      }
    }
  }

  return updated;
};

const runMigration = async () => {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Error: MONGODB_URI is not set in environment.');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await mongoose.connect(mongoUri);
  console.log('Connected!');

  const db = mongoose.connection.db;
  const collections = await db.collections();
  console.log(`Found ${collections.length} collections.`);

  let totalMigrated = 0;

  for (const col of collections) {
    const collectionName = col.collectionName;
    
    // Skip system/read-only collections
    if (collectionName.startsWith('system.') || collectionName === 'fs.files' || collectionName === 'fs.chunks') {
      continue;
    }

    console.log(`\nScanning collection: ${collectionName}...`);

    const cursor = col.find({
      $or: [
        { [Symbol.toPrimitive]: () => true }, // Fallback to match all for scanning
        { $text: { $search: 'cloudinary.com' } } // MongoDB text search fallback if indexed
      ]
    });

    let count = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      // Check if document contains any cloudinary references
      const stringified = JSON.stringify(doc);
      if (!stringified.includes('cloudinary.com')) {
        continue;
      }

      console.log(`Document found with Cloudinary reference: ID ${doc._id}`);
      const updatedDoc = { ...doc };
      const isUpdated = await scanAndMigrateFields(updatedDoc, collectionName);

      if (isUpdated) {
        await col.replaceOne({ _id: doc._id }, updatedDoc);
        console.log(`Saved document ${doc._id} updates.`);
        count++;
        totalMigrated++;
      }
    }

    console.log(`Collection ${collectionName} complete. Migrated ${count} documents.`);
  }

  console.log(`\nMigration completed successfully! Total documents updated: ${totalMigrated}`);
  await mongoose.disconnect();
  process.exit(0);
};

runMigration().catch((error) => {
  console.error('Migration crashed:', error);
  process.exit(1);
});
