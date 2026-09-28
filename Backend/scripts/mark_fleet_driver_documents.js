/**
 * One-time admin-data fix for the Fleet Drivers CRUD spec (§2): the fleet
 * "Add Driver" document form reads required documents from the same
 * `DriverNeededDocument` templates the driver app already uses (Driving
 * Licence, Aadhaar, PAN, ...). If those templates aren't scoped to fleet
 * drivers, the Add Driver screen shows no documents at all.
 *
 * This script finds existing driver-scoped (`applies_to: 'driver'`) document
 * templates whose name looks like Driving Licence / Aadhaar / PAN and marks
 * them `account_type: 'both'`, `is_required: true` (Driving Licence also gets
 * `has_identify_number: true, has_expiry_date: true`; Aadhaar and PAN get
 * `has_identify_number: true`). It never creates a template — if a
 * deployment doesn't have one of these three yet, it's listed as a manual
 * admin-panel task instead, since inventing document requirements isn't this
 * script's call to make.
 *
 * Idempotent: matches only need updating once; re-running is a no-op.
 *
 * Usage:
 *   node scripts/mark_fleet_driver_documents.js [--dry-run]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { DriverNeededDocument } from '../src/modules/taxi/admin/models/DriverNeededDocument.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const URI = process.env.FLEET_DOC_DB_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.FLEET_DOC_DB_NAME || process.env.MONGODB_DB_NAME;
const DRY_RUN = process.argv.includes('--dry-run');

const MATCHERS = [
  {
    label: 'Driving Licence',
    pattern: /driv(e|ing)?[\s_-]*licen[sc]e|\bdl\b/i,
    fields: { has_identify_number: true, has_expiry_date: true },
  },
  {
    label: 'Aadhaar',
    pattern: /aadh?a+r/i,
    fields: { has_identify_number: true },
  },
  {
    label: 'PAN',
    pattern: /\bpan\b/i,
    fields: { has_identify_number: true },
  },
];

const run = async () => {
  if (!URI) {
    console.error('MONGODB_URI (or FLEET_DOC_DB_URI) must be set.');
    process.exit(1);
  }

  await mongoose.connect(URI, {
    ...(DB_NAME ? { dbName: DB_NAME } : {}),
    serverSelectionTimeoutMS: 20000,
  });
  console.log(`Connected to "${mongoose.connection.name}"${DRY_RUN ? ' (dry run)' : ''}\n`);

  const candidates = await DriverNeededDocument.find({
    template_type: { $in: ['document', null] },
    $or: [{ applies_to: 'driver' }, { applies_to: { $exists: false } }],
  });

  const matchedLabels = new Set();

  for (const matcher of MATCHERS) {
    const matches = candidates.filter((item) => matcher.pattern.test(item.name || item.slug || ''));

    if (matches.length === 0) {
      continue;
    }

    matchedLabels.add(matcher.label);

    for (const item of matches) {
      const desired = {
        applies_to: 'driver',
        account_type: 'both',
        is_required: true,
        ...matcher.fields,
      };
      const needsUpdate = Object.entries(desired).some(
        ([key, value]) => String(item[key]) !== String(value),
      );

      if (!needsUpdate) {
        console.log(`= "${item.name}" already scoped for fleet drivers`);
        continue;
      }

      console.log(
        `${DRY_RUN ? 'would update' : 'updating   '} "${item.name}" (${matcher.label}) -> ${JSON.stringify(desired)}`,
      );

      if (!DRY_RUN) {
        await DriverNeededDocument.updateOne({ _id: item._id }, { $set: desired });
      }
    }
  }

  for (const matcher of MATCHERS) {
    if (!matchedLabels.has(matcher.label)) {
      console.log(
        `! No existing document template looks like "${matcher.label}" — create one from the admin panel ` +
          `(applies_to: 'driver', account_type: 'both', is_required: true) before the fleet Add Driver form will ask for it.`,
      );
    }
  }

  console.log(`\n${DRY_RUN ? 'Dry run — nothing was written.' : 'Done.'}`);
};

run()
  .catch((error) => {
    console.error('mark_fleet_driver_documents failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
