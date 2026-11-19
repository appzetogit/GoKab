import { Router } from 'express';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { Driver } from '../models/Driver.js';

/**
 * The name and number a customer is shown for rides this driver publishes or
 * assigns ("Booked by Ramesh Travels, 98xxxx"). Mounted at /drivers/network/business-profile.
 */
export const businessProfileRouter = Router();
const driverOnly = authenticate(['driver']);

const view = (driver) => ({
  business_name: driver?.business_name || '',
  customer_contact_phone: driver?.customer_contact_phone || '',
  // What the customer sees when these are left empty.
  fallback_name: driver?.name || '',
  fallback_phone: driver?.phone || '',
});

businessProfileRouter.get(
  '/',
  driverOnly,
  asyncHandler(async (req, res) => {
    const driver = await Driver.findById(req.auth.sub).select('name phone business_name customer_contact_phone').lean();
    res.json({ success: true, data: view(driver) });
  }),
);

businessProfileRouter.patch(
  '/',
  driverOnly,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.business_name ?? '').trim().slice(0, 80);
    const phone = String(req.body?.customer_contact_phone ?? '').replace(/\D/g, '').slice(-10);
    if (phone && phone.length !== 10) {
      throw new ApiError(400, 'Enter a 10 digit contact number', null, 'INVALID_CONTACT_PHONE');
    }
    const driver = await Driver.findByIdAndUpdate(
      req.auth.sub,
      { $set: { business_name: name, customer_contact_phone: phone } },
      { new: true },
    )
      .select('name phone business_name customer_contact_phone')
      .lean();
    if (!driver) throw new ApiError(404, 'Driver not found');
    res.json({ success: true, data: view(driver) });
  }),
);
