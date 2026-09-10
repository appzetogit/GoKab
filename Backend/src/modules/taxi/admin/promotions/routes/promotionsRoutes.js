import { Router } from 'express';
import { authenticate } from '../../../middlewares/authMiddleware.js';
import {
  createBanner,
  createPromoCode,
  deleteBanner,
  deleteNotification,
  deletePromoCode,
  getBanners,
  getNotifications,
  getPromoCodes,
  getPromotionsBootstrap,
  getPromotionsServiceLocations,
  getPromotionsUsers,
  pushBanner,
  sendNotification,
  togglePromoCodeStatus,
  updateBanner,
  updatePromoCode,
} from '../controllers/promotionsController.js';
import {
  createAdvertisement,
  getAdvertisements,
  updateAdvertisement,
  deleteAdvertisement,
  toggleAdvertisementStatus,
} from '../controllers/advertisementController.js';
import { uploadImage } from '../../../../../middleware/upload.middleware.js';

export const promotionsRouter = Router();

promotionsRouter.use('/admin', authenticate(['admin']));

promotionsRouter.get('/admin/promotions/bootstrap', getPromotionsBootstrap);
promotionsRouter.get('/admin/promos', getPromoCodes);
promotionsRouter.post('/admin/promos', createPromoCode);
promotionsRouter.patch('/admin/promos/:id', updatePromoCode);
promotionsRouter.patch('/admin/promos/:id/toggle', togglePromoCodeStatus);
promotionsRouter.delete('/admin/promos/:id', deletePromoCode);
promotionsRouter.get('/admin/promos/users', getPromotionsUsers);
promotionsRouter.get('/admin/promos/service-locations', getPromotionsServiceLocations);

promotionsRouter.get('/admin/notifications', getNotifications);
promotionsRouter.post('/admin/notifications', sendNotification);
promotionsRouter.post('/admin/notifications/send', sendNotification);
promotionsRouter.delete('/admin/notifications/:id', deleteNotification);
promotionsRouter.delete('/admin/push-notifications/:id', deleteNotification);

promotionsRouter.get('/admin/banners', getBanners);
promotionsRouter.post('/admin/banners', createBanner);
promotionsRouter.patch('/admin/banners/:id', updateBanner);
promotionsRouter.delete('/admin/banners/:id', deleteBanner);
promotionsRouter.post('/admin/banners/:id/push', pushBanner);

// Advertisement Management Routes
promotionsRouter.get('/admin/advertisements', getAdvertisements);
promotionsRouter.post('/admin/advertisements', uploadImage('advertisements', 'file'), createAdvertisement);
promotionsRouter.put('/admin/advertisements/:id', uploadImage('advertisements', 'file'), updateAdvertisement);
promotionsRouter.delete('/admin/advertisements/:id', deleteAdvertisement);
promotionsRouter.patch('/admin/advertisements/:id/status', toggleAdvertisementStatus);
