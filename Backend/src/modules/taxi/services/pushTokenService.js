import { ApiError } from '../../../utils/ApiError.js';

const MOBILE_PLATFORMS = new Set(['android', 'ios', 'mobile']);
const WEB_PLATFORMS = new Set(['web', 'browser', 'pwa']);

export const normalizePushPlatform = (platform) => {
  const normalized = String(platform || '').trim().toLowerCase();

  if (WEB_PLATFORMS.has(normalized)) {
    return 'web';
  }

  if (MOBILE_PLATFORMS.has(normalized)) {
    return 'mobile';
  }

  throw new ApiError(400, 'platform must be web, android, ios, or mobile');
};

export const normalizePushToken = (token) => {
  const normalized = String(token || '').trim();

  if (!normalized) {
    throw new ApiError(400, 'token is required');
  }

  if (normalized.length < 20) {
    throw new ApiError(400, 'token looks invalid');
  }

  return normalized;
};

export const getPushTokenField = (platform) =>
  normalizePushPlatform(platform) === 'web' ? 'fcmTokenWeb' : 'fcmTokenMobile';

export const assignPushTokenToEntity = (entity, { token, platform }) => {
  const normalizedToken = normalizePushToken(token);
  const normalizedPlatform = normalizePushPlatform(platform);
  const fieldName = getPushTokenField(normalizedPlatform);

  entity[fieldName] = normalizedToken;
  entity.set?.('fcmTokens', undefined, { strict: false });

  return {
    token: normalizedToken,
    platform: normalizedPlatform,
    fieldName,
  };
};

export const listEntityPushTokens = (entity = {}, role = 'unknown') =>
  [
    { role, field: 'fcmTokenWeb', platform: 'web', token: String(entity.fcmTokenWeb || '').trim() },
    { role, field: 'fcmTokenMobile', platform: 'mobile', token: String(entity.fcmTokenMobile || '').trim() },
  ].filter((entry) => entry.token);
