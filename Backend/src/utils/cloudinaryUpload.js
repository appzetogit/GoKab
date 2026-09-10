import { mediaService } from '../services/media.service.js';

const getCategoryFromFolder = (folder = '') => {
  const f = String(folder).toLowerCase();
  if (f.includes('user') || f.includes('avatar') || f.includes('customer')) return 'users';
  if (f.includes('driver')) return 'drivers';
  if (f.includes('vehicle') || f.includes('fleet')) return 'vehicles';
  if (f.includes('advertisement') || f.includes('banner') || f.includes('promo')) return 'advertisements';
  if (f.includes('logo') || f.includes('branding')) return 'logos';
  return 'documents';
};

/**
 * Fallback redirecting legacy Cloudinary uploads to the new local media service.
 * This guarantees that even unmodified files will upload to the local VPS instead of Cloudinary.
 */
export const uploadDataUrlToCloudinary = async ({
  dataUrl,
  folder = '',
  publicIdPrefix = '',
  publicIdSuffix = '',
}) => {
  const category = getCategoryFromFolder(folder || publicIdPrefix);
  
  // Call local media service instead of Cloudinary SDK
  const metadata = await mediaService.uploadMedia(dataUrl, category);
  
  return {
    secureUrl: metadata.url,
    publicId: metadata.filename,
    format: metadata.mimeType.split('/')[1] || 'webp',
    resourceType: metadata.mimeType.startsWith('video') ? 'video' : 'image',
    bytes: metadata.size,
    createdAt: metadata.uploadedAt,
    raw: metadata,
  };
};
