/**
 * Rewrites asset URLs that were persisted with a localhost origin.
 *
 * `getPublicUrl()` in src/utils/storage.util.js falls back to
 * `http://localhost:<PORT>` when STORAGE_BASE_URL is unset and the caller has
 * no Express request to read the host from. That URL is stored on the document,
 * so every asset uploaded from such a path points at an origin that only exists
 * on the server itself. Setting STORAGE_BASE_URL fixes new uploads; this fixes
 * the rows already written.
 *
 * It walks every collection and rewrites any string, anywhere in a document
 * (including inside nested objects and arrays), whose value starts with one of
 * the bad origins. Field names are not hardcoded because these URLs are spread
 * across driver documents, vehicles, advertisements, documents and chat
 * attachments, and a missed field is an image that silently fails to load.
 *
 * Usage:
 *   node scripts/fix_localhost_asset_urls.js --dry-run
 *   node scripts/fix_localhost_asset_urls.js
 *   node scripts/fix_localhost_asset_urls.js --base-url https://gokab.in
 */

import mongoose from 'mongoose';
import dns from 'node:dns';
import { env } from '../src/config/env.js';

// Some hosts resolve DNS through a local stub that is not listening, which
// makes mongodb+srv:// lookups fail with ECONNREFUSED before any auth happens.
dns.setServers(['8.8.8.8', '1.1.1.1']);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const baseUrlArg = args.indexOf('--base-url');
const targetBase = (
  baseUrlArg !== -1 ? args[baseUrlArg + 1] : process.env.STORAGE_BASE_URL || env.storageBaseUrl
);

if (!targetBase) {
  console.error(
    'No target base URL. Set STORAGE_BASE_URL in .env or pass --base-url https://your-domain',
  );
  process.exit(1);
}

const cleanBase = String(targetBase).replace(/\/+$/, '');

// Every origin that could have been baked in: the configured port, the two
// common defaults, and both loopback spellings.
const ports = new Set([String(env.port), '5000', '4000']);
const hosts = ['localhost', '127.0.0.1', '0.0.0.0'];
const badOrigins = [];
for (const host of hosts) {
  for (const port of ports) {
    badOrigins.push(`http://${host}:${port}`);
    badOrigins.push(`https://${host}:${port}`);
  }
  badOrigins.push(`http://${host}`);
}

const rewrite = (value) => {
  for (const origin of badOrigins) {
    if (value.startsWith(origin)) {
      return cleanBase + value.slice(origin.length);
    }
  }
  return null;
};

/** Walks a value, rewriting matching strings in place. Returns how many changed. */
const walk = (node) => {
  let changed = 0;

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      if (typeof item === 'string') {
        const next = rewrite(item);
        if (next !== null) {
          node[index] = next;
          changed += 1;
        }
      } else if (item && typeof item === 'object') {
        changed += walk(item);
      }
    });
    return changed;
  }

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      const next = rewrite(value);
      if (next !== null) {
        node[key] = next;
        changed += 1;
      }
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      // Leave ObjectIds, Binary and other BSON wrappers alone: they have no
      // string fields of ours and rebuilding them loses their type.
      if (value._bsontype) continue;
      changed += walk(value);
    }
  }

  return changed;
};

const run = async () => {
  const uri = process.env.MONGODB_URI || env.mongoUri;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || env.mongoDbName });
  const db = mongoose.connection.db;
  console.log(`Connected to "${db.databaseName}"`);
  console.log(`Rewriting to: ${cleanBase}`);
  console.log(dryRun ? 'MODE: dry run, nothing will be written\n' : 'MODE: applying changes\n');

  const collections = await db.listCollections().toArray();
  let totalDocs = 0;
  let totalFields = 0;

  for (const { name } of collections) {
    const collection = db.collection(name);
    // Every document is walked rather than pre-filtered server side: these URLs
    // sit at different paths in every collection, and there is no index that
    // would make a match-anywhere query cheap. This is a one-time pass.
    const cursor = collection.find({});

    let docsInCollection = 0;
    let fieldsInCollection = 0;

    for await (const doc of cursor) {
      const { _id, ...rest } = doc;
      const changed = walk(rest);
      if (!changed) continue;

      docsInCollection += 1;
      fieldsInCollection += changed;

      if (!dryRun) {
        await collection.updateOne({ _id }, { $set: rest });
      }
    }

    if (docsInCollection) {
      console.log(
        `  ${name}: ${docsInCollection} document(s), ${fieldsInCollection} field(s)`,
      );
      totalDocs += docsInCollection;
      totalFields += fieldsInCollection;
    }
  }

  console.log(
    `\n${dryRun ? 'Would rewrite' : 'Rewrote'} ${totalFields} field(s) across ${totalDocs} document(s).`,
  );

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Failed:', error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
