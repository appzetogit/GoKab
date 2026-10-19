/**
 * Smoke test: driver photos are stored as hosted URLs, never as base64.
 *
 *  1  PATCH /drivers/me with a profileImage data URL stores a hosted .webp URL,
 *     and GET /drivers/me returns that URL
 *  2  an image this server already hosts is kept; an outside URL and a
 *     truncated JPEG are refused; '' clears
 *  3  scripts/migrate_profile_images_to_urls.mjs reports a readable and a
 *     truncated base64 photo, hosts the readable one with --apply and clears
 *     the truncated one only with --clear-broken
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs. Restores Ramesh and Suresh's photos.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *   STORAGE_BASE_DIR=<server's dir> STORAGE_BASE_URL=http://127.0.0.1:4101 \
 *     node scripts/smoke_profile_image_urls.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import sharp from 'sharp';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const api = async (urlPath, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
};

const login = async (phone) =>
  (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data?.token;

const runMigration = (extraArgs = []) =>
  execFileSync(process.execPath, ['scripts/migrate_profile_images_to_urls.mjs', ...extraArgs], {
    cwd: BACKEND_DIR,
    env: { ...process.env, MONGODB_URI: DB_URI.replace('/gokab_sec', '/'), MONGODB_DB_NAME: 'gokab_sec' },
    encoding: 'utf8',
  });

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();
  const token = await login('9000000001');

  // A real 64x64 JPEG, and the same JPEG with its last 40% cut off.
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .toBuffer();
  const goodDataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const truncatedDataUrl = `data:image/jpeg;base64,${jpeg.subarray(0, Math.floor(jpeg.length * 0.6)).toString('base64')}`;

  try {
    console.log('\n1  PATCH /drivers/me stores a URL');
    const saved = await api('/drivers/me', { method: 'PATCH', token, body: { profileImage: goodDataUrl } });
    const url = saved.json?.data?.profileImage || '';
    check('data URL accepted', saved.status === 200, JSON.stringify(saved.json).slice(0, 200));
    check('stored as a hosted .webp URL, not base64', /^https?:\/\/.+\/images\/drivers\/.+\.webp$/.test(url), url.slice(0, 80));
    const me = await api('/drivers/me', { token });
    check('GET /drivers/me returns the URL', me.json?.data?.profileImage === url);
    const fetched = await fetch(url);
    check('the URL serves the image', fetched.status === 200, String(fetched.status));

    console.log('\n2  What else is accepted');
    const echoed = await api('/drivers/me', { method: 'PATCH', token, body: { profileImage: url } });
    check('echoing the hosted URL keeps it', echoed.json?.data?.profileImage === url);
    const outside = await api('/drivers/me', {
      method: 'PATCH', token, body: { profileImage: 'https://evil.example.com/images/x.jpg' },
    });
    check('an outside URL is refused (INVALID_PROFILE_IMAGE)', outside.status === 422
      && outside.json?.code === 'INVALID_PROFILE_IMAGE', JSON.stringify(outside.json));
    const truncated = await api('/drivers/me', { method: 'PATCH', token, body: { profileImage: truncatedDataUrl } });
    check('a truncated JPEG is refused, not stored', truncated.status === 422
      && truncated.json?.code === 'INVALID_PROFILE_IMAGE', JSON.stringify(truncated.json));
    check('...and the previous photo stays', (await Driver.findById(ramesh._id).lean()).profileImage === url);
    const cleared = await api('/drivers/me', { method: 'PATCH', token, body: { profileImage: '' } });
    check("'' clears the photo", cleared.status === 200 && cleared.json?.data?.profileImage === '');

    console.log('\n3  Migration of photos already stored as base64');
    await Driver.updateOne({ _id: ramesh._id }, { $set: { profileImage: goodDataUrl, profile_picture: goodDataUrl } });
    await Driver.updateOne({ _id: suresh._id }, { $set: { profileImage: truncatedDataUrl } });

    const report = runMigration();
    check('report mode writes nothing', report.includes('report only')
      && (await Driver.findById(ramesh._id).lean()).profileImage === goodDataUrl);
    check('report lists the readable photo as OK', new RegExp(`OK +${ramesh._id} .*profileImage`).test(report), report);
    check('report flags the truncated one, with the missing JPEG end',
      new RegExp(`BROKEN +${suresh._id} .*jpeg end MISSING`).test(report), report);

    const applied = runMigration(['--apply']);
    const rameshAfter = await Driver.findById(ramesh._id).lean();
    check('--apply hosts the readable photo', /\/images\/drivers\/.+\.webp$/.test(rameshAfter.profileImage),
      rameshAfter.profileImage?.slice(0, 80));
    check('profile_picture gets the same URL (hosted once)', rameshAfter.profile_picture === rameshAfter.profileImage);
    check('--apply leaves the broken one alone without --clear-broken',
      (await Driver.findById(suresh._id).lean()).profileImage === truncatedDataUrl, applied);

    runMigration(['--apply', '--clear-broken']);
    check('--clear-broken clears the unreadable photo', (await Driver.findById(suresh._id).lean()).profileImage === '');
    const again = runMigration();
    check('nothing left to convert afterwards', /Drivers with a base64 image: 0/.test(again), again);

    console.log('\n4  Rider photo: PATCH /users/me');
    const { User } = await import('../src/modules/taxi/user/models/User.js');
    const { signAccessToken } = await import('../src/modules/taxi/services/tokenService.js');
    const rider = await User.findOne({ phone: '9100000001' }).lean();
    const riderToken = signAccessToken({ sub: String(rider._id), role: 'user' });
    const riderSaved = await api('/users/me', { method: 'PATCH', token: riderToken, body: { profileImage: goodDataUrl } });
    const riderUrl = (await User.findById(rider._id).lean()).profileImage || '';
    check('rider data URL stored as a hosted URL', riderSaved.status === 200
      && /^https?:\/\/.+\/images\/users\/.+\.webp$/.test(riderUrl), `${riderSaved.status} ${riderUrl.slice(0, 80)}`);
    const riderBroken = await api('/users/me', { method: 'PATCH', token: riderToken, body: { profileImage: truncatedDataUrl } });
    check('rider truncated JPEG refused (INVALID_PROFILE_IMAGE)', riderBroken.status === 422
      && riderBroken.json?.code === 'INVALID_PROFILE_IMAGE', JSON.stringify(riderBroken.json));
    const riderUrlKept = await api('/users/me', { method: 'PATCH', token: riderToken, body: { profileImage: riderUrl } });
    check('a plain URL is still accepted for riders', riderUrlKept.status === 200
      && (await User.findById(rider._id).lean()).profileImage === riderUrl);
    await User.updateOne({ _id: rider._id }, { $set: { profileImage: rider.profileImage || '' } });
  } finally {
    await Driver.updateOne(
      { _id: ramesh._id },
      { $set: { profileImage: ramesh.profileImage || '', profile_picture: ramesh.profile_picture || '' } },
    );
    await Driver.updateOne({ _id: suresh._id }, { $set: { profileImage: suresh.profileImage || '' } });
    await mongoose.disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
