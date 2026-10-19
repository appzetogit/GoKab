/**
 * Smoke test: uploads are reachable under /api/images, and stored
 * `<origin>/images/...` URLs are rewritten by
 * scripts/migrate_image_urls_to_api_path.mjs.
 *
 *  1  a new upload gets an `/api/images/` URL that serves the image; the
 *     same file is still served at `/images/`
 *  2  the migration reports old URLs without writing, rewrites them with
 *     --apply (top-level and nested), and leaves other strings alone
 *
 * Runs against a local backend + local database seeded by
 * scripts/seed_local_test_env.mjs. Restores what it changes.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *   STORAGE_BASE_DIR=<server's dir> STORAGE_BASE_URL=http://127.0.0.1:4101 \
 *     node scripts/smoke_image_url_path.mjs
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
const ORIGIN = new URL(API).origin;
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
  return { status: response.status, json: await response.json().catch(() => ({})) };
};

const runMigration = (extraArgs = []) =>
  execFileSync(process.execPath, ['scripts/migrate_image_urls_to_api_path.mjs', '--origin', ORIGIN, ...extraArgs], {
    cwd: BACKEND_DIR,
    env: { ...process.env, MONGODB_URI: DB_URI.replace('/gokab_sec', '/'), MONGODB_DB_NAME: 'gokab_sec' },
    encoding: 'utf8',
  });

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const token = (await api('/drivers/login', { method: 'POST', body: { phone: '9000000001', password: 'password' } }))
    .json?.data?.token;

  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 120, b: 200 } } })
    .png()
    .toBuffer();

  try {
    console.log('\n1  New uploads use /api/images');
    const saved = await api('/drivers/me', {
      method: 'PATCH', token, body: { profileImage: `data:image/png;base64,${png.toString('base64')}` },
    });
    const url = saved.json?.data?.profileImage || '';
    check('new URL is under /api/images', url.startsWith(`${ORIGIN}/api/images/drivers/`), url);
    const viaApi = await fetch(url);
    check('/api/images serves the image', viaApi.status === 200
      && String(viaApi.headers.get('content-type')).startsWith('image/'), `${viaApi.status} ${viaApi.headers.get('content-type')}`);
    const viaOld = await fetch(url.replace('/api/images/', '/images/'));
    check('the old /images path still serves it', viaOld.status === 200
      && String(viaOld.headers.get('content-type')).startsWith('image/'));
    const echoed = await api('/drivers/me', { method: 'PATCH', token, body: { profileImage: url } });
    check('an /api/images URL counts as our own (echo kept)', echoed.json?.data?.profileImage === url);

    console.log('\n2  Migrating stored /images URLs');
    const oldUrl = url.replace('/api/images/', '/images/');
    const outsideUrl = 'https://cdn.example.com/images/keep-me.webp';
    await Driver.updateOne(
      { _id: ramesh._id },
      {
        $set: {
          profileImage: oldUrl,
          'documents.smoke_url_path': { previewUrl: oldUrl, images: [oldUrl, outsideUrl] },
        },
      },
    );

    const report = runMigration();
    check('report mode writes nothing', report.includes('report only')
      && (await Driver.findById(ramesh._id).lean()).profileImage === oldUrl, report);
    check('report counts the driver document', /taxidrivers: \d+ document/.test(report), report);

    runMigration(['--apply']);
    const after = await Driver.findById(ramesh._id).lean();
    check('--apply rewrites the top-level URL', after.profileImage === url, after.profileImage);
    check('--apply rewrites nested URLs', after.documents?.smoke_url_path?.previewUrl === url
      && after.documents?.smoke_url_path?.images?.[0] === url);
    check('URLs on other hosts are left alone', after.documents?.smoke_url_path?.images?.[1] === outsideUrl);
    const rerun = runMigration();
    check('a second run finds nothing in the driver', !/taxidrivers:/.test(rerun), rerun);
  } finally {
    await Driver.updateOne(
      { _id: ramesh._id },
      { $set: { profileImage: ramesh.profileImage || '' }, $unset: { 'documents.smoke_url_path': '' } },
    );
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
