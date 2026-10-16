/**
 * Smoke test for the security cleanup (plan §0).
 *
 *  A  OTPs: crypto-random, static OTP from env only, debugOtp opt-in
 *  B  Razorpay helpers: test-mode gate, timing-safe compare, raw-body webhook HMAC
 *  C  HTTP: subscription webhook signature over the raw bytes
 *  D  HTTP: forged order_test_/pay_test_ wallet top-up is rejected
 *  E  HTTP: /on-boarding writes need an admin token
 *  F  Socket: blocked / pending drivers cannot connect
 *
 * The server under test must run WITHOUT RAZORPAY_ALLOW_TEST_MODE and
 * EXPOSE_DEBUG_OTP, with RAZORPAY_WEBHOOK_SECRET=whsec_smoke, against a local
 * database seeded by scripts/seed_local_test_env.mjs.
 *
 * Usage:
 *   SMOKE_API=http://127.0.0.1:4101/api/v1 \
 *   SMOKE_DB_URI=mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0 \
 *     node scripts/smoke_security_hardening.mjs
 */

import crypto from 'node:crypto';

// Read once by config/env.js — must be set before anything imports it.
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27041/gokab_sec?replicaSet=rs0';
process.env.JWT_SECRET ||= 'smoke-only-jwt-secret';
process.env.USE_DEFAULT_OTP = 'false';
process.env.STATIC_OTP_PHONE = '9000000004';
process.env.STATIC_OTP_CODE = '4321';
delete process.env.EXPOSE_DEBUG_OTP;
delete process.env.RAZORPAY_ALLOW_TEST_MODE;

import mongoose from 'mongoose';

const { io: socketClient } = await import('../../frontend/node_modules/socket.io-client/build/cjs/index.js');

const API = process.env.SMOKE_API || 'http://127.0.0.1:4101/api/v1';
const SOCKET_URL = process.env.SMOKE_SOCKET || API.replace(/\/api\/v1$/, '');
const DB_URI = process.env.SMOKE_DB_URI || process.env.MONGODB_URI;
const WEBHOOK_SECRET = process.env.SMOKE_WEBHOOK_SECRET || 'whsec_smoke';

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

const api = async (path, { method = 'GET', token, body, rawBody, headers = {} } = {}) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(rawBody !== undefined ? { body: rawBody } : body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
};

const login = async (phone) =>
  (await api('/drivers/login', { method: 'POST', body: { phone, password: 'password' } })).json?.data?.token;

const trySocket = (token) =>
  new Promise((resolve) => {
    const socket = socketClient(SOCKET_URL, { auth: { token }, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => {
      socket.close();
      resolve({ connected: false, error: 'timeout' });
    }, 8000);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.close();
      resolve({ connected: true });
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      socket.close();
      resolve({ connected: false, error: error?.message });
    });
  });

const run = async () => {
  await mongoose.connect(DB_URI);
  const otp = await import('../src/modules/taxi/services/otpSecurity.js');
  const rzp = await import('../src/modules/taxi/services/razorpaySecurity.js');
  const { startDriverLoginOtp } = await import('../src/modules/taxi/driver/services/loginOtpService.js');
  const { DriverLoginSession } = await import('../src/modules/taxi/driver/models/DriverLoginSession.js');
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { signAccessToken } = await import('../src/modules/taxi/services/tokenService.js');

  console.log('\nA  OTPs');
  const samples = Array.from({ length: 200 }, () => otp.generateOtp());
  check('generateOtp is always 4 digits 1000-9999', samples.every((v) => /^[1-9]\d{3}$/.test(v)));
  check('generateOtp is not constant', new Set(samples).size > 50);
  const oldTestPhone = otp.resolveOtpForPhone('6268423925');
  check('old hardcoded test phone no longer gets a static OTP', oldTestPhone.isStatic === false && oldTestPhone.otp !== '0000');
  const envPhone = otp.resolveOtpForPhone('9000000004');
  check('STATIC_OTP_PHONE from env gets STATIC_OTP_CODE', envPhone.isStatic && envPhone.otp === '4321');
  check('debugOtp hidden by default', otp.getVisibleOtp('1234') === null);
  process.env.EXPOSE_DEBUG_OTP = 'true';
  check('debugOtp shown with EXPOSE_DEBUG_OTP=true', otp.getVisibleOtp('1234') === '1234');
  const savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  check('debugOtp never shown in production even with the flag', otp.getVisibleOtp('1234') === null);
  process.env.NODE_ENV = savedNodeEnv;
  delete process.env.EXPOSE_DEBUG_OTP;

  await DriverLoginSession.deleteMany({ phone: '9000000004' });
  const loginStart = await startDriverLoginOtp({ phone: '9000000004' });
  check('driver login OTP response carries no debugOtp by default', loginStart?.session?.debugOtp === null, JSON.stringify(loginStart?.session));
  await DriverLoginSession.deleteMany({ phone: '9000000004' });

  console.log('\nB  Razorpay helpers');
  check('order_test_ is not a test payment without the flag', rzp.isRazorpayTestPayment('order_test_x', 'pay_test_y') === false);
  process.env.RAZORPAY_ALLOW_TEST_MODE = 'true';
  check('order_test_ is a test payment with RAZORPAY_ALLOW_TEST_MODE=true', rzp.isRazorpayTestPayment('order_test_x', 'pay_x'));
  process.env.NODE_ENV = 'production';
  check('test mode is never honoured in production', rzp.isRazorpayTestPayment('order_test_x', 'pay_test_y') === false);
  process.env.NODE_ENV = savedNodeEnv;
  delete process.env.RAZORPAY_ALLOW_TEST_MODE;
  const sig = crypto.createHmac('sha256', 'k').update('order_1|pay_1').digest('hex');
  check('valid payment signature accepted', rzp.isValidRazorpayPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig, keySecret: 'k' }));
  check('wrong payment signature rejected', !rzp.isValidRazorpayPaymentSignature({ orderId: 'order_1', paymentId: 'pay_2', signature: sig, keySecret: 'k' }));
  check('empty key secret rejects everything', !rzp.isValidRazorpayPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig, keySecret: '' }));
  check('safeEqualHex handles length mismatch', rzp.safeEqualHex('abcd', 'abc') === false);

  console.log('\nC  Subscription webhook (raw body)');
  // Deliberately not JSON.stringify's formatting, as Razorpay's bytes won't be either.
  const raw = '{ "event": "payment.authorized",  "payload": { "note": "caf\\u00e9" } }';
  const rawSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  const restringifiedSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(JSON.parse(raw))).digest('hex');
  const hookOk = await api('/drivers/webhooks/razorpay', { method: 'POST', rawBody: raw, headers: { 'x-razorpay-signature': rawSig } });
  check('webhook signed over raw bytes → 200', hookOk.status === 200, `${hookOk.status} ${JSON.stringify(hookOk.json)}`);
  const hookRestringified = await api('/drivers/webhooks/razorpay', { method: 'POST', rawBody: raw, headers: { 'x-razorpay-signature': restringifiedSig } });
  check('signature over re-stringified JSON → 400', hookRestringified.status === 400, String(hookRestringified.status));
  const hookNoSig = await api('/drivers/webhooks/razorpay', { method: 'POST', rawBody: raw });
  check('webhook without signature → 400', hookNoSig.status === 400, String(hookNoSig.status));
  const oldDefaultSig = crypto.createHmac('sha256', 'secret123').update(raw).digest('hex');
  const hookOldSecret = await api('/drivers/webhooks/razorpay', { method: 'POST', rawBody: raw, headers: { 'x-razorpay-signature': oldDefaultSig } });
  check("old 'secret123' default no longer accepted", hookOldSecret.status === 400, String(hookOldSecret.status));

  console.log('\nD  Forged test-mode wallet top-up');
  const rameshToken = await login('9000000001');
  check('driver login works', Boolean(rameshToken));
  const ramesh = await Driver.findOne({ phone: '9000000001' }).lean();
  const balanceBefore = Number(ramesh?.wallet?.balance || 0);
  const forged = await api('/drivers/wallet/top-up/razorpay/verify', {
    method: 'POST',
    token: rameshToken,
    body: { razorpay_order_id: 'order_test_forged', razorpay_payment_id: `pay_test_${Date.now()}`, amount: 5000000 },
  });
  check('forged order_test_/pay_test_ verify is rejected', forged.status >= 400, `${forged.status} ${JSON.stringify(forged.json)}`);
  const rameshAfter = await Driver.findOne({ phone: '9000000001' }).lean();
  check('wallet balance unchanged', Number(rameshAfter?.wallet?.balance || 0) === balanceBefore);

  console.log('\nE  /on-boarding writes');
  const noAuthCreate = await api('/on-boarding', { method: 'POST', body: { title: 'x' } });
  check('POST /on-boarding without token → 401', noAuthCreate.status === 401, String(noAuthCreate.status));
  const noAuthPatch = await api(`/on-boarding/${new mongoose.Types.ObjectId()}`, { method: 'PATCH', body: { title: 'x' } });
  check('PATCH /on-boarding/:id without token → 401', noAuthPatch.status === 401, String(noAuthPatch.status));
  const noAuthDelete = await api(`/on-boarding/${new mongoose.Types.ObjectId()}`, { method: 'DELETE' });
  check('DELETE /on-boarding/:id without token → 401', noAuthDelete.status === 401, String(noAuthDelete.status));
  const driverCreate = await api('/on-boarding', { method: 'POST', token: rameshToken, body: { title: 'x' } });
  check('POST /on-boarding with a driver token → 403', driverCreate.status === 403, String(driverCreate.status));
  const publicRead = await api('/on-boarding');
  check('GET /on-boarding stays public', publicRead.status === 200, String(publicRead.status));

  console.log('\nF  Socket handshake');
  const okSocket = await trySocket(rameshToken);
  check('approved driver connects', okSocket.connected, okSocket.error);
  const mohan = await Driver.findOne({ phone: '9000000004' }).lean();
  const mohanToken = signAccessToken({ sub: String(mohan._id), role: 'driver' });
  try {
    await Driver.updateOne({ _id: mohan._id }, { $set: { status: 'blocked' } });
    const blocked = await trySocket(mohanToken);
    check('blocked driver is refused', !blocked.connected, 'connected');
    await Driver.updateOne({ _id: mohan._id }, { $set: { status: 'pending', approve: false } });
    const pending = await trySocket(mohanToken);
    check('pending driver is refused', !pending.connected, 'connected');
    await Driver.updateOne({ _id: mohan._id }, { $set: { status: 'approved', approve: true, deletedAt: new Date() } });
    const deleted = await trySocket(mohanToken);
    check('deleted driver is refused', !deleted.connected, 'connected');
  } finally {
    await Driver.updateOne(
      { _id: mohan._id },
      { $set: { status: mohan.status ?? 'approved', approve: mohan.approve ?? true, deletedAt: mohan.deletedAt ?? null } },
    );
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
