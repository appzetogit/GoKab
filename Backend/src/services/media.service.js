import fs from 'node:fs';
import { processAndSaveMedia } from '../utils/sharp.util.js';
import { getAbsoluteFilePathFromUrl, getPublicUrl } from '../utils/storage.util.js';
import { ApiError } from '../utils/ApiError.js';

export const mediaService = {
  /**
   * Upload media to local storage. Handles both binary Buffers and base64 data URLs.
   * @param {Buffer|string} source - Buffer or base64 data URL
   * @param {string} type - users | drivers | vehicles | advertisements | documents | logos
   * @param {string} [overrideMimeType] - MIME type, required if source is a Buffer
   * @param {object} [req] - Express request object for public URL generation
   * @returns {Promise<{url: string, filename: string, storage: string, mimeType: string, size: number, uploadedAt: Date}>}
   */
  uploadMedia: async (source, type, overrideMimeType = '', req = null) => {
    let buffer;
    let mimeType = overrideMimeType;

    if (Buffer.isBuffer(source)) {
      buffer = source;
      if (!mimeType) {
        throw new ApiError(400, 'MIME type is required for binary uploads');
      }
    } else if (typeof source === 'string' && source.startsWith('data:')) {
      // Parse base64 data URL
      const match = source.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        throw new ApiError(400, 'Invalid base64 data URL format');
      }
      mimeType = match[1];
      buffer = Buffer.from(match[2], 'base64');
    } else {
      throw new ApiError(400, 'Invalid upload source. Must be a Buffer or base64 data URL');
    }

    // Validate size (5MB limit)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      throw new ApiError(413, 'File size exceeds the 5MB limit');
    }

    // Validate MIME types and extensions
    const allowedMimes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm'
    ];
    if (!allowedMimes.includes(mimeType.toLowerCase())) {
      throw new ApiError(415, `Unsupported media format: ${mimeType}`);
    }

    return await processAndSaveMedia(buffer, type, mimeType, req);
  },

  /**
   * Deletes a local media file from the VPS storage
   * @param {string} fileUrl - Public URL of the file
   * @returns {Promise<boolean>} True if deleted, false if file did not exist
   */
  deleteMedia: async (fileUrl) => {
    if (!fileUrl) return false;

    const absolutePath = getAbsoluteFilePathFromUrl(fileUrl);
    if (!absolutePath) return false;

    try {
      if (fs.existsSync(absolutePath)) {
        await fs.promises.unlink(absolutePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to delete file at ${absolutePath}:`, error);
      return false;
    }
  },

  /**
   * Generates public URL dynamically
   */
  generateMediaUrl: (relativePath, filename, req) => {
    return getPublicUrl(relativePath, filename, req);
  }
};
