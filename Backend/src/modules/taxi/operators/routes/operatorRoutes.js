import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { listNearestOperators } from '../services/operatorService.js';

export const operatorModuleRouter = Router();

const num = (value) => (value === undefined || value === '' ? NaN : Number(value));

// Public, mounted ahead of the user router. Pro / Elite operators near the rider.
operatorModuleRouter.get(
  '/users/operators',
  asyncHandler(async (req, res) => {
    const radius = num(req.query.radius_km);
    const limit = Math.floor(num(req.query.limit));
    const results = await listNearestOperators({
      lat: num(req.query.lat),
      lng: num(req.query.lng),
      radiusKm: Number.isFinite(radius) && radius > 0 ? radius : 100,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20,
    });
    res.json({ success: true, data: { results } });
  }),
);
