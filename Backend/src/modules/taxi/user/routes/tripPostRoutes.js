import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { closeTripPost, createTripPost, listMyTripPosts } from '../services/tripPostService.js';

export const tripPostRouter = Router();
const userOnly = authenticate(['user']);

tripPostRouter.post(
  '/',
  userOnly,
  asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await createTripPost(req.auth.sub, req.body) });
  }),
);

tripPostRouter.get(
  '/mine',
  userOnly,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { results: await listMyTripPosts(req.auth.sub) } });
  }),
);

tripPostRouter.patch(
  '/:id/close',
  userOnly,
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await closeTripPost(req.auth.sub, req.params.id) });
  }),
);
