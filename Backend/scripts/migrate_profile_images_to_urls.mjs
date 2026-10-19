/**
 * Moves driver photos stored as base64 data URLs out of the database.
 *
 * Older builds saved whatever the app sent as `profileImage` (and the admin
 * panel's `profile_picture`) straight onto the driver, so some drivers carry a
 * full `data:image/...;base64,...` string. Every GET /drivers/me then ships the
 * whole photo, and a corrupted one breaks the app's image decoder. New writes
 * are hosted as files already; this converts the rows written before that.
 *
 * For each driver whose profileImage / profile_picture / bannerImage is a data
 * URL, the image is decoded completely (a truncated JPEG fails here):
 *  - readable: re-encoded and hosted like a fresh upload, and the field is set
 *    to the URL;
 *  - unreadable: reported, and only cleared when --clear-broken is passed (the
 *    app cannot show it either way).
 * Each update is conditional on the field still holding the same string, so a
 * photo the driver changes meanwhile is never overwritten.
 *
 * Without --apply nothing is written: it only reports.
 *
 * Usage (from the Backend folder, on the server, so files land in the served
 * storage folder and STORAGE_BASE_URL from .env is used):
 *   node scripts/migrate_profile_images_to_urls.mjs
 *   node scripts/migrate_profile_images_to_urls.mjs --driver <driverId>
 *   node scripts/migrate_profile_images_to_urls.mjs --apply
 *   node scripts/migrate_profile_images_to_urls.mjs --apply --clear-broken
 */

import sharp from 'sharp';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDatabase } from '../src/config/database.js';
import { Driver } from '../src/modules/taxi/driver/models/Driver.js';
import { mediaService } from '../src/services/media.service.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const clearBroken = args.includes('--clear-broken');
const driverArg = args.indexOf('--driver');
const onlyDriverId = driverArg !== -1 ? String(args[driverArg + 1] || '').trim() : '';

const FIELDS = [
  { field: 'profileImage', mediaType: 'drivers' },
  { field: 'profile_picture', mediaType: 'drivers' },
  { field: 'bannerImage', mediaType: 'banners' },
];
const DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp));base64,/i;

const inspect = async (value) => {
  const match = String(value).match(DATA_URL);
  if (!match) {
    return { ok: false, reason: `unsupported type ${String(value).slice(5, String(value).indexOf(';')) || '?'}` };
  }
  const buffer = Buffer.from(String(value).slice(String(value).indexOf(',') + 1), 'base64');
  const info = { bytes: buffer.length };
  if (/jpe?g/i.test(match[1])) {
    info.jpegStart = buffer[0] === 0xff && buffer[1] === 0xd8;
    info.jpegEnd = buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  }
  try {
    // A full decode, not just metadata: a truncated JPEG still has a valid header.
    await sharp(buffer, { failOn: 'error' }).toBuffer();
    return { ok: true, ...info };
  } catch (error) {
    return { ok: false, reason: error.message, ...info };
  }
};

const run = async () => {
  if (apply && !(process.env.STORAGE_BASE_URL || env.storageBaseUrl)) {
    console.error('STORAGE_BASE_URL is not set: hosted URLs would point at localhost. Set it in .env first.');
    process.exit(1);
  }
  if (onlyDriverId && !mongoose.isValidObjectId(onlyDriverId)) {
    console.error(`Not a valid driver id: ${onlyDriverId}`);
    process.exit(1);
  }

  await connectDatabase();
  console.log(apply ? 'Mode: APPLY' : 'Mode: report only (nothing is written; add --apply to convert)');

  const filter = {
    $or: FIELDS.map(({ field }) => ({ [field]: { $regex: '^data:' } })),
    ...(onlyDriverId ? { _id: new mongoose.Types.ObjectId(onlyDriverId) } : {}),
  };
  const drivers = await Driver.find(filter)
    .select(`_id name phone ${FIELDS.map(({ field }) => field).join(' ')}`)
    .lean();
  console.log(`Drivers with a base64 image: ${drivers.length}\n`);

  const totals = { converted: 0, broken: 0, cleared: 0, skipped: 0 };

  for (const driver of drivers) {
    // profileImage and profile_picture often hold the same photo: host it once.
    const hostedByValue = new Map();

    for (const { field, mediaType } of FIELDS) {
      const value = driver[field];
      if (typeof value !== 'string' || !value.startsWith('data:')) continue;

      const result = await inspect(value);
      const label = `${driver._id} ${driver.name || ''} (${driver.phone || ''}) ${field}`;
      const details = [
        `${value.length} chars`,
        result.bytes !== undefined ? `${result.bytes} bytes` : '',
        result.jpegStart !== undefined ? `jpeg start ${result.jpegStart ? 'ok' : 'MISSING'}` : '',
        result.jpegEnd !== undefined ? `jpeg end ${result.jpegEnd ? 'ok' : 'MISSING (truncated)'}` : '',
      ].filter(Boolean).join(', ');

      if (!result.ok) {
        totals.broken += 1;
        console.log(`  BROKEN  ${label}: ${details}; ${result.reason}`);
        if (apply && clearBroken) {
          const cleared = await Driver.updateOne({ _id: driver._id, [field]: value }, { $set: { [field]: '' } });
          if (cleared.modifiedCount) totals.cleared += 1;
          console.log(`          ${cleared.modifiedCount ? 'cleared' : 'changed meanwhile, left alone'}`);
        }
        continue;
      }

      if (!apply) {
        console.log(`  OK      ${label}: ${details}`);
        continue;
      }

      const key = `${mediaType}:${value}`;
      let url = hostedByValue.get(key);
      if (!url) {
        url = (await mediaService.uploadMedia(value, mediaType)).url;
        hostedByValue.set(key, url);
      }
      const updated = await Driver.updateOne({ _id: driver._id, [field]: value }, { $set: { [field]: url } });
      if (updated.modifiedCount) {
        totals.converted += 1;
        console.log(`  HOSTED  ${label}: ${details} -> ${url}`);
      } else {
        totals.skipped += 1;
        console.log(`  SKIPPED ${label}: changed meanwhile, left alone`);
      }
    }
  }

  console.log(
    `\nconverted ${totals.converted}, broken ${totals.broken}` +
      `${apply && clearBroken ? `, cleared ${totals.cleared}` : ''}, skipped ${totals.skipped}`,
  );
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
