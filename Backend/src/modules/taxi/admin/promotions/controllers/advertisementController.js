import { asyncHandler } from '../../../../../utils/asyncHandler.js';
import * as adService from '../services/advertisementService.js';

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });

export const getAdvertisements = asyncHandler(async (req, res) => {
  const ads = await adService.listAdvertisements(req.query);
  return ok(res, ads);
});

export const createAdvertisement = asyncHandler(async (req, res) => {
  const adminId = req.auth?.sub;
  const ad = await adService.createAdvertisement(req.body, req.fileMetadata, adminId);
  return ok(res, ad);
});

export const updateAdvertisement = asyncHandler(async (req, res) => {
  const ad = await adService.updateAdvertisement(req.params.id, req.body, req.fileMetadata);
  return ok(res, ad);
});

export const deleteAdvertisement = asyncHandler(async (req, res) => {
  const result = await adService.deleteAdvertisement(req.params.id);
  return ok(res, result);
});

export const toggleAdvertisementStatus = asyncHandler(async (req, res) => {
  const ad = await adService.toggleAdvertisementStatus(req.params.id);
  return ok(res, ad);
});

// User facing public controller action
export const getActiveAdvertisements = asyncHandler(async (req, res) => {
  const activeAds = await adService.listActiveAdvertisements();
  return ok(res, activeAds);
});
