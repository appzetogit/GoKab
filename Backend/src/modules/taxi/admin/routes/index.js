import { Router } from 'express';
import { adminRouter } from './adminRoutes.js';
import { driverNetworkRouter } from './driverNetworkRoutes.js';

export const adminModuleRouter = Router();

// Mounted ahead of the main admin router so its concrete paths are not
// shadowed by the parameterised routes already registered there.
adminModuleRouter.use('/admin/driver-network', driverNetworkRouter);
adminModuleRouter.use('/', adminRouter);
