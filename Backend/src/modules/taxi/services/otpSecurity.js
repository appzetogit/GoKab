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
  const staticPhone = env.sms?.staticOtpPhone ? normalize(env.sms.staticOtpPhone) : '';
  const staticOtp = String(env.sms?.staticOtpCode || '').trim();

  if (staticOtp && isTruthy(env.sms?.useDefaultOtp)) {
    return { otp: staticOtp, isStatic: true };
  }

  if (staticPhone && staticOtp && normalizedPhone === staticPhone) {
    return { otp: staticOtp, isStatic: true };
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
