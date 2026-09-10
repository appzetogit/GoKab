import { mediaService } from '../services/media.service.js';

/**
 * Deletes a file from local storage on the VPS
 * @param {string} fileUrl - Public URL of the file
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
export const deleteFile = async (fileUrl) => {
  return await mediaService.deleteMedia(fileUrl);
};
