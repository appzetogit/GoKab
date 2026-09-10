import http from 'node:http';

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { signAccessToken } from './modules/taxi/services/tokenService.js';
import { Admin } from './modules/taxi/admin/models/Admin.js';
import mongoose from 'mongoose';
import { env } from './config/env.js';

const makeRequest = (path, method = 'GET', body = null, token = '') => {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (data) {
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: `/api/v1${path}`,
        method,
        headers,
      },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(bodyStr) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, rawBody: bodyStr });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
};

const getAccountTypeLabel = (driver) => {
  const role = String(
    driver?.account_type ||
    driver?.onboarding_role ||
    driver?.onboarding?.session?.role ||
    driver?.role ||
    driver?.accountType ||
    ''
  ).toLowerCase();

  if (['super_fleet_owner', 'service_center', 'service_center_staff'].includes(role)) {
    return 'Super Fleet Owner';
  }
  if (['vendor', 'owner', 'fleet_owner', 'owners'].includes(role)) {
    return 'Vendor';
  }
  return 'Driver';
};

const runAudit = async () => {
  console.log('--- STARTING PENDING DRIVERS & APPLICANTS AUDIT ---\n');

  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName || 'gokab' });

  const admins = await Admin.find().lean();
  console.log(`Found ${admins.length} admins in database (dbName: ${env.mongoDbName || 'gokab'}):`);
  admins.forEach(a => console.log(` - ID=${a._id}, Email=${a.email}, Role=${a.role}`));

  if (admins.length > 0) {
    const target = admins[0];
    const token = signAccessToken({ sub: String(target._id), role: 'admin' });
    console.log(`Testing token for Admin ID=${target._id}...`);

    const res = await makeRequest('/admin/drivers?approve=false&limit=50', 'GET', null, token);
    console.log(`[GET /admin/drivers?approve=false] HTTP ${res.statusCode}`);
    const list = res.body?.data?.results || res.body?.results || [];
    console.log(`Total Pending Applicants fetched: ${list.length}`);

    const counts = { Driver: 0, Vendor: 0, 'Super Fleet Owner': 0 };
    list.forEach((item, index) => {
      const type = getAccountTypeLabel(item);
      counts[type] = (counts[type] || 0) + 1;
      if (index < 10) {
        console.log(`Applicant #${index + 1}: Name="${item.name}", Phone=${item.phone}, Code=${item.driver_code || item.referralCode}, Role="${item.onboarding_role || item.account_type || 'driver'}", Computed AccountType="${type}"`);
      }
    });

    console.log('\n--- ACCOUNT TYPE BREAKDOWN ---');
    console.log(JSON.stringify(counts, null, 2));

    if (list.length > 0) {
      const firstId = list[0]._id || list[0].id;
      console.log(`\nFetching detail profile for first pending applicant (ID: ${firstId})...`);
      const profileRes = await makeRequest(`/admin/drivers/${firstId}/profile`, 'GET', null, token);
      console.log(`[GET /admin/drivers/${firstId}/profile] HTTP ${profileRes.statusCode}`);
      const profile = profileRes.body?.data || profileRes.body;
      console.log('Profile Account Type:', getAccountTypeLabel(profile));
      console.log('Profile Vehicle Summary:', profile?.vehicle || profile?.onboarding?.vehicle);
      console.log('Profile Uploaded Documents count:', Object.keys(profile?.documents || {}).length);
    }
  }

  await mongoose.disconnect();
  console.log('\n--- PENDING DRIVERS AUDIT COMPLETED SUCCESSFULLY ---');
};

runAudit().catch((err) => {
  console.error(err);
  mongoose.disconnect();
});
