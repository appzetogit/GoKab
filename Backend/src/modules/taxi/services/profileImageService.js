import { ApiError } from '../../../utils/ApiError.js';
import { mediaService } from '../../../services/media.service.js';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|jpg|png|webp);base64,/i;

/**
 * For profile photos whose callers have always accepted a URL as-is (rider
 * signup/profile, admin user forms): a data URL is decoded, re-encoded and
 * hosted, and only the resulting URL is returned for storing. Anything that is
 * not a data URL is returned trimmed and unchanged.
 *
 * Storing the base64 itself put the whole photo in every profile response and
 * let a broken upload break the app's image decoder.
 */
export const hostProfileImageInput = async (value, { mediaType = 'users', req = null } = {}) => {
  const raw = String(value ?? '').trim();
  if (!/^data:/i.test(raw)) return raw;

  if (!IMAGE_DATA_URL.test(raw)) {
    throw new ApiError(
      422,
      'Profile image must be a JPEG, PNG or WebP image',
      null,
      'INVALID_PROFILE_IMAGE',
    );
  }

  const decodedBytes = Math.floor((raw.length - raw.indexOf(',') - 1) * 0.75);
  if (decodedBytes > IMAGE_MAX_BYTES) {
    throw new ApiError(400, 'Profile image must be 5 MB or smaller', { max_bytes: IMAGE_MAX_BYTES }, 'IMAGE_TOO_LARGE');
  }

  try {
    return (await mediaService.uploadMedia(raw, mediaType, '', req)).url;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // sharp throws on bytes that only claim to be an image (e.g. truncated).
    throw new ApiError(422, 'Profile image could not be read', null, 'INVALID_PROFILE_IMAGE');
  }
};
