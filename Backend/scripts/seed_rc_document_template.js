/**
 * Seeds the vehicle Registration Certificate (RC) as a proper document
 * template — number, photo, and expiry date — for BOTH places a vehicle gets
 * added: a driver's own onboarding vehicle (registration) and a fleet
 * vehicle (POST /drivers/fleet/vehicles). Until this template exists, "rc" is
 * only ever a bare photo upload with no number/expiry capture or validation
 * anywhere in the app or admin panel.
 *
 * `applies_to: 'vehicle'` + `account_type: 'both'` covers both call sites —
 * the same admin-managed template list `addOwnerVehicle`/
 * `updateOwnerFleetVehicle` and `completeDriverOnboarding` already read from.
 * No new code path is needed for validation or admin display: the admin
 * driver/vehicle document view already renders every document's
 * `identify_number`/`expiry_date` generically (DriverDetails.jsx), and the
 * registration/fleet-vehicle required-document checks already enforce
 * `has_identify_number`/`has_expiry_date` for any `is_required` template.
 *
 * IMPORTANT — this makes RC mandatory everywhere a vehicle is added, the
 * moment it's applied. If the driver app (Flutter) hasn't been updated yet to
 * ask for an RC photo + number + expiry, registration and fleet vehicle
 * creation will start failing with "Missing required documents: rc" for
 * every driver until the app catches up. Coordinate the app release before
 * running this on production, or apply with RC_REQUIRED=false first and flip
 * it to required from the admin panel once the app is ready.
 *
 * Idempotent: re-running updates the same row rather than duplicating it.
 *
 * Usage:
 *   node scripts/seed_rc_document_template.js [--dry-run]
 *   RC_REQUIRED=false node scripts/seed_rc_document_template.js
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { DriverNeededDocument } from '../src/modules/taxi/admin/models/DriverNeededDocument.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const URI = process.env.RC_DOC_DB_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.RC_DOC_DB_NAME || process.env.MONGODB_DB_NAME;
const DRY_RUN = process.argv.includes('--dry-run');
const IS_REQUIRED = process.env.RC_REQUIRED !== 'false';

const RC_TEMPLATE = {
  template_type: 'document',
  name: 'RC (Registration Certificate)',
  slug: 'registration-certificate',
  key: 'rc',
  account_type: 'both',
  applies_to: 'vehicle',
  applies_when_usage_type: '',
  image_type: 'image',
  has_identify_number: true,
  identify_number_key: 'rc_number',
  has_expiry_date: true,
  is_required: IS_REQUIRED,
  is_editable: true,
  active: true,
  help_text: 'The vehicle’s Registration Certificate — number, photo, and expiry date.',
  sort_order: 10,
};

const run = async () => {
  if (!URI) {
    console.error('MONGODB_URI (or RC_DOC_DB_URI) must be set.');
    process.exit(1);
  }

  await mongoose.connect(URI, {
    ...(DB_NAME ? { dbName: DB_NAME } : {}),
    serverSelectionTimeoutMS: 20000,
  });
  console.log(`Connected to "${mongoose.connection.name}"${DRY_RUN ? ' (dry run)' : ''}\n`);

  const existing = await DriverNeededDocument.findOne({ slug: RC_TEMPLATE.slug });

  if (!existing) {
    console.log(`${DRY_RUN ? 'would create' : 'creating   '} "${RC_TEMPLATE.name}" -> ${JSON.stringify(RC_TEMPLATE)}`);
    if (!DRY_RUN) {
      await DriverNeededDocument.create(RC_TEMPLATE);
    }
  } else {
    const needsUpdate = Object.entries(RC_TEMPLATE).some(
      ([field, value]) => field !== 'name' && field !== 'slug' && String(existing[field]) !== String(value),
    );

    if (!needsUpdate) {
      console.log(`= "${existing.name}" already configured correctly`);
    } else {
      console.log(`${DRY_RUN ? 'would update' : 'updating   '} "${existing.name}" -> ${JSON.stringify(RC_TEMPLATE)}`);
      if (!DRY_RUN) {
        await DriverNeededDocument.updateOne({ _id: existing._id }, { $set: RC_TEMPLATE });
      }
    }
  }

  if (IS_REQUIRED) {
    console.log(
      '\n! is_required is true: registration and fleet-vehicle-add will now refuse to complete without an RC ' +
        'document (photo + number + expiry). Confirm the driver app already asks for this before/while applying ' +
        'this on production.',
    );
  }

  console.log(`\n${DRY_RUN ? 'Dry run — nothing was written.' : 'Done.'}`);
};

run()
  .catch((error) => {
    console.error('seed_rc_document_template failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
