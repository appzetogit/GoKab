import { Router } from 'express';
import { ApiError } from '../../../../utils/ApiError.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  createComplaint, getComplaintReasons, listComplaints, listMyComplaints, saveComplaintReasons, updateComplaint,
} from '../services/complaintService.js';

/** Rider and driver apps: /complaints. The account and its role come from the token only. */
export const complaintRouter = Router();
const riderOrDriver = authenticate(['user', 'driver']);

complaintRouter.get('/reasons', riderOrDriver, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { results: (await getComplaintReasons())[req.auth.role] } });
}));
complaintRouter.get('/mine', riderOrDriver, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { results: await listMyComplaints({ role: req.auth.role, accountId: req.auth.sub }) } });
}));
complaintRouter.post('/', riderOrDriver, asyncHandler(async (req, res) => {
  const data = await createComplaint({
    role: req.auth.role, accountId: req.auth.sub, rideId: req.body?.rideId, reason: req.body?.reason, message: req.body?.message,
  });
  res.status(201).json({ success: true, message: 'Report sent', data });
}));

/** Admin panel: /admin/complaints. */
export const adminComplaintRouter = Router();
const adminOnly = authenticate(['admin']);
const canSupport = (req, _res, next) => {
  const permissions = req.auth?.admin?.permissions || [];
  if (permissions.includes('*') || permissions.includes('support.view')) return next();
  return next(new ApiError(403, 'You do not have permission to see complaints', null, 'FORBIDDEN'));
};

adminComplaintRouter.get('/', adminOnly, canSupport, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listComplaints(req.query) });
}));
adminComplaintRouter.put('/reasons', adminOnly, canSupport, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await saveComplaintReasons(req.body) });
}));
adminComplaintRouter.patch('/:id', adminOnly, canSupport, asyncHandler(async (req, res) => {
  const admin = req.auth.admin || {};
  res.json({
    success: true,
    data: await updateComplaint({ id: req.params.id, status: req.body?.status, note: req.body?.note, adminName: admin.name || admin.email }),
  });
}));
