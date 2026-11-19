import { Router } from 'express';
import { driverRouter } from './driverRoutes.js';
import { networkRouter } from './networkRoutes.js';
import { billRouter } from './billRoutes.js';
import { rideOfferRouter } from './rideOfferRoutes.js';
import { rideHandoverRouter } from './rideHandoverRoutes.js';
import { carpoolDriverRouter } from './carpoolRoutes.js';
import { businessProfileRouter } from './businessProfileRoutes.js';

export const driverModuleRouter = Router();

// Driver-network routes are registered first so their concrete paths are not
// shadowed by the parameterised ones already on `driverRouter`.
driverModuleRouter.use('/drivers/ride-offers', rideOfferRouter);
driverModuleRouter.use('/drivers/ride-handover', rideHandoverRouter);
driverModuleRouter.use('/drivers/carpool', carpoolDriverRouter);
driverModuleRouter.use('/drivers/network/business-profile', businessProfileRouter);
driverModuleRouter.use('/drivers', networkRouter);
driverModuleRouter.use('/drivers', billRouter);
driverModuleRouter.use('/drivers', driverRouter);
