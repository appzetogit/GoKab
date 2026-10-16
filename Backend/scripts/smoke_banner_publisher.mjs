/**
 * Smoke test for profile banners, publisher cards and the org-name fix.
 *
 *  1  PATCH /drivers/me bannerImage: re-encoded to webp, aspect ratio kept, ≤1600px wide
 *  2  banner input validation (foreign URL, GIF, fake bytes, alias, clear)
 *  3  onboarding personal step hosts the banner; completion copies it to the driver
 *  4  publisher card (profile_image, banner_image) on feed, network rides,
 *     upcoming and ride detail; legacy data-URL profile images are dropped
 *  5  PATCH /drivers/organization accepts { name }
 *
 * The server under test and this script must share STORAGE_BASE_DIR /
 * STORAGE_BASE_URL (the onboarding check uploads in-process).
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *   STORAGE_BASE_DIR=<server's dir> STORAGE_BASE_URL=http://127.0.0.1:4101 \
 *     node scripts/smoke_banner_publisher.mjs
 */

process.env.MONGODB_URI ||= process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';

import mongoose from 'mongoose';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const INDORE = [75.8577, 22.7196];
const BHOPAL = [77.4126, 23.2599];
const TAG = `smoke-banner-${Date.now()}`;

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

const api = async (path, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${API}${path}`, {
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
const loginAdmin = async () =>
  (await api('/admin/login', { method: 'POST', body: { email: 'admin@gmail.com', password: 'password' } })).json?.data?.token;

const pngDataUrl = async (width, height) => {
  const buffer = await sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
};

/** Downloads a stored image and reports what is actually on disk. */
const inspect = async (url) => {
  const response = await fetch(url);
  if (!response.ok) return { ok: false, status: response.status };
  const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  return { ok: true, format: meta.format, width: meta.width, height: meta.height };
};

const run = async () => {
  await mongoose.connect(DB_URI);
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { Owner } = await import('../src/modules/taxi/admin/models/Owner.js');
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { DriverRegistrationSession } = await import('../src/modules/taxi/driver/models/DriverRegistrationSession.js');
  const onboardingService = await import('../src/modules/taxi/driver/services/onboardingService.js');

  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const vikas = await Driver.findOne({ phone: '9000000003' }).lean();
  const originalOrg = ramesh.owner_id ? await Owner.findById(ramesh.owner_id).select('company_name').lean() : null;

  const adminToken = await loginAdmin();
  await api(`/admin/driver-network/drivers/${ramesh._id}/category`, { method: 'PATCH', token: adminToken, body: { category: 'prime' } });
  await Driver.updateMany({ _id: { $in: [ramesh._id, vikas._id] } }, { $set: { isOnRide: false } });

  const rameshToken = await login('9000000001');
  const vikasToken = await login('9000000003');
  const onboardingPhone = `95${String(Date.now()).slice(-8)}`;

  try {
    console.log('\n1  Banner via PATCH /drivers/me');
    const wide = await pngDataUrl(3000, 1000);
    const patched = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { bannerImage: wide } });
    const bannerUrl = patched.json?.data?.bannerImage;
    check('PATCH 200 and returns a hosted URL', patched.status === 200 && /^https?:\/\//.test(bannerUrl || ''), `${patched.status} ${JSON.stringify(patched.json).slice(0, 200)}`);
    check('stored under /banners/', /\/banners\//.test(bannerUrl || ''), bannerUrl);
    const wideFile = await inspect(bannerUrl);
    check('re-encoded as webp', wideFile.format === 'webp', JSON.stringify(wideFile));
    check('capped at 1600px wide, aspect kept (3:1 → 1600×533)', wideFile.width === 1600 && Math.abs(wideFile.height - 533) <= 1, `${wideFile.width}×${wideFile.height}`);
    const me = await api('/drivers/me', { token: rameshToken });
    check('GET /drivers/me returns bannerImage', me.json?.data?.bannerImage === bannerUrl);

    const portrait = await pngDataUrl(800, 1200);
    const portraitRes = await api('/drivers/me', { method: 'PATCH', token: vikasToken, body: { banner_image: portrait } });
    const portraitFile = await inspect(portraitRes.json?.data?.bannerImage);
    check('banner_image alias accepted', portraitRes.status === 200, JSON.stringify(portraitRes.json).slice(0, 200));
    check('small portrait not upscaled or cropped (800×1200)', portraitFile.width === 800 && portraitFile.height === 1200, `${portraitFile.width}×${portraitFile.height}`);

    console.log('\n2  Banner validation');
    const echo = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { bannerImage: bannerUrl } });
    check('echoing the current URL keeps it', echo.status === 200 && echo.json?.data?.bannerImage === bannerUrl);
    const foreign = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { bannerImage: 'https://evil.example/tracker.png' } });
    check('foreign URL → 422 INVALID_BANNER', foreign.status === 422 && foreign.json?.code === 'INVALID_BANNER', JSON.stringify(foreign.json));
    const gif = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { bannerImage: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } });
    check('GIF → 422 INVALID_BANNER', gif.json?.code === 'INVALID_BANNER', JSON.stringify(gif.json));
    const fake = await api('/drivers/me', { method: 'PATCH', token: rameshToken, body: { bannerImage: `data:image/png;base64,${Buffer.from('not an image at all').toString('base64')}` } });
    check('bytes that are not an image → 422 INVALID_BANNER', fake.json?.code === 'INVALID_BANNER', JSON.stringify(fake.json));
    check('banner unchanged after refused updates', (await Driver.findById(ramesh._id).lean()).bannerImage === bannerUrl);
    const cleared = await api('/drivers/me', { method: 'PATCH', token: vikasToken, body: { bannerImage: '' } });
    check("'' clears the banner", cleared.json?.data?.bannerImage === '');

    console.log('\n3  Onboarding');
    const registrationId = `banner-smoke-${onboardingPhone}`;
    await DriverRegistrationSession.create({
      registrationId,
      phone: onboardingPhone,
      role: 'driver',
      status: 'otp_verified',
      otpHash: 'x',
      otpExpiresAt: new Date(Date.now() + 3600_000),
      otpVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const personal = await onboardingService.saveDriverPersonalDetails({
      registrationId, phone: onboardingPhone, fullName: 'Banner Driver', email: `banner-${onboardingPhone}@example.test`,
      gender: 'male', password: 'password', bannerImage: await pngDataUrl(2000, 500),
    });
    const sessionBanner = personal?.personal?.bannerImage;
    check('personal step hosts the banner', /\/banners\//.test(sessionBanner || ''), sessionBanner);
    const stored = await DriverRegistrationSession.findOne({ registrationId }).lean();
    check('session stores the URL, not base64', stored.personal.bannerImage === sessionBanner);
    const repeat = await onboardingService.saveDriverPersonalDetails({
      registrationId, phone: onboardingPhone, fullName: 'Banner Driver', email: `banner-${onboardingPhone}@example.test`, gender: 'male', password: 'password',
    });
    check('re-saving the step without bannerImage keeps it', repeat.personal.bannerImage === sessionBanner);
    await onboardingService.saveDriverVehicle({
      registrationId, phone: onboardingPhone, vehicle_usage_type: 'private',
      locationId: String(ramesh.service_location_id), locationName: 'Indore', vehicleTypeId: new mongoose.Types.ObjectId(),
      make: 'Maruti', model: 'Alto', year: '2022', number: `MP09BN${onboardingPhone.slice(-4)}`, color: 'White',
    });
    const completion = await onboardingService.completeDriverOnboarding({
      registrationId, phone: onboardingPhone,
      documents: { rc: { secureUrl: 'https://example.test/rc.jpg', identifyNumber: `MP09BN${onboardingPhone.slice(-4)}`, expiryDate: '2030-06-15' } },
    });
    const newDriver = completion?.driver?.id ? await Driver.findById(completion.driver.id).lean() : null;
    check('completion copies the banner to the driver', newDriver?.bannerImage === sessionBanner, newDriver?.bannerImage);

    console.log('\n4  Publisher cards');
    // A legacy raw data URL in profileImage must never reach a list payload.
    await Driver.updateOne({ _id: ramesh._id }, { $set: { profileImage: wide } });
    const createRes = await api('/drivers/network/rides', {
      method: 'POST', token: rameshToken,
      body: {
        customer: { name: 'Banner Customer', phone: '9100000044' },
        pickup: { coordinates: INDORE, address: 'Vijay Nagar, Indore' },
        drop: { coordinates: BHOPAL, address: 'MP Nagar, Bhopal' },
        fare: 5000, paymentMethod: 'cash', notes: TAG,
      },
    });
    const rideId = createRes.json?.data?.id;
    await api(`/drivers/network/rides/${rideId}/publish`, {
      method: 'POST', token: rameshToken,
      body: { total_fare: 5000, owner_commission: 2000, driver_payout: 3000, is_secure: false },
    });
    const feedItem = ((await api('/drivers/feed?tab=driver', { token: vikasToken })).json?.data?.results || []).find((row) => row.id === rideId);
    check('feed publisher.banner_image', feedItem?.publisher?.banner_image === bannerUrl, JSON.stringify(feedItem?.publisher));
    check('feed publisher.profile_image drops a data URL', feedItem?.publisher?.profile_image === '');
    await Driver.updateOne({ _id: ramesh._id }, { $set: { profileImage: 'https://cdn.example.test/ramesh.webp' } });
    const feedAgain = ((await api('/drivers/feed?tab=driver', { token: vikasToken })).json?.data?.results || []).find((row) => row.id === rideId);
    check('feed publisher.profile_image passes a URL through', feedAgain?.publisher?.profile_image === 'https://cdn.example.test/ramesh.webp');
    const networkRow = ((await api('/drivers/network/rides?status=published', { token: rameshToken })).json?.data?.results || []).find((row) => row.id === rideId);
    check('network ride publisher card', networkRow?.publisher?.banner_image === bannerUrl && networkRow?.publisher?.id === String(ramesh._id), JSON.stringify(networkRow?.publisher));

    await api(`/drivers/feed/rides/${rideId}/accept`, { method: 'POST', token: vikasToken });
    const upcomingRow = ((await api('/drivers/rides/upcoming', { token: vikasToken })).json?.data?.results || []).find((row) => row.id === rideId);
    check('upcoming row publisher card', upcomingRow?.publisher?.banner_image === bannerUrl, JSON.stringify(upcomingRow?.publisher));
    const detail = await api(`/rides/${rideId}`, { token: vikasToken });
    check('ride detail publisher card', detail.json?.data?.publisher?.banner_image === bannerUrl && detail.json?.data?.publisher?.profile_image === 'https://cdn.example.test/ramesh.webp', JSON.stringify(detail.json?.data?.publisher));
    check('ride detail is_secure=false', detail.json?.data?.is_secure === false);

    console.log('\n5  Organization name');
    const renamed = await api('/drivers/organization', { method: 'PATCH', token: rameshToken, body: { name: 'Ram Tours' } });
    check('{ name } renames the org', renamed.status === 200 && renamed.json?.data?.company_name === 'Ram Tours' && renamed.json?.data?.name === 'Ram Tours', JSON.stringify(renamed.json));
    const detailAfter = await api(`/rides/${rideId}`, { token: vikasToken });
    check('new org name shows on the publisher card', detailAfter.json?.data?.publisher?.org_name === 'Ram Tours');
    const emptyName = await api('/drivers/organization', { method: 'PATCH', token: rameshToken, body: { name: '  ' } });
    check('blank name → 422 INVALID_ORG_NAME', emptyName.json?.code === 'INVALID_ORG_NAME', JSON.stringify(emptyName.json));
    const snake = await api('/drivers/organization', { method: 'PATCH', token: rameshToken, body: { company_name: 'Ram Travels' } });
    check('company_name still works', snake.json?.data?.company_name === 'Ram Travels');
  } finally {
    await Ride.deleteMany({ network_notes: TAG });
    await DriverRegistrationSession.deleteMany({ phone: onboardingPhone });
    await Driver.deleteMany({ phone: onboardingPhone });
    await Driver.updateOne({ _id: ramesh._id }, { $set: { profileImage: ramesh.profileImage || '', bannerImage: ramesh.bannerImage || '', isOnRide: false } });
    await Driver.updateOne({ _id: vikas._id }, { $set: { bannerImage: vikas.bannerImage || '', isOnRide: false } });
    if (originalOrg) await Owner.updateOne({ _id: originalOrg._id }, { $set: { company_name: originalOrg.company_name } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
