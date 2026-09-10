import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

// Resolve base directory dynamically based on OS or environment settings
const getBaseStorageDir = () => {
  if (process.env.STORAGE_BASE_DIR) {
    return path.resolve(process.env.STORAGE_BASE_DIR);
  }
  // Default to relative folder on Windows for easy local development, or /var/storage on Linux
  return process.platform === 'win32'
    ? path.resolve('./var/storage')
    : '/var/storage';
};

/**
 * Returns subfolder path for advertisements based on mime type
 * @param {string} mimeType 
 * @returns {string} 'images' | 'videos' | 'gifs'
 */
const getAdSubfolder = (mimeType = '') => {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('gif')) return 'gifs';
  if (mime.includes('video') || mime.includes('mp4') || mime.includes('webm')) return 'videos';
  return 'images';
};

/**
 * Resolves the absolute directory path on the VPS and creates it if missing
 * @param {string} type - users | drivers | vehicles | advertisements | documents | logos
 * @param {string} [mimeType] - needed for advertisements to determine subfolder
 * @returns {{ absoluteDir: string, relativePath: string }}
 */
export const getStoragePath = (type, mimeType = '') => {
  const baseDir = getBaseStorageDir();
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');

  let typePath = type;
  if (type === 'advertisements') {
    const subfolder = getAdSubfolder(mimeType);
    typePath = path.join('advertisements', subfolder);
  }

  // Generate path segments
  const relativePath = path.join(typePath, year, month);
  const absoluteDir = path.join(baseDir, relativePath);

  // Ensure directory exists recursively
  if (!fs.existsSync(absoluteDir)) {
    fs.mkdirSync(absoluteDir, { recursive: true });
  }

  return {
    absoluteDir,
    relativePath: relativePath.replace(/\\/g, '/'), // Force forward slashes for URLs
  };
};

/**
 * Generates the public HTTP URL for the saved asset
 * @param {string} relativePath - relative path e.g. 'users/2026/07'
 * @param {string} filename - e.g. '8d7f2a91.webp'
 * @param {object} [req] - Express request object for fallback dynamic host
 * @returns {string}
 */
export const getPublicUrl = (relativePath, filename, req) => {
  const baseUrl = (process.env.STORAGE_BASE_URL || env.storageBaseUrl || '').replace(/\/+$/, '');
  
  let host = baseUrl;
  if (!host && req) {
    const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    host = `${protocol}://${req.get('host')}`;
  }
  
  if (!host) {
    // Last-resort fallback for callers with no request context and no
    // STORAGE_BASE_URL configured (seed scripts, cron jobs). Track the port the
    // API actually listens on — hardcoding one bakes a dead origin into every
    // asset URL persisted from that context.
    host = `http://localhost:${env.port}`;
  }

  return `${host}/images/${relativePath}/${filename}`;
};

/**
 * Resolves physical path on disk for deletion
 * @param {string} fileUrl - Public URL of the image
 * @returns {string|null} Absolute file path or null
 */
export const getAbsoluteFilePathFromUrl = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string') return null;

  const baseDir = getBaseStorageDir();
  const urlParts = fileUrl.split('/images/');
  if (urlParts.length < 2) return null;

  const relativeFilePath = urlParts[1];
  return path.join(baseDir, relativeFilePath);
};
