import { Router } from 'express';
import { adminRouter } from './adminRoutes.js';
import { driverNetworkRouter } from './driverNetworkRoutes.js';
import { cmsAdminRouter } from './cmsRoutes.js';

export const adminModuleRouter = Router();

// Mounted ahead of the main admin router so its concrete paths are not
// shadowed by the parameterised routes already registered there.
adminModuleRouter.use('/admin/driver-network', driverNetworkRouter);
adminModuleRouter.use('/admin/cms-pages', cmsAdminRouter);
adminModuleRouter.use('/', adminRouter);
