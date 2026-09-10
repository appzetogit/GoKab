import { Router } from 'express';
import { getActiveAdvertisements } from '../../admin/promotions/controllers/advertisementController.js';

export const userAdvertisementRouter = Router();

// Public user endpoint to list active advertisements (Top Full + Bottom Carousel)
userAdvertisementRouter.get('/active', getActiveAdvertisements);
