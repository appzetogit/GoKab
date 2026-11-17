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

/**
 * A device token belongs to one account. When it is saved for an account, take it off every
 * other driver, owner and rider, otherwise a phone that was used by two accounts keeps getting
 * the pushes meant for the old one. Skipped quietly if it cannot run (the save already worked).
 */
export const releasePushTokenFromOthers = async ({ token, fieldName, keepId }) => {
  try {
    const [{ Driver }, { Owner }, { User }] = await Promise.all([
      import('../driver/models/Driver.js'),
      import('../admin/models/Owner.js'),
      import('../user/models/User.js'),
    ]);
    const filter = { [fieldName]: token, _id: { $ne: keepId } };
    await Promise.all(
      [Driver, Owner, User].map((Model) => Model.updateMany(filter, { $set: { [fieldName]: '' } })),
    );
  } catch (error) {
    console.error('[pushToken] could not release token from other accounts:', error.message);
  }
};

export const listEntityPushTokens = (entity = {}, role = 'unknown') =>
  [
    { role, field: 'fcmTokenWeb', platform: 'web', token: String(entity.fcmTokenWeb || '').trim() },
    { role, field: 'fcmTokenMobile', platform: 'mobile', token: String(entity.fcmTokenMobile || '').trim() },
  ].filter((entry) => entry.token);
