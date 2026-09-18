import { Router } from "express";
import { asyncHandler } from "../../../../utils/asyncHandler.js";
import { authenticate, optionalAuthenticate } from "../../middlewares/authMiddleware.js";
import {
  addDriverEmergencyContact,
  completeOnboarding,
  createOwnerBusService,
  cancelOwnerBusBookingSeats,
  createDriverPaymentQr,
  handleDriverRazorpayWalletTopupCallback,
  createServiceCenterStaffMember,
  enrollServiceCenterStaffBiometric,
  updateServiceCenterStaffMember,
  createDriverWithdrawalRequest,
  createServiceCenterVehicle,
  captureServiceCenterBookingFingerprint,
  completePoolingOnboardingRequest,
  createOwnerFleetDriver,
  createOwnerPoolingVehicle,
  removeOwnerFleetDriver,
  updateOwnerFleetDriver,
  updateOwnerPoolingVehicle,
  updateOwnerFleetVehicle,
  deleteServiceCenterBookingFingerprint,
  deleteCurrentDriverAccount,
  deleteServiceCenterVehicle,
  deleteServiceCenterStaffMember,
  updateServiceCenterVehicle,
  deleteDriverEmergencyContact,
  claimDriverIncentiveReward,
  goOffline,
  goOnline,
  createBusDriverReservation,
  getBusDriverLiveTrip,
  updateBusDriverSchedules,
  startBusDriverLiveTrip,
  updateBusDriverLiveLocation,
  updateBusDriverLiveTripStatus,
  getCurrentDriver,
  getPoolingDriverBookings,
  getBusDriverSeatLayout,
  listBusDriverBookings,
  getDriverPaymentQrStatus,
  getDriverApprovalStatus,
  getDriverDocumentTemplates,
  getDriverVehicleFieldTemplates,
  getDriverEmergencyContacts,
  getDriverIncentives,
  getDriverNotifications,
  cancelDriverScheduledRide,
  getDriverScheduledRides,
  getServiceCenterBookings,
  getServiceCenterBookingBiometrics,
  getServiceCenterStaffBiometrics,
  getServiceCenterStaffMembers,
  getServiceCenterVehicles,
  listOwnerBusServices,
  getOwnerPoolingVehicles,
  saveDriverFcmToken,
  getOwnerFleetDrivers,
  getOwnerFleetDashboard,
  getOwnerFleetAnalytics,
  addOwnerHiredDriver,
  assignOwnerVehicleToDriver,
  enableOwnerSelfDrive,
  switchOwnerToSelfDriveSession,
  getOwnerFleetZones,
  getOwnerBusBookingCalendar,
  getOwnerBusBookings,
  getMyWallet,
  getOnboardingSession,
  getServiceLocations,
  loginDriver,
  startDriverLoginOtpRequest,
  startPoolingOnboardingRequest,
  saveOnboardingDocuments,
  saveOnboardingPersonal,
  saveOnboardingReferral,
  getOnboardingReferralProgram,
  saveOnboardingVehicle,
  registerDriver,
  requestDriverAccountDeletion,
    startOnboarding,
    topUpMyWallet,
    createDriverWalletTopupOrder,
    createDriverPhonePeWalletTopupOrder,
    verifyDriverWalletTopup,
    verifyDriverPhonePeWalletTopup,

  updateCurrentDriver,
  updateDriverVehicle,
  updateOwnerBusService,
  updateServiceCenterBookingBiometrics,
  updateServiceCenterBooking,
  verifyServiceCenterBookingFingerprint,
  verifyOnboardingOtp,
  verifyDriverLoginOtpRequest,
  verifyPoolingOnboardingOtpRequest,
  addOwnerVehicle,
  deleteOwnerBusService,
  deleteOwnerPoolingVehicle,
  getOwnerFleetVehicles,
  deleteOwnerFleetVehicle,
  updateCurrentDriverDocument,
  getPoolingOnboardingSessionRequest,
  savePoolingOnboardingDetailsRequest,
  uploadPoolingOnboardingImageRequest,
} from "../controllers/driverController.js";
import { triggerDriverSosAlert } from '../../safety/controllers/safetyController.js';

export const driverRouter = Router();

driverRouter.post("/register", asyncHandler(registerDriver));
driverRouter.post("/login", asyncHandler(loginDriver));
driverRouter.post("/auth/send-otp", asyncHandler(startDriverLoginOtpRequest));
driverRouter.post(
  "/auth/verify-otp",
  asyncHandler(verifyDriverLoginOtpRequest),
);
driverRouter.post(
  "/pooling/onboarding/send-otp",
  asyncHandler(startPoolingOnboardingRequest),
);
driverRouter.post(
  "/pooling/onboarding/verify-otp",
  asyncHandler(verifyPoolingOnboardingOtpRequest),
);
driverRouter.get(
  "/pooling/onboarding/session/:registrationId",
  asyncHandler(getPoolingOnboardingSessionRequest),
);
driverRouter.patch(
  "/pooling/onboarding/details",
  asyncHandler(savePoolingOnboardingDetailsRequest),
);
driverRouter.post(
  "/pooling/onboarding/complete",
  asyncHandler(completePoolingOnboardingRequest),
);
driverRouter.post(
  "/pooling/onboarding/upload-image",
  asyncHandler(uploadPoolingOnboardingImageRequest),
);
driverRouter.get(
  "/me",
  authenticate(["driver", "owner", "pooling_driver", "bus_driver", "service_center", "service_center_staff"], { allowPending: true }),
  asyncHandler(getCurrentDriver),
);
driverRouter.get(
  "/pooling/bookings",
  authenticate(["pooling_driver"], { allowPending: true }),
  asyncHandler(getPoolingDriverBookings),
);
driverRouter.patch(
  "/me",
  authenticate(["driver", "owner"]),
  asyncHandler(updateCurrentDriver),
);
driverRouter.get(
  "/bus/seats",
  authenticate(["bus_driver"]),
  asyncHandler(getBusDriverSeatLayout),
);
driverRouter.get(
  "/bus/bookings",
  authenticate(["bus_driver"]),
  asyncHandler(listBusDriverBookings),
);
driverRouter.post(
  "/bus/reservations",
  authenticate(["bus_driver"]),
  asyncHandler(createBusDriverReservation),
);
driverRouter.get(
  "/bus/live-trip",
  authenticate(["bus_driver"]),
  asyncHandler(getBusDriverLiveTrip),
);
driverRouter.post(
  "/bus/live-trip/start",
  authenticate(["bus_driver"]),
  asyncHandler(startBusDriverLiveTrip),
);
driverRouter.patch(
  "/bus/live-trip/location",
  authenticate(["bus_driver"]),
  asyncHandler(updateBusDriverLiveLocation),
);
driverRouter.patch(
  "/bus/live-trip/status",
  authenticate(["bus_driver"]),
  asyncHandler(updateBusDriverLiveTripStatus),
);
driverRouter.patch(
  "/bus/schedules",
  authenticate(["bus_driver"]),
  asyncHandler(updateBusDriverSchedules),
);
driverRouter.delete(
  "/me",
  authenticate(["driver", "owner"]),
  asyncHandler(deleteCurrentDriverAccount),
);
driverRouter.post(
  "/me/delete-request",
  authenticate(["driver"]),
  asyncHandler(requestDriverAccountDeletion),
);
driverRouter.post(
  "/sos",
  authenticate(["driver", "owner"]),
  asyncHandler(triggerDriverSosAlert),
);
driverRouter.get(
  "/emergency-contacts",
  authenticate(["driver", "owner"]),
  asyncHandler(getDriverEmergencyContacts),
);
driverRouter.post(
  "/emergency-contacts",
  authenticate(["driver", "owner"]),
  asyncHandler(addDriverEmergencyContact),
);
driverRouter.delete(
  "/emergency-contacts/:contactId",
  authenticate(["driver", "owner"]),
  asyncHandler(deleteDriverEmergencyContact),
);
driverRouter.patch(
  "/documents/:documentKey",
  authenticate(["driver", "owner"], { allowPending: true }),
  asyncHandler(updateCurrentDriverDocument),
);
driverRouter.get(
  "/notifications",
  authenticate(["driver", "owner"]),
  asyncHandler(getDriverNotifications),
);
driverRouter.get(
  "/scheduled-rides",
  authenticate(["driver"]),
  asyncHandler(getDriverScheduledRides),
);
driverRouter.post(
  "/scheduled-rides/:rideId/cancel",
  authenticate(["driver"]),
  asyncHandler(cancelDriverScheduledRide),
);
driverRouter.post(
  "/fcm-token",
  authenticate([
    "driver",
    "owner",
    "pooling_driver",
    "bus_driver",
    "service_center",
    "service_center_staff",
  ], { allowPending: true }),
  asyncHandler(saveDriverFcmToken),
);
import {
  getDriverSubscriptionTiersController,
  getCurrentDriverSubscriptionController,
  createDriverSubscriptionCheckoutController,
  verifyDriverSubscriptionPaymentController,
  toggleDriverRenewalRemindersController,
  razorpayWebhookController,
} from '../controllers/driverController.js';

import {
  updateDriverCapabilitiesController,
} from '../controllers/driverController.js';

driverRouter.get('/subscription/tiers', optionalAuthenticate(['driver']), asyncHandler(getDriverSubscriptionTiersController));
driverRouter.get('/subscription/current', authenticate(['driver']), asyncHandler(getCurrentDriverSubscriptionController));
driverRouter.post('/subscription/checkout', authenticate(['driver']), asyncHandler(createDriverSubscriptionCheckoutController));
driverRouter.post('/subscription/verify-payment', authenticate(['driver']), asyncHandler(verifyDriverSubscriptionPaymentController));
driverRouter.post('/subscription/toggle-reminders', authenticate(['driver']), asyncHandler(toggleDriverRenewalRemindersController));
driverRouter.post('/webhooks/razorpay', asyncHandler(razorpayWebhookController));
driverRouter.patch('/capabilities', authenticate(['driver']), asyncHandler(updateDriverCapabilitiesController));

driverRouter.get(
  "/wallet",
  authenticate(["driver", "owner"]),
  asyncHandler(getMyWallet),
);
driverRouter.get(
  "/incentives",
  authenticate(["driver", "owner"]),
  asyncHandler(getDriverIncentives),
);
driverRouter.post(
  "/incentives/claim",
  authenticate(["driver"]),
  asyncHandler(claimDriverIncentiveReward),
);
driverRouter.post(
  "/wallet/top-up",
  authenticate(["driver"]),
  asyncHandler(topUpMyWallet),
);
driverRouter.post(
  "/wallet/top-up/razorpay/callback",
  asyncHandler(handleDriverRazorpayWalletTopupCallback),
);
driverRouter.get(
  "/wallet/top-up/razorpay/callback",
  asyncHandler(handleDriverRazorpayWalletTopupCallback),
);
  driverRouter.post(
    "/wallet/top-up/razorpay/order",
    authenticate(["driver", "owner"]),
    asyncHandler(createDriverWalletTopupOrder),
  );
  driverRouter.post(
    "/wallet/top-up/phonepe/order",
    authenticate(["driver", "owner"]),
    asyncHandler(createDriverPhonePeWalletTopupOrder),
  );
  driverRouter.post(
    "/wallet/top-up/razorpay/verify",
    authenticate(["driver", "owner"]),
    asyncHandler(verifyDriverWalletTopup),
  );
  driverRouter.get(
    "/wallet/top-up/phonepe/status/:merchantTransactionId",
    authenticate(["driver", "owner"]),
    asyncHandler(verifyDriverPhonePeWalletTopup),
  );
driverRouter.post(
  "/wallet/withdrawals",
  authenticate(["driver", "owner"]),
  asyncHandler(createDriverWithdrawalRequest),
);

driverRouter.post(
  "/payments/qr",
  authenticate(["driver"]),
  asyncHandler(createDriverPaymentQr),
);
driverRouter.get(
  "/payments/qr/status",
  authenticate(["driver"]),
  asyncHandler(getDriverPaymentQrStatus),
);
driverRouter.patch(
  "/vehicle",
  authenticate(["driver"]),
  asyncHandler(updateDriverVehicle),
);
driverRouter.get("/approval-status", asyncHandler(getDriverApprovalStatus));
driverRouter.get(
  "/fleet/dashboard",
  authenticate(["owner"]),
  asyncHandler(getOwnerFleetDashboard),
);
driverRouter.get(
  "/fleet/analytics",
  authenticate(["owner"]),
  asyncHandler(getOwnerFleetAnalytics),
);
driverRouter.post(
  "/fleet/hired-drivers",
  authenticate(["owner"]),
  asyncHandler(addOwnerHiredDriver),
);
driverRouter.post(
  "/fleet/assign-vehicle",
  authenticate(["owner"]),
  asyncHandler(assignOwnerVehicleToDriver),
);
driverRouter.post(
  "/fleet/enable-self-drive",
  authenticate(["owner"]),
  asyncHandler(enableOwnerSelfDrive),
);
driverRouter.post(
  "/fleet/self-drive-session",
  authenticate(["owner"]),
  asyncHandler(switchOwnerToSelfDriveSession),
);
driverRouter.get(
  "/fleet/bus-services",
  authenticate(["owner"]),
  asyncHandler(listOwnerBusServices),
);
driverRouter.get(
  "/fleet/bus-bookings",
  authenticate(["owner"]),
  asyncHandler(getOwnerBusBookings),
);
driverRouter.get(
  "/fleet/bus-bookings/calendar",
  authenticate(["owner"]),
  asyncHandler(getOwnerBusBookingCalendar),
);
driverRouter.post(
  "/fleet/bus-services",
  authenticate(["owner"]),
  asyncHandler(createOwnerBusService),
);
driverRouter.patch(
  "/fleet/bus-services/:id",
  authenticate(["owner"]),
  asyncHandler(updateOwnerBusService),
);
driverRouter.delete(
  "/fleet/bus-services/:id",
  authenticate(["owner"]),
  asyncHandler(deleteOwnerBusService),
);
driverRouter.post(
  "/fleet/bus-bookings/:id/cancel",
  authenticate(["owner"]),
  asyncHandler(cancelOwnerBusBookingSeats),
);
driverRouter.get(
  "/fleet/drivers",
  authenticate(["driver", "owner"]),
  asyncHandler(getOwnerFleetDrivers),
);
driverRouter.get(
  "/fleet/zones",
  authenticate(["driver", "owner"]),
  asyncHandler(getOwnerFleetZones),
);
driverRouter.post(
  "/fleet/drivers",
  authenticate(["driver", "owner"]),
  asyncHandler(createOwnerFleetDriver),
);
driverRouter.patch(
  "/fleet/drivers/:driverId",
  authenticate(["driver", "owner"]),
  asyncHandler(updateOwnerFleetDriver),
);
driverRouter.delete(
  "/fleet/drivers/:driverId",
  authenticate(["driver", "owner"]),
  asyncHandler(removeOwnerFleetDriver),
);
driverRouter.get(
  "/fleet/vehicles",
  authenticate(["driver", "owner"]),
  asyncHandler(getOwnerFleetVehicles),
);
driverRouter.post(
  "/fleet/vehicles",
  authenticate(["driver", "owner"]),
  asyncHandler(addOwnerVehicle),
);
driverRouter.patch(
  "/fleet/vehicles/:vehicleId",
  authenticate(["driver", "owner"]),
  asyncHandler(updateOwnerFleetVehicle),
);
driverRouter.delete(
  "/fleet/vehicles/:vehicleId",
  authenticate(["driver", "owner"]),
  asyncHandler(deleteOwnerFleetVehicle),
);
driverRouter.get(
  "/fleet/pooling-vehicles",
  authenticate(["owner"]),
  asyncHandler(getOwnerPoolingVehicles),
);
driverRouter.post(
  "/fleet/pooling-vehicles",
  authenticate(["owner"]),
  asyncHandler(createOwnerPoolingVehicle),
);
driverRouter.patch(
  "/fleet/pooling-vehicles/:vehicleId",
  authenticate(["owner"]),
  asyncHandler(updateOwnerPoolingVehicle),
);
driverRouter.delete(
  "/fleet/pooling-vehicles/:vehicleId",
  authenticate(["owner"]),
  asyncHandler(deleteOwnerPoolingVehicle),
);
driverRouter.get(
  "/service-center/staff",
  authenticate(["service_center"]),
  asyncHandler(getServiceCenterStaffMembers),
);
driverRouter.post(
  "/service-center/staff",
  authenticate(["service_center"]),
  asyncHandler(createServiceCenterStaffMember),
);
driverRouter.patch(
  "/service-center/staff/:staffId",
  authenticate(["service_center"]),
  asyncHandler(updateServiceCenterStaffMember),
);
driverRouter.delete(
  "/service-center/staff/:staffId",
  authenticate(["service_center"]),
  asyncHandler(deleteServiceCenterStaffMember),
);
driverRouter.get(
  "/service-center/staff/:staffId/biometrics",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(getServiceCenterStaffBiometrics),
);
driverRouter.post(
  "/service-center/staff/biometrics/enroll",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(enrollServiceCenterStaffBiometric),
);
driverRouter.get(
  "/service-center/bookings",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(getServiceCenterBookings),
);
driverRouter.get(
  "/service-center/bookings/:bookingId/biometrics",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(getServiceCenterBookingBiometrics),
);
driverRouter.patch(
  "/service-center/bookings/:bookingId/biometrics",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(updateServiceCenterBookingBiometrics),
);
driverRouter.post(
  "/service-center/bookings/:bookingId/biometrics/fingers",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(captureServiceCenterBookingFingerprint),
);
driverRouter.delete(
  "/service-center/bookings/:bookingId/biometrics/fingers/:fingerCode",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(deleteServiceCenterBookingFingerprint),
);
driverRouter.post(
  "/service-center/bookings/:bookingId/biometrics/verify",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(verifyServiceCenterBookingFingerprint),
);
driverRouter.patch(
  "/service-center/bookings/:bookingId",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(updateServiceCenterBooking),
);
driverRouter.get(
  "/service-center/vehicles",
  authenticate(["service_center", "service_center_staff"]),
  asyncHandler(getServiceCenterVehicles),
);
driverRouter.post(
  "/service-center/vehicles",
  authenticate(["service_center"]),
  asyncHandler(createServiceCenterVehicle),
);
driverRouter.patch(
  "/service-center/vehicles/:vehicleId",
  authenticate(["service_center"]),
  asyncHandler(updateServiceCenterVehicle),
);
driverRouter.delete(
  "/service-center/vehicles/:vehicleId",
  authenticate(["service_center"]),
  asyncHandler(deleteServiceCenterVehicle),
);
driverRouter.get("/service-locations", asyncHandler(getServiceLocations));
driverRouter.get(
  "/document-templates",
  asyncHandler(getDriverDocumentTemplates),
);
driverRouter.get(
  "/vehicle-field-templates",
  asyncHandler(getDriverVehicleFieldTemplates),
);
driverRouter.post("/onboarding/send-otp", asyncHandler(startOnboarding));
driverRouter.post("/onboarding/verify-otp", asyncHandler(verifyOnboardingOtp));
driverRouter.patch(
  "/onboarding/personal",
  asyncHandler(saveOnboardingPersonal),
);
driverRouter.patch(
  "/onboarding/referral",
  asyncHandler(saveOnboardingReferral),
);
driverRouter.get(
  "/onboarding/referral-program",
  asyncHandler(getOnboardingReferralProgram),
);
driverRouter.patch("/onboarding/vehicle", asyncHandler(saveOnboardingVehicle));
driverRouter.patch(
  "/onboarding/documents",
  asyncHandler(saveOnboardingDocuments),
);
driverRouter.post("/onboarding/complete", asyncHandler(completeOnboarding));
driverRouter.get(
  "/onboarding/session/:registrationId",
  asyncHandler(getOnboardingSession),
);
driverRouter.patch("/online", authenticate(["driver"]), asyncHandler(goOnline));
driverRouter.patch(
  "/offline",
  authenticate(["driver"]),
  asyncHandler(goOffline),
);
