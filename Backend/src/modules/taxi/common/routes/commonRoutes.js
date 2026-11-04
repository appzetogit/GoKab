import { Router } from 'express';
import * as commonController from '../controllers/commonController.js';
import { authenticate } from '../../middlewares/authMiddleware.js';

export const commonRouter = Router();

// Universal image upload endpoint
commonRouter.post(
  '/common/upload/image',
  authenticate(['admin', 'user', 'driver', 'owner', 'bus_driver', 'service_center', 'service_center_staff'], {
    allowPending: true,
  }),
  commonController.uploadImage,
);
commonRouter.get('/common/referrals/translation', commonController.getReferralTranslation);
commonRouter.get('/common/referrals/settings', commonController.getReferralSettingsContent);
commonRouter.get('/common/payment-gateway', commonController.getPaymentGatewayConfig);
commonRouter.get('/common/app-config', commonController.getPublicAppConfig);
commonRouter.get('/common/carpool-config', commonController.getCarpoolPublicConfig);
commonRouter.get('/track/:token', commonController.getTrackingPage);
commonRouter.get('/track/:token/data', commonController.getTrackingData);
commonRouter.post('/common/payment-gateway/phonepe/callback', commonController.acknowledgePhonePeCallback);
