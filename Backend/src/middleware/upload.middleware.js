import multer from 'multer';
import path from 'node:path';
import { mediaService } from '../services/media.service.js';
import { ApiError } from '../utils/ApiError.js';

const storage = multer.memoryStorage();

const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm'];
const allowedMimeTypes = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm'
];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype.toLowerCase();

  if (!allowedExtensions.includes(ext) || !allowedMimeTypes.includes(mime)) {
    return cb(new ApiError(415, `Unsupported file type: ${ext} (${mime})`), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter
});

/**
 * Express middleware to handle file uploads, process them, and store them locally
 * @param {string} type - users | drivers | vehicles | advertisements | logos | documents
 * @param {string} [fieldName='file'] - form field name
 */
export const uploadImage = (type, fieldName = 'file') => {
  const singleUpload = upload.single(fieldName);

  return (req, res, next) => {
    singleUpload(req, res, async (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new ApiError(413, 'File size exceeds the 5MB limit'));
          }
          return next(new ApiError(400, err.message));
        }
        return next(err);
      }

      if (!req.file) {
        return next();
      }

      try {
        const metadata = await mediaService.uploadMedia(
          req.file.buffer,
          type,
          req.file.mimetype,
          req
        );

        req.fileMetadata = metadata;
        req.fileUrl = metadata.url;
        next();
      } catch (error) {
        next(error);
      }
    });
  };
};
