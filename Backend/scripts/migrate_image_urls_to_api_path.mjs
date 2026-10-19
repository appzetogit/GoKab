/**
 * Rewrites stored asset URLs from `<origin>/images/...` to
 * `<origin>/api/images/...`.
 *
 * On gokab.in nginx forwards only `/api/*` to the backend and answers every
 * other path with the website's index.html, so `https://gokab.in/images/x.webp`
 * returns HTML, not the image. The backend now also serves uploads under
 * `/api/images` and issues new URLs there; this updates the URLs already
 * stored.
 *
 * Every string in every collection that starts with `<origin>/images/` is
 * rewritten, wherever it sits in the document (driver photos, documents,
 * vehicle images, ads, chat attachments...). Only the changed fields are
 * written, and only while they still hold the old value, so concurrent edits
 * are never overwritten.
 *
 * Without --apply nothing is written: it only reports.
 *
 * Usage (from the Backend folder on the server):
 *   node scripts/migrate_image_urls_to_api_path.mjs
 *   node scripts/migrate_image_urls_to_api_path.mjs --apply
 *   node scripts/migrate_image_urls_to_api_path.mjs --origin https://gokab.in --apply
 */

import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { getPublicImagePath } from '../src/utils/storage.util.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const origins = args
  .map((value, index) => (value === '--origin' ? args[index + 1] : null))
  .filter(Boolean);
if (!origins.length && (process.env.STORAGE_BASE_URL || env.storageBaseUrl)) {
  origins.push(process.env.STORAGE_BASE_URL || env.storageBaseUrl);
}

const targetPath = getPublicImagePath();
const rules = origins
  .map((origin) => String(origin).trim().replace(/\/+$/, ''))
  .filter(Boolean)
  .map((origin) => ({ from: `${origin}/images/`, to: `${origin}${targetPath}/` }))
  .filter((rule) => rule.from !== rule.to);

const rewrite = (value) => {
  for (const rule of rules) {
    if (value.startsWith(rule.from)) return rule.to + value.slice(rule.from.length);
  }
  return null;
};

/** Collects { path, from, to } for every string that needs rewriting. */
const collect = (node, prefix, changes) => {
  const entries = Array.isArray(node) ? node.map((value, index) => [index, value]) : Object.entries(node);
  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : String(key);
    if (typeof value === 'string') {
      const next = rewrite(value);
      if (next !== null) changes.push({ path, from: value, to: next });
    } else if (value && typeof value === 'object' && !(value instanceof Date) && !value._bsontype) {
      collect(value, path, changes);
    }
  }
  return changes;
};

const run = async () => {
  if (!rules.length) {
    console.error('No origin to rewrite. Set STORAGE_BASE_URL in .env or pass --origin https://your-domain');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || env.mongoUri, {
    dbName: process.env.MONGODB_DB_NAME || env.mongoDbName,
  });
  const db = mongoose.connection.db;
  console.log(`Connected to "${db.databaseName}"`);
  for (const rule of rules) console.log(`Rewriting ${rule.from}…  ->  ${rule.to}…`);
  console.log(apply ? 'Mode: APPLY\n' : 'Mode: report only (nothing is written; add --apply to rewrite)\n');

  const collections = (await db.listCollections().toArray()).filter(({ name }) => !name.startsWith('system.'));
  const totals = { docs: 0, fields: 0, skipped: 0 };
  let samplesShown = 0;

  for (const { name } of collections) {
    const collection = db.collection(name);
    let docs = 0;
    let fields = 0;

    for await (const doc of collection.find({})) {
      const { _id, ...rest } = doc;
      const changes = collect(rest, '', []);
      if (!changes.length) continue;

      if (samplesShown < 5) {
        console.log(`  e.g. ${name}.${changes[0].path}: ${changes[0].from}  ->  ${changes[0].to}`);
        samplesShown += 1;
      }

      if (apply) {
        const result = await collection.updateOne(
          { _id, ...Object.fromEntries(changes.map((change) => [change.path, change.from])) },
          { $set: Object.fromEntries(changes.map((change) => [change.path, change.to])) },
        );
        if (!result.matchedCount) {
          totals.skipped += 1;
          continue;
        }
      }
      docs += 1;
      fields += changes.length;
    }

    if (docs) {
      console.log(`  ${name}: ${docs} document(s), ${fields} URL(s)`);
      totals.docs += docs;
      totals.fields += fields;
    }
  }

  console.log(
    `\n${apply ? 'Rewrote' : 'Would rewrite'} ${totals.fields} URL(s) across ${totals.docs} document(s)` +
      `${totals.skipped ? `; ${totals.skipped} document(s) changed meanwhile and were left alone` : ''}.`,
  );
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
