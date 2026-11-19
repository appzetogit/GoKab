import crypto from 'crypto';
import { env } from '../../../config/env.js';

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

/** 4-digit OTP from the CSPRNG — Math.random is predictable. */
export const generateOtp = () => String(crypto.randomInt(1000, 10000));

/**
 * Static test OTPs come from the environment only (USE_DEFAULT_OTP,
 * STATIC_OTP_PHONE, STATIC_OTP_CODE). There is deliberately no hardcoded
 * phone/code fallback: an unset env means every phone gets a random OTP.
 *
 * @param {string} normalizedPhone phone already normalised by the caller
 * @param {(phone: string) => string} normalize the caller's phone normaliser
 */
export const resolveOtpForPhone = (normalizedPhone, normalize = (value) => String(value || '').trim()) => {
  // STATIC_OTP_PHONE may hold several test numbers, comma separated. An entry can carry its own
  // code as "phone:code" (e.g. 1111111111:1234); one without a code uses STATIC_OTP_CODE.
  const staticEntries = new Map();
  for (const entry of String(env.sms?.staticOtpPhone || '').split(',')) {
    const [rawPhone, rawCode = ''] = entry.split(':');
    const phone = normalize(String(rawPhone || '').trim());
    if (phone) staticEntries.set(phone, String(rawCode).trim());
  }
  const staticOtp = String(env.sms?.staticOtpCode || '').trim();

  if (staticOtp && isTruthy(env.sms?.useDefaultOtp)) {
    return { otp: staticOtp, isStatic: true };
  }

  if (staticEntries.has(normalizedPhone)) {
    const code = staticEntries.get(normalizedPhone) || staticOtp;
    if (code) return { otp: code, isStatic: true };
  }

  return { otp: generateOtp(), isStatic: false };
};

/**
 * The OTP is echoed back in the API response (`debugOtp`) and logged only when
 * EXPOSE_DEBUG_OTP=true is set explicitly — never just because NODE_ENV isn't
 * "production", since staging boxes routinely run without NODE_ENV — and never
 * in production even if the flag is set by mistake.
 */
export const getVisibleOtp = (otp) =>
  isTruthy(process.env.EXPOSE_DEBUG_OTP) && process.env.NODE_ENV !== 'production' ? String(otp) : null;
