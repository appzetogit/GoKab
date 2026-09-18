import { Router } from 'express';
import { driverRouter } from './driverRoutes.js';
import { networkRouter } from './networkRoutes.js';

export const driverModuleRouter = Router();

// Driver-network routes are registered first so their concrete paths are not
// shadowed by the parameterised ones already on `driverRouter`.
driverModuleRouter.use('/drivers', networkRouter);
driverModuleRouter.use('/drivers', driverRouter);
