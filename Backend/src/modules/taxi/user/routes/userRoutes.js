import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticateOrResolveUser } from '../../middlewares/authMiddleware.js';
import {
  createRazorpayWalletTopupOrder,
  createPhonePeWalletTopupOrder,
  handleUserRazorpayWalletTopupCallback,
  getUserWallet,
  getCurrentUser,
  getUserNotifications,
  deleteUserNotification,
  getIntercityPackageCatalog,
  clearAllUserNotifications,
  listPublicServiceLocations,
  listPublicAirports,
  listPublicRailwayStations,
  loginUser,
  registerUser,
  requestAccountDeletion,
  requestReferralWalletRedemption,
  saveUserFcmToken,
  signupUser,
  startUserOtpRequest,
  topupUserWallet,
  listMyReferralRedemptionRequests,
  transferUserWalletToDriver,
  transferUserWallet,
  updateCurrentUser,
  uploadUserProfileImage,
  verifyRazorpayWalletTopup,
  verifyPhonePeWalletTopup,
  verifyUserOtpRequest,
  verifyUserPhoneForOtpLogin,
  getAvailableSubscriptionPlans,
  getMySubscriptions,
  buySubscription,
} from '../controllers/userController.js';
import {
  searchPoolingRoutes,
  getPoolingRouteDetails,
  createPoolingBookingOrder,
  verifyPoolingBookingPayment,
  createPoolingBooking,
  getMyPoolingBookings
} from '../controllers/poolingController.js';
import { getAppBootstrap, getAppModules, getGeneralSettingsCategory, getPublicSetPrices, getPublicVehicleTypeCatalog } from '../../admin/controllers/adminController.js';
import { triggerUserSosAlert } from '../../safety/controllers/safetyController.js';

export const userRouter = Router();

userRouter.get('/bootstrap', asyncHandler(getAppBootstrap));
userRouter.get('/app-modules', asyncHandler(getAppModules));
userRouter.get('/settings/:category', asyncHandler(getGeneralSettingsCategory));
userRouter.get('/intercity-packages', asyncHandler(getIntercityPackageCatalog));
userRouter.get('/vehicle-types', asyncHandler(getPublicVehicleTypeCatalog));
userRouter.get('/set-prices', asyncHandler(getPublicSetPrices));
userRouter.get('/service-locations', asyncHandler(listPublicServiceLocations));
userRouter.get('/airports', asyncHandler(listPublicAirports));
userRouter.get('/railway-stations', asyncHandler(listPublicRailwayStations));
userRouter.post('/register', asyncHandler(registerUser));
userRouter.post('/signup', asyncHandler(signupUser));
userRouter.post('/login', asyncHandler(loginUser));
userRouter.post('/profile-image', asyncHandler(uploadUserProfileImage));
userRouter.post('/auth/send-otp', asyncHandler(startUserOtpRequest));
userRouter.post('/auth/verify-otp', asyncHandler(verifyUserOtpRequest));
userRouter.post('/otp-login', asyncHandler(verifyUserPhoneForOtpLogin));
userRouter.post('/fcm-token', authenticateOrResolveUser(['user']), asyncHandler(saveUserFcmToken));
userRouter.get('/me', authenticateOrResolveUser(['user']), asyncHandler(getCurrentUser));
userRouter.patch('/me', authenticateOrResolveUser(['user']), asyncHandler(updateCurrentUser));
userRouter.get('/subscriptions/plans', authenticateOrResolveUser(['user']), asyncHandler(getAvailableSubscriptionPlans));
userRouter.get('/subscriptions/me', authenticateOrResolveUser(['user']), asyncHandler(getMySubscriptions));
userRouter.post('/subscriptions/purchase', authenticateOrResolveUser(['user']), asyncHandler(buySubscription));
userRouter.post('/me/delete-request', authenticateOrResolveUser(['user']), asyncHandler(requestAccountDeletion));
userRouter.get('/notifications', authenticateOrResolveUser(['user']), asyncHandler(getUserNotifications));
userRouter.delete('/notifications/:id', authenticateOrResolveUser(['user']), asyncHandler(deleteUserNotification));
userRouter.delete('/notifications', authenticateOrResolveUser(['user']), asyncHandler(clearAllUserNotifications));
userRouter.post('/sos', authenticateOrResolveUser(['user']), asyncHandler(triggerUserSosAlert));
userRouter.get('/wallet', authenticateOrResolveUser(['user']), asyncHandler(getUserWallet));
userRouter.post('/wallet/topup', authenticateOrResolveUser(['user']), asyncHandler(topupUserWallet));
userRouter.get('/wallet/referral-redemptions', authenticateOrResolveUser(['user']), asyncHandler(listMyReferralRedemptionRequests));
userRouter.post('/wallet/referral-redemptions', authenticateOrResolveUser(['user']), asyncHandler(requestReferralWalletRedemption));
userRouter.post('/wallet/transfer', authenticateOrResolveUser(['user']), asyncHandler(transferUserWallet));
userRouter.post('/wallet/transfer/driver', authenticateOrResolveUser(['user']), asyncHandler(transferUserWalletToDriver));
userRouter.post('/wallet/razorpay/order', authenticateOrResolveUser(['user']), asyncHandler(createRazorpayWalletTopupOrder));
userRouter.post('/wallet/razorpay/verify', authenticateOrResolveUser(['user']), asyncHandler(verifyRazorpayWalletTopup));
userRouter.post('/wallet/razorpay/callback', asyncHandler(handleUserRazorpayWalletTopupCallback));
userRouter.get('/wallet/razorpay/callback', asyncHandler(handleUserRazorpayWalletTopupCallback));
userRouter.post('/wallet/phonepe/order', authenticateOrResolveUser(['user']), asyncHandler(createPhonePeWalletTopupOrder));
userRouter.get('/wallet/phonepe/status/:merchantTransactionId', authenticateOrResolveUser(['user']), asyncHandler(verifyPhonePeWalletTopup));

userRouter.get('/pooling/search', authenticateOrResolveUser(['user']), asyncHandler(searchPoolingRoutes));
userRouter.get('/pooling/routes/:id', authenticateOrResolveUser(['user']), asyncHandler(getPoolingRouteDetails));
userRouter.post('/pooling/bookings/order', authenticateOrResolveUser(['user']), asyncHandler(createPoolingBookingOrder));
userRouter.post('/pooling/bookings/verify', authenticateOrResolveUser(['user']), asyncHandler(verifyPoolingBookingPayment));
userRouter.post('/pooling/bookings', authenticateOrResolveUser(['user']), asyncHandler(createPoolingBooking));
userRouter.get('/pooling/bookings', authenticateOrResolveUser(['user']), asyncHandler(getMyPoolingBookings));
