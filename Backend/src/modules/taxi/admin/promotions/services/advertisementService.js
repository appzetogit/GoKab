import { Advertisement } from '../models/Advertisement.js';
import { mediaService } from '../../../../../services/media.service.js';
import { ApiError } from '../../../../../utils/ApiError.js';

export const listAdvertisements = async (query = {}) => {
  const filter = {};
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (query.position) filter.position = query.position;

  return await Advertisement.find(filter)
    .sort({ displayOrder: 1, createdAt: -1 })
    .lean();
};

export const createAdvertisement = async (body, fileMetadata, adminId) => {
  const {
    title,
    description,
    type,
    position,
    mediaType,
    actionType,
    actionValue,
    displayOrder,
    startDate,
    endDate,
    status
  } = body;

  let finalMediaMetadata = fileMetadata;

  // Fallback for base64
  if (!finalMediaMetadata && body.media) {
    finalMediaMetadata = await mediaService.uploadMedia(body.media, 'advertisements');
  }

  if (!finalMediaMetadata) {
    throw new ApiError(400, 'Advertisement media file is required');
  }

  // Ensure metadata matches the schema: url, filename, storage, mimeType, size
  const mediaObj = {
    url: finalMediaMetadata.url,
    filename: finalMediaMetadata.filename,
    storage: finalMediaMetadata.storage || 'LOCAL',
    mimeType: finalMediaMetadata.mimeType,
    size: Number(finalMediaMetadata.size || 0)
  };

  const ad = await Advertisement.create({
    title,
    description,
    type,
    position,
    mediaType,
    media: mediaObj,
    actionType: actionType || 'NONE',
    actionValue: actionValue || '',
    displayOrder: Number(displayOrder || 0),
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    status: status || 'ACTIVE',
    createdBy: adminId
  });

  return ad;
};

export const updateAdvertisement = async (id, body, fileMetadata) => {
  const ad = await Advertisement.findById(id);
  if (!ad) {
    throw new ApiError(404, 'Advertisement not found');
  }

  const {
    title,
    description,
    type,
    position,
    mediaType,
    actionType,
    actionValue,
    displayOrder,
    startDate,
    endDate,
    status
  } = body;

  let finalMediaMetadata = fileMetadata;

  // Fallback for base64
  if (!finalMediaMetadata && body.media) {
    finalMediaMetadata = await mediaService.uploadMedia(body.media, 'advertisements');
  }

  if (finalMediaMetadata) {
    // Delete the old file from local storage
    if (ad.media && ad.media.url) {
      await mediaService.deleteMedia(ad.media.url);
    }

    ad.media = {
      url: finalMediaMetadata.url,
      filename: finalMediaMetadata.filename,
      storage: finalMediaMetadata.storage || 'LOCAL',
      mimeType: finalMediaMetadata.mimeType,
      size: Number(finalMediaMetadata.size || 0)
    };
  }

  if (title !== undefined) ad.title = title;
  if (description !== undefined) ad.description = description;
  if (type !== undefined) ad.type = type;
  if (position !== undefined) ad.position = position;
  if (mediaType !== undefined) ad.mediaType = mediaType;
  if (actionType !== undefined) ad.actionType = actionType;
  if (actionValue !== undefined) ad.actionValue = actionValue;
  if (displayOrder !== undefined) ad.displayOrder = Number(displayOrder || 0);
  if (startDate !== undefined) ad.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) ad.endDate = endDate ? new Date(endDate) : null;
  if (status !== undefined) ad.status = status;

  await ad.save();
  return ad;
};

export const deleteAdvertisement = async (id) => {
  const ad = await Advertisement.findById(id);
  if (!ad) {
    throw new ApiError(404, 'Advertisement not found');
  }

  // Delete local file
  if (ad.media && ad.media.url) {
    await mediaService.deleteMedia(ad.media.url);
  }

  await ad.deleteOne();
  return { deleted: true };
};

export const toggleAdvertisementStatus = async (id) => {
  const ad = await Advertisement.findById(id);
  if (!ad) {
    throw new ApiError(404, 'Advertisement not found');
  }

  ad.status = ad.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  await ad.save();
  return ad;
};

export const listActiveAdvertisements = async () => {
  const now = new Date();

  // Find active ads where current date is within range or ranges are null
  const activeAds = await Advertisement.find({
    status: 'ACTIVE',
    $and: [
      { $or: [{ startDate: { $lte: now } }, { startDate: null }] },
      { $or: [{ endDate: { $gte: now } }, { endDate: null }] }
    ]
  }).sort({ displayOrder: 1, createdAt: -1 });

  // Get active FULL advertisement (only one)
  const fullAdDoc = activeAds.find(ad => ad.type === 'FULL') || null;
  const fullAd = fullAdDoc ? {
    _id: fullAdDoc._id,
    title: fullAdDoc.title,
    description: fullAdDoc.description,
    mediaType: fullAdDoc.mediaType,
    url: fullAdDoc.media ? fullAdDoc.media.url : '', // Maps to media.url
    actionType: fullAdDoc.actionType || 'NONE',
    actionValue: fullAdDoc.actionValue || ''
  } : null;

  // Get active CAROUSEL advertisements (multiple)
  const carouselAds = activeAds
    .filter(ad => ad.type === 'CAROUSEL')
    .map(ad => ({
      _id: ad._id,
      title: ad.title,
      description: ad.description,
      mediaType: ad.mediaType,
      url: ad.media ? ad.media.url : '', // Maps to media.url
      actionType: ad.actionType || 'NONE',
      actionValue: ad.actionValue || '',
      displayOrder: ad.displayOrder
    }));

  return {
    fullAd,
    carouselAds
  };
};
