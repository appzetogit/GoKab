import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { attentionSummaryController, globalSearchController } from '../controllers/insightsController.js';

/** Mounted at /admin/insights (read-only helpers for the dashboard and search). */
export const insightsRouter = Router();
const adminOnly = authenticate(['admin']);
insightsRouter.get('/attention', adminOnly, asyncHandler(attentionSummaryController));
insightsRouter.get('/search', adminOnly, asyncHandler(globalSearchController));
