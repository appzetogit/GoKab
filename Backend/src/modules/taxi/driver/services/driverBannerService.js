import { ApiError } from '../../../../utils/ApiError.js';
import { mediaService } from '../../../../services/media.service.js';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp));base64,/i;

const currentUrlOf = (value) =>
  value && typeof value === 'object' && value.url ? String(value.url) : String(value || '');

/**
 * Turns whatever the app sent for a driver image into what gets stored.
 *
 *  - undefined           → undefined (field not sent; caller keeps the old value)
 *  - '' / null           → '' (clears the image)
 *  - the current URL     → unchanged (the app echoing back what GET /me gave it)
 *  - an image data URL   → re-encoded as webp under `mediaType`
 *
 * Anything else — an arbitrary URL, a GIF, a video — is refused, so the stored
 * value always points at an image this server re-encoded.
 */
const resolveDriverImage = async (value, { current = '', mediaType, label, invalidCode, req = null }) => {
  if (value === undefined) return undefined;
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const currentUrl = currentUrlOf(current).trim();
  if (currentUrl && raw === currentUrl) return currentUrl;

  if (!IMAGE_DATA_URL.test(raw)) {
    throw new ApiError(
      422,
      `${label} must be a JPEG, PNG or WebP image sent as a data URL`,
      null,
      invalidCode,
    );
  }

  const decodedBytes = Math.floor((raw.length - raw.indexOf(',') - 1) * 0.75);
  if (decodedBytes > IMAGE_MAX_BYTES) {
    throw new ApiError(400, `${label} must be 5 MB or smaller`, { max_bytes: IMAGE_MAX_BYTES }, 'IMAGE_TOO_LARGE');
  }

  try {
    // `req` lets the stored URL use the request's host when STORAGE_BASE_URL
    // is not configured, instead of a localhost fallback.
    const stored = await mediaService.uploadMedia(raw, mediaType, '', req);
    return stored.url;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // sharp throws on bytes that only claim to be an image.
    throw new ApiError(422, `${label} image could not be read`, null, invalidCode);
  }
};

/** Profile banner: no crop, aspect ratio kept, at most 1600px wide. */
export const resolveDriverBanner = (value, { current = '', req = null } = {}) =>
  resolveDriverImage(value, { current, req, mediaType: 'banners', label: 'Banner', invalidCode: 'INVALID_BANNER' });

/** Profile photo: square-cropped like other driver photos. */
export const resolveDriverProfileImage = (value, { current = '', req = null } = {}) =>
  resolveDriverImage(value, {
    current,
    req,
    mediaType: 'drivers',
    label: 'Profile image',
    invalidCode: 'INVALID_PROFILE_IMAGE',
  });
