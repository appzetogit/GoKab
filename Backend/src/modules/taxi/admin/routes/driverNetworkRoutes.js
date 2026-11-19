import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import {
  forceReleaseEscrowController,
  getNetworkSettingsController,
  listDriverRoutesForAdminController,
  listEscrowController,
  listLeadContactsController,
  listNetworkRidesForAdminController,
  listPrimeSlotsController,
  networkSummaryController,
  overrideDriverCategoryController,
  resolveEscrowController,
  revokePrimeSlotController,
  updateCityPrimeLimitController,
  updateDriverRouteLimitController,
  updateNetworkSettingsController,
  listCityPrimeLimitsController,
  createDriverWithPlanController,
  listEliteDriversController,
  listCommercialVerificationController,
  setVehicleUsageVerifiedController,
  updateVehicleUsageTypeController,
} from '../controllers/driverNetworkController.js';

export const driverNetworkRouter = Router();

const adminOnly = authenticate(['admin']);

driverNetworkRouter.get('/settings', adminOnly, asyncHandler(getNetworkSettingsController));
driverNetworkRouter.patch('/settings', adminOnly, asyncHandler(updateNetworkSettingsController));

driverNetworkRouter.get('/prime-slots', adminOnly, asyncHandler(listPrimeSlotsController));
driverNetworkRouter.get('/cities', adminOnly, asyncHandler(listCityPrimeLimitsController));
driverNetworkRouter.post('/elite-drivers', adminOnly, asyncHandler(createDriverWithPlanController));
driverNetworkRouter.get('/elite-drivers', adminOnly, asyncHandler(listEliteDriversController));
driverNetworkRouter.get('/commercial-verification', adminOnly, asyncHandler(listCommercialVerificationController));
driverNetworkRouter.patch('/drivers/:driverId/vehicle-usage-verified', adminOnly, asyncHandler(setVehicleUsageVerifiedController));
driverNetworkRouter.delete('/prime-slots/:slotId', adminOnly, asyncHandler(revokePrimeSlotController));
driverNetworkRouter.patch('/cities/:cityId/prime-limit', adminOnly, asyncHandler(updateCityPrimeLimitController));

driverNetworkRouter.patch('/drivers/:driverId/category', adminOnly, asyncHandler(overrideDriverCategoryController));
driverNetworkRouter.patch('/drivers/:driverId/route-limit', adminOnly, asyncHandler(updateDriverRouteLimitController));
driverNetworkRouter.get('/drivers/:driverId/routes', adminOnly, asyncHandler(listDriverRoutesForAdminController));

driverNetworkRouter.get('/rides', adminOnly, asyncHandler(listNetworkRidesForAdminController));

driverNetworkRouter.get('/escrow', adminOnly, asyncHandler(listEscrowController));
driverNetworkRouter.post('/escrow/:rideId/resolve', adminOnly, asyncHandler(resolveEscrowController));
driverNetworkRouter.post('/escrow/:rideId/force-release', adminOnly, asyncHandler(forceReleaseEscrowController));

driverNetworkRouter.get('/lead-contacts', adminOnly, asyncHandler(listLeadContactsController));
driverNetworkRouter.get('/reports/summary', adminOnly, asyncHandler(networkSummaryController));
driverNetworkRouter.patch('/vehicles/:vehicleId/usage-type', adminOnly, asyncHandler(updateVehicleUsageTypeController));
