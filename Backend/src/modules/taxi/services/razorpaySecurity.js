import crypto from 'crypto';

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

/**
 * Mock Razorpay orders (`order_test_*` / `pay_test_*`) skip signature checks
 * and trust the client-sent amount, so they are opt-in via
 * RAZORPAY_ALLOW_TEST_MODE=true and never honoured in production. Without the
 * flag a forged `order_test_x` / `pay_test_y` pair is just an invalid payment.
 */
export const isRazorpayTestModeAllowed = () =>
  isTruthy(process.env.RAZORPAY_ALLOW_TEST_MODE) && process.env.NODE_ENV !== 'production';

export const isRazorpayTestPayment = (orderId = '', paymentId = '') =>
  isRazorpayTestModeAllowed() &&
  (String(orderId || '').startsWith('order_test_') || String(paymentId || '').startsWith('pay_test_'));

/** Constant-time comparison of two hex digests; false on any length/shape mismatch. */
export const safeEqualHex = (expected, received) => {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(received || '').trim(), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

const hmacHex = (secret, payload) => crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');

/** Checkout signature: HMAC-SHA256(`${order_id}|${payment_id}`, key_secret). */
export const isValidRazorpayPaymentSignature = ({ orderId, paymentId, signature, keySecret }) =>
  Boolean(keySecret) && safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);

/**
 * Webhook signature is computed over the exact bytes Razorpay sent. Re-serialising
 * the parsed JSON changes key order/whitespace/unicode escaping, so this needs
 * the raw body captured by express.json's `verify` hook (see app.js).
 */
export const isValidRazorpayWebhookSignature = ({ rawBody, signature, webhookSecret }) =>
  Boolean(webhookSecret) && Buffer.isBuffer(rawBody) && safeEqualHex(hmacHex(webhookSecret, rawBody), signature);
