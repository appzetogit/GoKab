import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  getPublicCmsPageController,
  listCmsPagesController,
  saveCmsPageController,
} from '../controllers/cmsPageController.js';

const adminOnly = authenticate(['admin']);

/** Mounted at /admin/cms-pages */
export const cmsAdminRouter = Router();
cmsAdminRouter.get('/', adminOnly, asyncHandler(listCmsPagesController));
cmsAdminRouter.put('/:audience/:slug', adminOnly, asyncHandler(saveCmsPageController));

/** Mounted at /cms: public and read-only. */
export const cmsPublicRouter = Router();
cmsPublicRouter.get('/:audience/:slug', asyncHandler(getPublicCmsPageController));
