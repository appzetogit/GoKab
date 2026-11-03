import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { listCancellationReasons } from '../models/CancellationReason.js';

export const cancellationReasonRouter = Router();

// Not sensitive, and the cancel sheet must keep working if the token is stale.
cancellationReasonRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: { results: await listCancellationReasons(req.query.audience) } });
  }),
);
