import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { getStoragePath, getPublicUrl } from './storage.util.js';

const resizeRules = {
  users: { width: 400, height: 400 },
  drivers: { width: 500, height: 500 },
  vehicles: { width: 800, height: 600 },
  logos: { width: 500, height: 500 },
  advertisements: { width: 1200, height: 600 }
};

/**
 * Processes a file buffer, resizes and optimizes it, saves to local storage
 * @param {Buffer} buffer - File buffer
 * @param {string} type - users | drivers | vehicles | advertisements | documents | logos
 * @param {string} mimeType - e.g. 'image/jpeg'
 * @param {object} [req] - Express request object for public URL generation
 * @returns {Promise<{url: string, filename: string, storage: string, mimeType: string, size: number, uploadedAt: Date}>}
 */
export const processAndSaveMedia = async (buffer, type, mimeType, req) => {
  const isGif = mimeType.toLowerCase().includes('gif');
  const isVideo = mimeType.toLowerCase().includes('video') || mimeType.toLowerCase().includes('mp4') || mimeType.toLowerCase().includes('webm');

  const { absoluteDir, relativePath } = getStoragePath(type, mimeType);
  const uuid = crypto.randomUUID();
  
  let filename = '';
  let finalMimeType = mimeType;
  let finalBuffer = buffer;

  if (isVideo) {
    // Determine extension
    const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
    filename = `${uuid}.${ext}`;
    finalMimeType = `video/${ext}`;
    
    // Write directly to disk
    const targetPath = path.join(absoluteDir, filename);
    await fs.promises.writeFile(targetPath, buffer);
  } else if (isGif) {
    filename = `${uuid}.gif`;
    // Write directly to disk to preserve animation
    const targetPath = path.join(absoluteDir, filename);
    await fs.promises.writeFile(targetPath, buffer);
  } else {
    // Normal image: convert to webp and resize
    filename = `${uuid}.webp`;
    finalMimeType = 'image/webp';

    let pipeline = sharp(buffer);
    const rule = resizeRules[type];

    if (rule) {
      pipeline = pipeline.resize(rule.width, rule.height, {
        fit: 'cover',
        position: 'center'
      });
    }

    // Convert to webp with quality optimization
    pipeline = pipeline.webp({ quality: 80 });
    finalBuffer = await pipeline.toBuffer();

    const targetPath = path.join(absoluteDir, filename);
    await fs.promises.writeFile(targetPath, finalBuffer);
  }

  const url = getPublicUrl(relativePath, filename, req);
  const size = finalBuffer.length;

  return {
    url,
    filename,
    storage: 'LOCAL',
    mimeType: finalMimeType,
    size,
    uploadedAt: new Date()
  };
};
