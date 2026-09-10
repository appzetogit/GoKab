import api from "../../../shared/api/axiosInstance";

const STORAGE_KEY = "driverRegistrationSession";
const DRIVER_AUTH_KEYS = ["token", "driverToken", "driverInfo", "role", "driverRole", "chatRole"];
const DRIVER_PORTAL_ROLES = ["driver", "owner", "vendor", "super_fleet_owner", "bus_driver", "service_center", "service_center_staff", "pooling_driver"];
const readSessionValue = (key) => {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
};
const writeSessionValue = (key, value) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
};
const removeSessionValue = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch {}
};

const readStoredSession = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const getStoredDriverRegistrationSession = () => readStoredSession();

export const saveDriverRegistrationSession = (session = {}) => {
  const nextSession = {
    ...readStoredSession(),
    ...session,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
  return nextSession;
};

export const clearDriverRegistrationSession = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const clearDriverAuthState = () => {
  clearDriverRegistrationSession();
  DRIVER_AUTH_KEYS.forEach((key) => {
    removeSessionValue(key);
    localStorage.removeItem(key);
  });
};

export const persistDriverAuthSession = ({ token = "", role = "driver" } = {}) => {
  const normalizedRole = String(role || "driver").toLowerCase();
  const chatRole = normalizedRole === "owner" ? "owner" : "driver";

  if (token) {
    writeSessionValue("token", token);
    writeSessionValue("driverToken", token);
    localStorage.setItem("token", token);
    localStorage.setItem("driverToken", token);
  }

  writeSessionValue("role", normalizedRole);
  writeSessionValue("driverRole", normalizedRole);
  writeSessionValue("chatRole", chatRole);
  localStorage.setItem("role", normalizedRole);
  localStorage.setItem("driverRole", normalizedRole);
  localStorage.setItem("chatRole", chatRole);
};

export const normalizeDriverPortalRole = (role) => {
  const normalized = String(role || "").toLowerCase();

  if (!normalized) return "";

  if (
    normalized === "owner" ||
    normalized === "vendor" ||
    normalized === "super_fleet_owner" ||
    normalized === "super-fleet-owner" ||
    normalized === "superfleetowner"
  ) {
    return "owner";
  }
  if (normalized === "service_center" || normalized === "service-center" || normalized === "servicecenter") {
    return "service_center";
  }
  if (normalized === "service_center_staff" || normalized === "service-center-staff" || normalized === "servicecenterstaff") {
    return "service_center_staff";
  }
  if (normalized === "bus_driver" || normalized === "bus-driver" || normalized === "busdriver") {
    return "bus_driver";
  }
  if (normalized === "pooling_driver" || normalized === "pooling-driver" || normalized === "poolingdriver") {
    return "pooling_driver";
  }

  if (normalized === "user" || normalized === "admin") {
    return "";
  }

  return "driver";
};

export const sendDriverOtp = (payload) =>
  api.post("/drivers/onboarding/send-otp", payload);

export const verifyDriverOtp = (payload) =>
  api.post("/drivers/onboarding/verify-otp", payload);

export const sendDriverLoginOtp = (payload) =>
  api.post("/drivers/auth/send-otp", payload);

export const verifyDriverLoginOtp = (payload) =>
  api.post("/drivers/auth/verify-otp", payload);

export const getDriverOnboardingSession = ({ registrationId, phone }) =>
  api.get(`/drivers/onboarding/session/${encodeURIComponent(registrationId)}`, {
    params: phone ? { phone } : {},
  });

export const saveDriverPersonalDetails = (payload) =>
  api.patch("/drivers/onboarding/personal", payload);

export const saveDriverReferral = (payload) =>
  api.patch("/drivers/onboarding/referral", payload);

export const getDriverReferralProgram = () =>
  api.get("/drivers/onboarding/referral-program");

export const saveDriverVehicle = (payload) =>
  api.patch("/drivers/onboarding/vehicle", payload);

export const saveDriverDocuments = (payload) =>
  api.patch("/drivers/onboarding/documents", payload);

export const completeDriverOnboarding = (payload) =>
  api.post("/drivers/onboarding/complete", payload);

export const buildDriverOnboardingSessionSnapshot = (payload = {}, fallbackSession = {}) => {
  const serverSession = payload?.session || {};
  const personal = payload?.personal || {};
  const vehicle = payload?.vehicle || {};
  const documents = payload?.documents || {};

  return {
    ...fallbackSession,
    registrationId: serverSession.registrationId || fallbackSession.registrationId || "",
    phone: serverSession.phone || fallbackSession.phone || "",
    role: serverSession.role || fallbackSession.role || "driver",
    status: serverSession.status || fallbackSession.status || "",
    otpVerified:
      serverSession.otpVerified === true
      || serverSession.status === "otp_verified"
      || serverSession.status === "personal_saved"
      || serverSession.status === "vehicle_saved"
      || serverSession.status === "documents_saved",
    fullName: personal.fullName || fallbackSession.fullName || "",
    email: personal.email || fallbackSession.email || "",
    gender: personal.gender || fallbackSession.gender || "",
    referralCode:
      payload?.referralCode !== undefined
        ? payload.referralCode
        : (fallbackSession.referralCode || ""),
    registerFor: vehicle.registerFor || fallbackSession.registerFor || "",
    serviceCategories: Array.isArray(vehicle.serviceCategories)
      ? vehicle.serviceCategories
      : (fallbackSession.serviceCategories || []),
    locationId: vehicle.locationId || fallbackSession.locationId || "",
    vehicleTypeId: vehicle.vehicleTypeId || fallbackSession.vehicleTypeId || "",
    make: vehicle.make || fallbackSession.make || "",
    model: vehicle.model || fallbackSession.model || "",
    year: vehicle.year || fallbackSession.year || "",
    number: vehicle.number || fallbackSession.number || "",
    color: vehicle.color || fallbackSession.color || "",
    companyName: vehicle.companyName || fallbackSession.companyName || "",
    companyAddress: vehicle.companyAddress || fallbackSession.companyAddress || "",
    city: vehicle.city || fallbackSession.city || "",
    postalCode: vehicle.postalCode || fallbackSession.postalCode || "",
    taxNumber: vehicle.taxNumber || fallbackSession.taxNumber || "",
    customFields: vehicle.customFields || fallbackSession.customFields || {},
    documents,
    otpSession: payload?.session || fallbackSession.otpSession || null,
    personalSession: payload?.session || fallbackSession.personalSession || null,
    referralSession: payload?.session || fallbackSession.referralSession || null,
    vehicleSession: payload?.session
      ? {
          ...(fallbackSession.vehicleSession || {}),
          vehicle,
          status: payload?.session?.status || fallbackSession.vehicleSession?.status || "",
        }
      : (fallbackSession.vehicleSession || null),
  };
};

export const getDriverOnboardingResumeStep = (session = {}) => {
  const status = String(session?.status || "").toLowerCase();
  const hasOtp = Boolean(session?.otpVerified);
  const hasPersonal = Boolean(
    String(session?.fullName || "").trim()
    && String(session?.email || "").trim()
    && String(session?.gender || "").trim(),
  );
  const hasVehicle = Boolean(
    String(session?.locationId || "").trim()
    && (
      String(session?.role || "").toLowerCase() === "owner"
        ? String(session?.companyName || "").trim()
        : String(session?.vehicleTypeId || "").trim()
    ),
  );

  if (!hasOtp && status !== "otp_verified" && status !== "personal_saved" && status !== "vehicle_saved" && status !== "documents_saved") {
    return "otp-verify";
  }

  if (status === "vehicle_saved" || status === "documents_saved" || hasVehicle) {
    return "step-documents";
  }

  if (status === "personal_saved" || hasPersonal) {
    return "step-referral";
  }

  return "step-personal";
};

const decodeBase64Url = (value) => {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return normalized + "=".repeat(padding);
};

export const getTokenPayload = (token) => {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return null;
    }
    return JSON.parse(atob(decodeBase64Url(payload)));
  } catch {
    return null;
  }
};

const getPersistedDriverToken = () => {
  const persistedDriverToken = String(localStorage.getItem("driverToken") || "");
  if (persistedDriverToken) {
    return persistedDriverToken;
  }

  const persistedGenericToken = String(localStorage.getItem("token") || "");
  if (DRIVER_PORTAL_ROLES.includes(normalizeDriverPortalRole(getTokenPayload(persistedGenericToken)?.role))) {
    return persistedGenericToken;
  }

  return "";
};

export const hydrateDriverAuthSessionFromStorage = () => {
  const persistedToken = getPersistedDriverToken();
  const persistedRole =
    normalizeDriverPortalRole(getTokenPayload(persistedToken)?.role)
    || normalizeDriverPortalRole(localStorage.getItem("driverRole"))
    || normalizeDriverPortalRole(localStorage.getItem("role"));

  if (!persistedToken && !persistedRole) {
    return {
      token: "",
      role: "",
    };
  }

  if (persistedToken && !readSessionValue("token")) {
    writeSessionValue("token", persistedToken);
  }

  if (persistedToken && !readSessionValue("driverToken")) {
    writeSessionValue("driverToken", persistedToken);
  }

  if (persistedRole && !readSessionValue("role")) {
    writeSessionValue("role", persistedRole);
  }

  if (persistedRole && !readSessionValue("driverRole")) {
    writeSessionValue("driverRole", persistedRole);
  }

  const chatRole = persistedRole === "owner" ? "owner" : persistedRole ? "driver" : "";
  if (chatRole && !readSessionValue("chatRole")) {
    writeSessionValue("chatRole", chatRole);
  }

  return {
    token: persistedToken,
    role: persistedRole,
  };
};

export const getStoredDriverRole = () => {
  const hydrated = hydrateDriverAuthSessionFromStorage();
  return (
    readSessionValue("driverRole")
    || readSessionValue("role")
    || hydrated.role
    || String(localStorage.getItem("driverRole") || localStorage.getItem("role") || "driver").toLowerCase()
  );
};

const readLocalDriverToken = () => {
  hydrateDriverAuthSessionFromStorage();

  const direct = readSessionValue("driverToken");
  if (direct) return direct;

  const fallback = readSessionValue("token");
  if (DRIVER_PORTAL_ROLES.includes(normalizeDriverPortalRole(getTokenPayload(fallback)?.role))) {
    return fallback;
  }

  return getPersistedDriverToken();
};

export const getLocalDriverToken = readLocalDriverToken;

export const getAuthenticatedDriverRole = () => {
  const tokenPayloadRole = normalizeDriverPortalRole(getTokenPayload(readLocalDriverToken())?.role);
  const storedRole = normalizeDriverPortalRole(getStoredDriverRole());

  return tokenPayloadRole || storedRole || "driver";
};

const withDriverAuth = (config = {}) => {
  const token = readLocalDriverToken();

  if (!token) {
    return config;
  }

  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
};

export const getCurrentDriver = () => api.get("/drivers/me", withDriverAuth());

export const getDriverRideHistory = (params = {}) =>
  api.get("/rides", withDriverAuth({ params }));

export const updateDriverProfile = (payload) =>
  api.patch("/drivers/me", payload, withDriverAuth());
export const deleteCurrentDriverAccount = (reason = "") =>
  api.delete("/drivers/me", withDriverAuth({ data: { reason } }));
export const requestDriverAccountDeletion = (reason) =>
  api.post("/drivers/me/delete-request", { reason }, withDriverAuth());
export const getDriverNotifications = (params = {}) =>
  api.get("/drivers/notifications", withDriverAuth({ params }));
export const getDriverScheduledRides = (params = {}) =>
  api.get("/drivers/scheduled-rides", withDriverAuth({ params }));
export const cancelDriverScheduledRide = (rideId) =>
  api.post(`/drivers/scheduled-rides/${rideId}/cancel`, {}, withDriverAuth());
export const deleteDriverNotification = (id) =>
  api.delete(`/drivers/notifications/${id}`, withDriverAuth());
export const clearAllDriverNotifications = () =>
  api.delete("/drivers/notifications", withDriverAuth());
export const getDriverEmergencyContacts = () =>
  api.get("/drivers/emergency-contacts", withDriverAuth());

export const saveDriverFcmToken = (token, platform) => {
  console.log("🔑 [DRIVER FCM TOKEN]:", token, `(Platform: ${platform || 'web'})`);
  return api.post("/drivers/fcm-token", { token, platform }, withDriverAuth());
};
export const addDriverEmergencyContact = (payload) =>
  api.post("/drivers/emergency-contacts", payload, withDriverAuth());
export const deleteDriverEmergencyContact = (contactId) =>
  api.delete(`/drivers/emergency-contacts/${contactId}`, withDriverAuth());

export const updateDriverVehicle = (payload) =>
  api.patch("/drivers/vehicle", payload, withDriverAuth());

export const deleteDriverVehicle = (vehicleId) =>
  api.delete(`/drivers/vehicle/${vehicleId}`, withDriverAuth());

export const getDriverVehicleTypes = async () => {
  const authConfig = withDriverAuth();
  const hasDriverAuthorization = Boolean(
    authConfig?.headers?.Authorization || authConfig?.headers?.authorization,
  );

  if (hasDriverAuthorization) {
    try {
      return await api.get("/admin/types/vehicle-types", authConfig);
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status && status !== 401 && status !== 403) {
        throw error;
      }
    }
  }

  return api.get("/users/vehicle-types");
};

export const getDriverApprovalStatus = () => {
  return api.get(
    "/drivers/approval-status",
    withDriverAuth({
      params: {
        t: Date.now(),
      },
    }),
  );
};

export const getOwnerFleetDrivers = () =>
  api.get("/drivers/fleet/drivers", withDriverAuth());

export const getOwnerFleetDashboard = () =>
  api.get("/drivers/fleet/dashboard", withDriverAuth());

export const getOwnerFleetAnalytics = () =>
  api.get("/drivers/fleet/analytics", withDriverAuth());

export const addOwnerHiredDriver = (payload) =>
  api.post("/drivers/fleet/hired-drivers", payload, withDriverAuth());

export const assignOwnerVehicleToDriver = (payload) =>
  api.post("/drivers/fleet/assign-vehicle", payload, withDriverAuth());

export const enableOwnerSelfDrive = () =>
  api.post("/drivers/fleet/enable-self-drive", {}, withDriverAuth());

export const switchOwnerToSelfDriveSession = () =>
  api.post("/drivers/fleet/self-drive-session", {}, withDriverAuth());

export const getOwnerFleetZones = () =>
  api.get("/drivers/fleet/zones", withDriverAuth());

export const createOwnerFleetDriver = (payload) =>
  api.post("/drivers/fleet/drivers", payload, withDriverAuth());

export const updateOwnerFleetDriver = (driverId, payload) =>
  api.patch(`/drivers/fleet/drivers/${driverId}`, payload, withDriverAuth());

export const removeOwnerFleetDriver = (driverId) =>
  api.delete(`/drivers/fleet/drivers/${driverId}`, withDriverAuth());

export const getOwnerFleetVehicles = () =>
  api.get("/drivers/fleet/vehicles", withDriverAuth());

export const getOwnerBusServices = () =>
  api.get("/drivers/fleet/bus-services", withDriverAuth());

export const getOwnerBusBookings = (params = {}) =>
  api.get("/drivers/fleet/bus-bookings", withDriverAuth({ params }));

export const getOwnerBusBookingCalendar = (params = {}) =>
  api.get("/drivers/fleet/bus-bookings/calendar", withDriverAuth({ params }));

export const cancelOwnerBusBookingSeats = (bookingId, payload = {}) =>
  api.post(`/drivers/fleet/bus-bookings/${bookingId}/cancel`, payload, withDriverAuth());

export const createOwnerBusService = (payload) =>
  api.post("/drivers/fleet/bus-services", payload, withDriverAuth());

export const updateOwnerBusService = (busId, payload) =>
  api.patch(`/drivers/fleet/bus-services/${busId}`, payload, withDriverAuth());

export const deleteOwnerBusService = (busId) =>
  api.delete(`/drivers/fleet/bus-services/${busId}`, withDriverAuth());

export const createOwnerFleetVehicle = (payload) =>
  api.post("/drivers/fleet/vehicles", payload, withDriverAuth());

export const updateOwnerFleetVehicle = (vehicleId, payload) =>
  api.patch(`/drivers/fleet/vehicles/${vehicleId}`, payload, withDriverAuth());

export const deleteOwnerFleetVehicle = (vehicleId) =>
  api.delete(`/drivers/fleet/vehicles/${vehicleId}`, withDriverAuth());

export const getServiceCenterVehicles = () =>
  api.get("/drivers/service-center/vehicles", withDriverAuth());

export const createServiceCenterVehicle = (payload) =>
  api.post("/drivers/service-center/vehicles", payload, withDriverAuth());

export const updateServiceCenterVehicle = (vehicleId, payload) =>
  api.patch(`/drivers/service-center/vehicles/${vehicleId}`, payload, withDriverAuth());

export const deleteServiceCenterVehicle = (vehicleId) =>
  api.delete(`/drivers/service-center/vehicles/${vehicleId}`, withDriverAuth());

export const getServiceCenterStaff = () =>
  api.get("/drivers/service-center/staff", withDriverAuth());

export const createServiceCenterStaff = (payload) =>
  api.post("/drivers/service-center/staff", payload, withDriverAuth());

export const updateServiceCenterStaff = (staffId, payload) =>
  api.patch(`/drivers/service-center/staff/${staffId}`, payload, withDriverAuth());

export const deleteServiceCenterStaff = (staffId) =>
  api.delete(`/drivers/service-center/staff/${staffId}`, withDriverAuth());

export const getServiceCenterStaffBiometrics = (staffId) =>
  api.get(`/drivers/service-center/staff/${staffId}/biometrics`, withDriverAuth());

export const enrollServiceCenterStaffBiometric = (payload) =>
  api.post("/drivers/service-center/staff/biometrics/enroll", payload, withDriverAuth());

export const getServiceCenterBookings = () =>
  api.get("/drivers/service-center/bookings", withDriverAuth());

export const getServiceCenterBookingBiometrics = (bookingId) =>
  api.get(`/drivers/service-center/bookings/${bookingId}/biometrics`, withDriverAuth());

export const updateServiceCenterBookingBiometrics = (bookingId, payload) =>
  api.patch(`/drivers/service-center/bookings/${bookingId}/biometrics`, payload, withDriverAuth());

export const captureServiceCenterBookingFingerprint = (bookingId, payload) =>
  api.post(`/drivers/service-center/bookings/${bookingId}/biometrics/fingers`, payload, withDriverAuth());

export const deleteServiceCenterBookingFingerprint = (bookingId, fingerCode) =>
  api.delete(`/drivers/service-center/bookings/${bookingId}/biometrics/fingers/${encodeURIComponent(String(fingerCode || '').trim().toUpperCase())}`, withDriverAuth());

export const verifyServiceCenterBookingFingerprint = (bookingId, payload) =>
  api.post(`/drivers/service-center/bookings/${bookingId}/biometrics/verify`, payload, withDriverAuth());

export const updateServiceCenterBooking = (bookingId, payload) =>
  api.patch(`/drivers/service-center/bookings/${bookingId}`, payload, withDriverAuth());

export const getDriverRegistrationSession = ({ registrationId, phone }) =>
  api.get(`/drivers/onboarding/session/${registrationId}`, {
    params: { phone },
  });

export const getDriverServiceLocations = () =>
  api.get("/drivers/service-locations");
export const getDriverDocumentTemplates = (role = "driver") =>
  api.get("/drivers/document-templates", {
    params: {
      role,
    },
  });

export const getDriverVehicleFieldTemplates = (role = "driver") =>
  api.get("/drivers/vehicle-field-templates", {
    params: {
      role,
    },
  });

export const updateDriverDocument = (documentKey, document) =>
  api.patch(
    `/drivers/documents/${encodeURIComponent(documentKey)}`,
    { document },
    withDriverAuth(),
  );

export const getDriverIncentives = () =>
  api.get("/drivers/incentives", withDriverAuth());

export const claimDriverIncentiveReward = (payload) =>
  api.post("/drivers/incentives/claim", payload, withDriverAuth());

export const sendPoolingDriverOnboardingOtp = (payload) =>
  api.post("/drivers/pooling/onboarding/send-otp", payload);

export const verifyPoolingDriverOnboardingOtp = (payload) =>
  api.post("/drivers/pooling/onboarding/verify-otp", payload);

export const getPoolingDriverOnboardingSession = ({ registrationId, phone }) =>
  api.get(`/drivers/pooling/onboarding/session/${encodeURIComponent(registrationId)}`, {
    params: phone ? { phone } : {},
  });

export const savePoolingDriverOnboardingDetails = (payload) =>
  api.patch("/drivers/pooling/onboarding/details", payload);

export const completePoolingDriverOnboarding = (payload) =>
  api.post("/drivers/pooling/onboarding/complete", payload);

export const uploadPoolingDriverOnboardingImage = (payload) =>
  api.post("/drivers/pooling/onboarding/upload-image", payload);

export const getPoolingDriverBookings = () =>
  api.get("/drivers/pooling/bookings", withDriverAuth());
