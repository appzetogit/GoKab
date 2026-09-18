import { Router } from 'express';
import { deliveryRouter } from './deliveryRoutes.js';
import { promoRouter } from './promoRoutes.js';
import { rideRouter } from './rideRoutes.js';
import { userLeadRouter } from './leadRoutes.js';
import { userRouter } from './userRoutes.js';

export const userModuleRouter = Router();

// Mounted before `/users` so its concrete path is not captured by a
// parameterised route on the main user router.
userModuleRouter.use('/users/lead-conversations', userLeadRouter);
userModuleRouter.use('/users', userRouter);
userModuleRouter.use('/rides', rideRouter);
userModuleRouter.use('/deliveries', deliveryRouter);
userModuleRouter.use('/promos', promoRouter);
