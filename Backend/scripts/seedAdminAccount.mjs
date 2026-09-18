/**
 * Seed script: create or update an admin account in any target database.
 *
 * Unlike `seedAdmin.js`, this one takes the target and the credentials from the
 * environment instead of hardcoding them, so the same script works against a
 * local replica set and against an Atlas cluster without being edited.
 *
 * Usage (PowerShell):
 *   $env:ADMIN_DB_URI='mongodb+srv://user:pass@host/'; $env:ADMIN_DB_NAME='gokab';
 *   $env:ADMIN_EMAIL='admin@gmail.com'; $env:ADMIN_PASSWORD='password';
 *   node scripts/seedAdminAccount.mjs
 *
 * Falls back to MONGODB_URI / MONGODB_DB_NAME from .env when the ADMIN_DB_*
 * variables are absent.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const URI = process.env.ADMIN_DB_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.ADMIN_DB_NAME || process.env.MONGODB_DB_NAME;
const EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const NAME = process.env.ADMIN_NAME || 'Super Admin';
const PHONE = process.env.ADMIN_PHONE || '9999999999';

if (!URI || !EMAIL || !PASSWORD) {
  console.error('Set ADMIN_DB_URI (or MONGODB_URI), ADMIN_EMAIL and ADMIN_PASSWORD first.');
  process.exit(1);
}
if (PASSWORD.length < 5) {
  console.error('ADMIN_PASSWORD must be at least 5 characters — the Admin schema enforces minlength 5.');
  process.exit(1);
}

// Node picks its resolvers from the OS. On machines whose resolver list is
// 127.0.0.1 with nothing listening there, the SRV lookup behind a
// `mongodb+srv://` URI fails with ECONNREFUSED before any connection is
// attempted, so allow an override.
if (process.env.ADMIN_DNS_SERVERS) {
  const dns = await import('node:dns');
  dns.setServers(process.env.ADMIN_DNS_SERVERS.split(',').map((entry) => entry.trim()));
}

const run = async () => {
  await mongoose.connect(URI, {
    ...(DB_NAME ? { dbName: DB_NAME } : {}),
    serverSelectionTimeoutMS: 20000,
  });
  console.log(`Connected to "${mongoose.connection.name}"`);

  const admins = mongoose.connection.collection('taxiadmins');
  const existing = await admins.findOne({ email: EMAIL });
  const now = new Date();

  await admins.updateOne(
    { email: EMAIL },
    {
      $set: {
        name: NAME,
        email: EMAIL,
        phone: PHONE,
        password: await bcrypt.hash(PASSWORD, 10),
        role: 'superadmin',
        admin_type: 'superadmin',
        permissions: ['*'],
        active: true,
        status: 'active',
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  const saved = await admins.findOne({ email: EMAIL });
  console.log(existing ? 'Existing admin updated.' : 'Admin created.');
  console.log('  _id     :', String(saved._id));
  console.log('  email   :', saved.email);
  console.log('  password:', (await bcrypt.compare(PASSWORD, saved.password)) ? 'verified' : 'MISMATCH');
  console.log('  role    :', saved.role, `(${saved.admin_type})`);
};

run()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
