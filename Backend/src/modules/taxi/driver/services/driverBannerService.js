import { ApiError } from '../../../../utils/ApiError.js';
import { mediaService } from '../../../../services/media.service.js';

const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp));base64,/i;

const currentUrlOf = (value) =>
  value && typeof value === 'object' && value.url ? String(value.url) : String(value || '');

/**
 * Turns whatever the app sent for a profile banner into what gets stored.
 *
 *  - '' / null           → '' (clears the banner)
 *  - the current URL     → unchanged (the app echoing back what GET /me gave it)
 *  - an image data URL   → re-encoded as webp under the `banners` media type:
 *                          no crop, aspect ratio kept, at most 1600px wide
 *
 * Anything else — an arbitrary URL, a GIF, a video — is refused, so the banner
 * always points at an image this server re-encoded.
 */
export const resolveDriverBanner = async (value, { current = '' } = {}) => {
  if (value === undefined) return undefined;
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const currentUrl = currentUrlOf(current).trim();
  if (currentUrl && raw === currentUrl) return currentUrl;

  if (!BANNER_DATA_URL.test(raw)) {
    throw new ApiError(
      422,
      'Banner must be a JPEG, PNG or WebP image sent as a data URL',
      null,
      'INVALID_BANNER',
    );
  }

  const decodedBytes = Math.floor((raw.length - raw.indexOf(',') - 1) * 0.75);
  if (decodedBytes > BANNER_MAX_BYTES) {
    throw new ApiError(400, 'Banner must be 5 MB or smaller', { max_bytes: BANNER_MAX_BYTES }, 'IMAGE_TOO_LARGE');
  }

  try {
    const stored = await mediaService.uploadMedia(raw, 'banners');
    return stored.url;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // sharp throws on bytes that only claim to be an image.
    throw new ApiError(422, 'Banner image could not be read', null, 'INVALID_BANNER');
  }
};
