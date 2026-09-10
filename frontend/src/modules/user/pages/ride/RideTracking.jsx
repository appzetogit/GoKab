import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, MessageCircle, AlertTriangle, Shield, Star, ChevronLeft, Share2, Clock3 } from 'lucide-react';
import { GoogleMap, MarkerF, OverlayView, OverlayViewF, PolylineF } from '@react-google-maps/api';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../../admin/utils/googleMaps';
import { socketService } from '../../../../shared/api/socket';
import api from '../../../../shared/api/axiosInstance';
import { BACKEND_ORIGIN } from '../../../../shared/api/runtimeConfig';
import { clearCurrentRide, getCurrentRide, saveCurrentRide } from '../../services/currentRideService';
import carIcon from '../../../../assets/icons/car.png';
import bikeIcon from '../../../../assets/icons/bike.png';
import autoIcon from '../../../../assets/icons/auto.png';
import deliveryIcon from '../../../../assets/icons/Delivery.png';
import { useSettings } from '../../../../shared/context/SettingsContext';

const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' };
const DEFAULT_CENTER = { lat: 22.7196, lng: 75.8577 };
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'delivered']);
const ACTIVE_RIDE_VALIDATE_MS = 15000;
const COMPLETED_TRACKING_STATUSES = new Set(['completed', 'delivered']);
const POST_RIDE_REDIRECT_STATUSES = new Set(['arrived', 'completed', 'delivered']);

const toLatLng = (coords, fallback = DEFAULT_CENTER) => {
  const [lng, lat] = coords || [];

  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return { lat: Number(lat), lng: Number(lng) };
  }

  return fallback;
};

const readCoordinatePair = (...sources) => {
  for (const source of sources) {
    if (Array.isArray(source) && source.length >= 2) {
      const [lng, lat] = source;
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        return [Number(lng), Number(lat)];
      }
    }

    const nestedCoords = source?.coordinates;
    if (Array.isArray(nestedCoords) && nestedCoords.length >= 2) {
      const [lng, lat] = nestedCoords;
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        return [Number(lng), Number(lat)];
      }
    }

    const lat = Number(source?.lat ?? source?.latitude);
    const lng = Number(source?.lng ?? source?.longitude ?? source?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return [Number(lng), Number(lat)];
    }
  }

  return null;
};

const arePositionsNearlyEqual = (first, second, threshold = 0.0002) => (
  Math.abs(Number(first?.lat ?? 0) - Number(second?.lat ?? 0)) < threshold &&
  Math.abs(Number(first?.lng ?? 0) - Number(second?.lng ?? 0)) < threshold
);

const normalizeHeading = (value, fallback = 0) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return ((numeric % 360) + 360) % 360;
};

const calculateBearing = (from, to, fallback = 0) => {
  if (!from || !to || arePositionsNearlyEqual(from, to, 0.00001)) {
    return fallback;
  }

  const fromLat = Number(from.lat) * (Math.PI / 180);
  const toLat = Number(to.lat) * (Math.PI / 180);
  const deltaLng = (Number(to.lng) - Number(from.lng)) * (Math.PI / 180);
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);

  return normalizeHeading(Math.atan2(y, x) * (180 / Math.PI), fallback);
};

const getRouteHeading = (position, path = [], fallback = 0) => {
  const nextPoint = path.find((point) => !arePositionsNearlyEqual(position, point, 0.00001));
  return nextPoint ? calculateBearing(position, nextPoint, fallback) : fallback;
};

const getVehicleMarkerOffset = (width, height) => ({
  x: -(width / 2),
  y: -(height / 2),
});

const RotatingVehicleMarker = ({ position, iconUrl = carIcon, heading = 0, title = 'Driver' }) => (
  <OverlayViewF
    position={position}
    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    getPixelPositionOffset={getVehicleMarkerOffset}
  >
    <div title={title} className="pointer-events-none flex h-14 w-14 items-center justify-center">
      <div
        className="flex h-11 w-11 items-center justify-center transition-transform duration-500 ease-out"
        style={{ transform: `rotate(${normalizeHeading(heading)}deg)` }}
      >
        <img
          src={iconUrl || carIcon}
          alt={title}
          className="h-12 w-12 object-contain drop-shadow-[0_8px_10px_rgba(15,23,42,0.35)]"
          draggable={false}
        />
      </div>
    </div>
  </OverlayViewF>
);

const getTrackingVehicleIcon = (ride, driver) => {
  const customIcon = String(
    ride?.vehicleIconUrl ||
    ride?.vehicle?.vehicleIconUrl ||
    ride?.vehicle?.icon ||
    driver?.vehicleIconUrl ||
    driver?.map_icon ||
    driver?.icon ||
    '',
  ).trim();

  if (customIcon) return customIcon;

  const serviceType = String(ride?.serviceType || ride?.type || '').toLowerCase();
  const iconType = String(ride?.vehicleIconType || driver?.vehicleIconType || driver?.vehicleType || '').toLowerCase();

  if (serviceType === 'parcel') return deliveryIcon;
  if (iconType.includes('bike')) return bikeIcon;
  if (iconType.includes('auto')) return autoIcon;
  return carIcon;
};

const getInitials = (name = '') =>
  String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'DR';

const unwrapApiPayload = (response) => response?.data?.data || response?.data || response;
const isLikelyVehiclePhoto = (value = '') => /^(https?:|data:image\/|blob:|\/uploads\/|\/images\/)/i.test(String(value || '').trim());
const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const pickPreferredValue = (...values) => values.find((value) => String(value || '').trim()) || '';
const resolveAssetUrl = (value = '') => {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  if (/^(https?:|data:image\/|blob:)/i.test(raw)) {
    return raw;
  }

  if (raw.startsWith('/')) {
    return `${BACKEND_ORIGIN}${raw}`;
  }

  return `${BACKEND_ORIGIN}/${raw.replace(/^\/+/, '')}`;
};

const buildRideShareText = ({ appName, driverName, vehicleNumber, pickupLabel, dropLabel }) =>
  `I'm riding with ${appName}!\nDriver: ${driverName} (${vehicleNumber || 'Assigned'})\nFrom: ${pickupLabel}\nTo: ${dropLabel}`;

const buildShareLinks = (text) => ({
  whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
  sms: `sms:?&body=${encodeURIComponent(text)}`,
});

const formatTimerClock = (totalSeconds) => {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatWholeMinutes = (value) => `${Math.max(0, Math.floor(Number(value) || 0))} min`;

const formatScheduledDateTime = (value) => {
  if (!value) {
    return 'Pickup time pending';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Pickup time pending';
  }

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getScheduledCountdownLabel = (value, now = Date.now()) => {
  const parsed = value ? new Date(value) : null;
  const time = parsed?.getTime?.() || NaN;

  if (!Number.isFinite(time)) {
    return '';
  }

  const diffMs = time - now;
  if (diffMs <= 0) {
    return 'Pickup window is open';
  }

  const totalMinutes = Math.ceil(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `Starts in ${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `Starts in ${hours}h ${minutes}m`;
  }

  return `Starts in ${minutes}m`;
};

const mergeDriverSnapshot = (baseDriver = {}, incomingDriver = {}) => {
  const safeBaseDriver = isPlainObject(baseDriver) ? baseDriver : {};
  const safeIncomingDriver = isPlainObject(incomingDriver) ? incomingDriver : {};
  const incomingVehicle = isPlainObject(safeIncomingDriver.vehicle) ? safeIncomingDriver.vehicle : {};
  const baseVehicle = isPlainObject(safeBaseDriver.vehicle) ? safeBaseDriver.vehicle : {};

  return {
    ...safeBaseDriver,
    ...safeIncomingDriver,
    profileImage: pickPreferredValue(
      safeIncomingDriver.profileImage,
      safeIncomingDriver.profile_image,
      safeIncomingDriver.image,
      safeIncomingDriver.avatar,
      safeIncomingDriver.selfie,
      safeBaseDriver.profileImage,
      safeBaseDriver.profile_image,
      safeBaseDriver.image,
      safeBaseDriver.avatar,
      safeBaseDriver.selfie,
    ),
    vehicleImage: pickPreferredValue(
      safeIncomingDriver.vehicleImage,
      safeIncomingDriver.vehicle_image,
      safeIncomingDriver.vehiclePhoto,
      safeIncomingDriver.vehicle_photo,
      incomingVehicle.vehicleImage,
      incomingVehicle.vehicle_image,
      incomingVehicle.image,
      incomingVehicle.photo,
      safeBaseDriver.vehicleImage,
      safeBaseDriver.vehicle_image,
      safeBaseDriver.vehiclePhoto,
      safeBaseDriver.vehicle_photo,
      baseVehicle.vehicleImage,
      baseVehicle.vehicle_image,
      baseVehicle.image,
      baseVehicle.photo,
    ),
    image: pickPreferredValue(safeIncomingDriver.image, safeIncomingDriver.profileImage, safeBaseDriver.image, safeBaseDriver.profileImage),
    avatar: pickPreferredValue(safeIncomingDriver.avatar, safeIncomingDriver.profileImage, safeBaseDriver.avatar, safeBaseDriver.profileImage),
    name: pickPreferredValue(safeIncomingDriver.name, safeBaseDriver.name),
    phone: pickPreferredValue(safeIncomingDriver.phone, safeIncomingDriver.mobile, safeIncomingDriver.phoneNumber, safeBaseDriver.phone, safeBaseDriver.mobile, safeBaseDriver.phoneNumber),
    vehicle: pickPreferredValue(
      typeof safeIncomingDriver.vehicle === 'string' ? safeIncomingDriver.vehicle : '',
      safeIncomingDriver.vehicleType,
      safeIncomingDriver.vehicle_type,
      incomingVehicle.name,
      incomingVehicle.vehicleType,
      incomingVehicle.vehicle_type,
      typeof safeBaseDriver.vehicle === 'string' ? safeBaseDriver.vehicle : '',
      safeBaseDriver.vehicleType,
      safeBaseDriver.vehicle_type,
      baseVehicle.name,
      baseVehicle.vehicleType,
      baseVehicle.vehicle_type,
    ),
    vehicleType: pickPreferredValue(
      safeIncomingDriver.vehicleType,
      safeIncomingDriver.vehicle_type,
      incomingVehicle.vehicleType,
      incomingVehicle.vehicle_type,
      safeBaseDriver.vehicleType,
      safeBaseDriver.vehicle_type,
      baseVehicle.vehicleType,
      baseVehicle.vehicle_type,
    ),
    vehicleNumber: pickPreferredValue(
      safeIncomingDriver.vehicleNumber,
      safeIncomingDriver.vehicle_number,
      safeIncomingDriver.plate,
      incomingVehicle.vehicleNumber,
      incomingVehicle.vehicle_number,
      incomingVehicle.plate,
      safeBaseDriver.vehicleNumber,
      safeBaseDriver.vehicle_number,
      safeBaseDriver.plate,
      baseVehicle.vehicleNumber,
      baseVehicle.vehicle_number,
      baseVehicle.plate,
    ),
    plate: pickPreferredValue(
      safeIncomingDriver.plate,
      safeIncomingDriver.vehicleNumber,
      safeIncomingDriver.vehicle_number,
      incomingVehicle.plate,
      incomingVehicle.vehicleNumber,
      incomingVehicle.vehicle_number,
      safeBaseDriver.plate,
      safeBaseDriver.vehicleNumber,
      safeBaseDriver.vehicle_number,
      baseVehicle.plate,
      baseVehicle.vehicleNumber,
      baseVehicle.vehicle_number,
    ),
    vehicleColor: pickPreferredValue(safeIncomingDriver.vehicleColor, safeIncomingDriver.vehicle_color, incomingVehicle.vehicleColor, incomingVehicle.vehicle_color, safeBaseDriver.vehicleColor, safeBaseDriver.vehicle_color, baseVehicle.vehicleColor, baseVehicle.vehicle_color),
    vehicleMake: pickPreferredValue(safeIncomingDriver.vehicleMake, safeIncomingDriver.vehicle_make, incomingVehicle.vehicleMake, incomingVehicle.vehicle_make, safeBaseDriver.vehicleMake, safeBaseDriver.vehicle_make, baseVehicle.vehicleMake, baseVehicle.vehicle_make),
    vehicleModel: pickPreferredValue(safeIncomingDriver.vehicleModel, safeIncomingDriver.vehicle_model, incomingVehicle.vehicleModel, incomingVehicle.vehicle_model, safeBaseDriver.vehicleModel, safeBaseDriver.vehicle_model, baseVehicle.vehicleModel, baseVehicle.vehicle_model),
    rating: pickPreferredValue(safeIncomingDriver.rating, safeBaseDriver.rating),
  };
};

const RideTracking = () => {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [rideRealtime, setRideRealtime] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [routeError, setRouteError] = useState('');
  const [map, setMap] = useState(null);
  const [driverImageFallback, setDriverImageFallback] = useState('');
  const [driverImageBroken, setDriverImageBroken] = useState(false);
  const [vehicleImageFallback, setVehicleImageFallback] = useState('');
  const [vehicleImageBroken, setVehicleImageBroken] = useState(false);
  const [arrivalClockFallbackAt, setArrivalClockFallbackAt] = useState('');
  const [waitingNow, setWaitingNow] = useState(Date.now());
  const { settings } = useSettings();
  const appName = settings.general?.app_name || 'App';
  const navigate = useNavigate();
  const location = useLocation();
  const storedRide = useMemo(() => getCurrentRide(), []);
  const state = useMemo(() => location.state || storedRide || {}, [location.state, storedRide]);
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const routeHome = useMemo(() => {
    if (location.pathname.startsWith('/taxi/user')) return '/taxi/user';
    if (location.pathname.startsWith('/app')) return '/app';
    return '/user';
  }, [location.pathname]);
  const routeComplete = location.pathname.startsWith('/taxi/user') ? '/taxi/user/ride/complete' : '/ride/complete';
  const routeChat = location.pathname.startsWith('/taxi/user') ? '/taxi/user/ride/chat' : '/ride/chat';
  const routeSupport = location.pathname.startsWith('/taxi/user') ? '/taxi/user/support' : '/ride/support';
  const routeSos = location.pathname.startsWith('/taxi/user') ? '/taxi/user/safety/sos' : '/safety/sos';

  const rideId = state.rideId || '';
  const scheduledAt = rideRealtime?.scheduledAt || state.scheduledAt || null;
  const scheduledTimestamp = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  const isScheduledRide = Number.isFinite(scheduledTimestamp);
  const isScheduledUpcoming = isScheduledRide && scheduledTimestamp > waitingNow;
  const scheduledCountdown = getScheduledCountdownLabel(scheduledAt, waitingNow);
  const scheduledDateLabel = formatScheduledDateTime(scheduledAt);
  const fare = rideRealtime?.fare || state.fare || 22;
  const paymentMethod = rideRealtime?.paymentMethod || state.paymentMethod || 'Cash';
  const fallbackDriver = useMemo(
    () => state.driver || { name: 'Captain', rating: '4.9', vehicle: 'Taxi', plate: 'Assigned', phone: '', profileImage: '', vehicleImage: '' },
    [state.driver],
  );
  const pickupLabel = rideRealtime?.pickup?.address || state.pickup || 'Pipaliyahana, Indore';
  const dropLabel = rideRealtime?.drop?.address || state.drop || 'Vijay Nagar, Indore';
  const pickupPosition = useMemo(
    () => toLatLng(rideRealtime?.pickup?.coordinates || state.pickupCoords || [75.9048, 22.7039]),
    [rideRealtime?.pickup?.coordinates, state.pickupCoords],
  );
  const dropPosition = useMemo(
    () => toLatLng(rideRealtime?.drop?.coordinates || state.dropCoords || [75.8937, 22.7533], pickupPosition),
    [pickupPosition, rideRealtime?.drop?.coordinates, state.dropCoords],
  );
  const tripStatus = String(rideRealtime?.status || state.liveStatus || state.status || 'accepted').toLowerCase();
  const otp = ['started', 'ongoing', 'arrived', 'completed'].includes(tripStatus)
    ? ''
    : String(rideRealtime?.otp || state.otp || state.ride_otp || '');
  const serviceType = String(state.serviceType || state.type || 'ride').toLowerCase();
  const activeDestination = useMemo(
    () => (['started', 'ongoing', 'arrived', 'completed'].includes(tripStatus) ? dropPosition : pickupPosition),
    [dropPosition, pickupPosition, tripStatus],
  );
  const driver = useMemo(
    () => mergeDriverSnapshot(fallbackDriver, rideRealtime?.driver || {}),
    [fallbackDriver, rideRealtime?.driver],
  );
  const resolvedDriverCoords = useMemo(
    () => readCoordinatePair(
      rideRealtime?.driverLocation?.coordinates,
      rideRealtime?.driver?.location,
      rideRealtime?.driver?.currentLocation,
      state.currentDriverCoords,
      state.driverLocation,
      state.driver?.location,
      state.driver?.currentLocation,
    ),
    [
      rideRealtime?.driver?.currentLocation,
      rideRealtime?.driver?.location,
      rideRealtime?.driverLocation?.coordinates,
      state.currentDriverCoords,
      state.driver,
      state.driverLocation,
    ],
  );
  const driverPosition = useMemo(
    () => toLatLng(resolvedDriverCoords, pickupPosition),
    [pickupPosition, resolvedDriverCoords],
  );
  const hasLiveDriverLocation = Boolean(resolvedDriverCoords?.length);
  const trackingSnapshot = useMemo(
    () => ({
      ...state,
      ...(rideRealtime || {}),
      fare,
      paymentMethod,
      serviceType,
      vehicleIconType: rideRealtime?.vehicleIconType || state.vehicleIconType || '',
      vehicleIconUrl: rideRealtime?.vehicleIconUrl || state.vehicleIconUrl || '',
      driver,
    }),
    [driver, fare, paymentMethod, rideRealtime, serviceType, state],
  );
  const waitingPricing = rideRealtime?.pricingSnapshot || state.pricingSnapshot || {};
  const waitingChargePerMinute = Math.max(0, Number(waitingPricing?.waiting_charge ?? 0));
  const freeWaitingBeforeMinutes = Math.max(0, Number(waitingPricing?.free_waiting_before ?? 0));
  const waitingStartedAt = rideRealtime?.arrivedAt || state.arrivedAt || arrivalClockFallbackAt || '';
  const waitingElapsedSeconds = waitingStartedAt
    ? Math.max(0, Math.floor((waitingNow - new Date(waitingStartedAt).getTime()) / 1000))
    : 0;
  const freeWaitingRemainingSeconds = Math.max(0, freeWaitingBeforeMinutes * 60 - waitingElapsedSeconds);
  const waitingChargeableMinutes = Math.max(0, Math.ceil(waitingElapsedSeconds / 60) - freeWaitingBeforeMinutes);
  const isWaitingForOtp = Boolean(waitingStartedAt) && !['started', 'ongoing', 'arrived', 'completed', 'cancelled', 'delivered'].includes(tripStatus);
  const vehicleIcon = getTrackingVehicleIcon(trackingSnapshot, driver);
  const displayDriverHeading = useMemo(() => {
    if (Number.isFinite(Number(rideRealtime?.driverLocation?.heading))) {
      return normalizeHeading(rideRealtime.driverLocation.heading);
    }

    return getRouteHeading(
      driverPosition,
      routePath,
      calculateBearing(driverPosition, activeDestination),
    );
  }, [activeDestination, driverPosition, rideRealtime?.driverLocation?.heading, routePath]);
  const vehicleLabel = driver.vehicle || driver.vehicleType || (serviceType === 'parcel' ? 'Parcel' : 'Taxi');
  const nextDriverImage = resolveAssetUrl(
    driver.profileImage || driver.profile_image || driver.image || driver.avatar || driver.selfie || '',
  );
  const nextVehicleImage = resolveAssetUrl(
    driver.vehicleImage || driver.vehicle_image || driver.vehiclePhoto || driver.vehicle_photo || '',
  );
  const driverImage = driverImageBroken ? '' : (nextDriverImage || driverImageFallback);
  const vehicleImage = vehicleImageBroken ? '' : (nextVehicleImage || vehicleImageFallback);
  const hasVehiclePhoto = isLikelyVehiclePhoto(vehicleImage) && !vehicleImageBroken;
  const arrivalDriverName = driver.name || (serviceType === 'parcel' ? 'Agent' : 'Driver');
  const driverSubtitle = isWaitingForOtp
    ? `${arrivalDriverName} has arrived`
    : isScheduledUpcoming && !hasLiveDriverLocation
    ? 'Driver assigned. Live tracking starts closer to pickup time'
    : tripStatus === 'arrived'
    ? (serviceType === 'parcel' ? 'Parcel reached destination' : 'Driver reached destination')
    : tripStatus === 'started' || tripStatus === 'ongoing'
    ? (serviceType === 'parcel' ? 'Parcel picked up' : 'Trip started')
    : serviceType === 'parcel'
      ? 'Delivery agent is on the way'
      : 'Captain is on the way';
  const vehicleDetails = [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ');
  const activeRideEndpoint = serviceType === 'parcel' ? '/deliveries/active/me' : '/rides/active/me';
  const latestStateRef = useRef(state);
  const latestFallbackDriverRef = useRef(fallbackDriver);
  const latestDriverRef = useRef(driver);
  const latestCompleteTrackingRef = useRef(() => {});
  const hasCompletedRedirectRef = useRef(false);
  const hasAutoFramedMapRef = useRef(false);
  const lastMapPanPositionRef = useRef(null);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    latestFallbackDriverRef.current = fallbackDriver;
  }, [fallbackDriver]);

  useEffect(() => {
    latestDriverRef.current = driver;
  }, [driver]);

  useEffect(() => {
    hasAutoFramedMapRef.current = false;
    lastMapPanPositionRef.current = null;
  }, [rideId, tripStatus, activeDestination.lat, activeDestination.lng]);

  const handleCancelRide = async () => {
    try {
      if (rideId) {
        await api.patch(`/rides/${rideId}/cancel`);
      }
    } catch (_error) {
      // If the ride has already advanced or ended, we still clear the local state below.
    } finally {
      clearCurrentRide();
      navigate('/taxi/user');
    }
  };

  useEffect(() => {
    if (nextDriverImage) {
      setDriverImageFallback(nextDriverImage);
      setDriverImageBroken(false);
    }
  }, [nextDriverImage]);

  useEffect(() => {
    if (nextVehicleImage) {
      setVehicleImageFallback(nextVehicleImage);
      setVehicleImageBroken(false);
    }
  }, [nextVehicleImage]);

  useEffect(() => {
    if (rideRealtime?.arrivedAt || state.arrivedAt) {
      setArrivalClockFallbackAt('');
      return;
    }

    if (tripStatus === 'arriving') {
      setArrivalClockFallbackAt((current) => current || new Date().toISOString());
      return;
    }

    if (['started', 'ongoing', 'arrived', 'completed', 'cancelled', 'delivered'].includes(tripStatus)) {
      setArrivalClockFallbackAt('');
    }
  }, [rideRealtime?.arrivedAt, state.arrivedAt, tripStatus]);

  useEffect(() => {
    if (!isWaitingForOtp) {
      return undefined;
    }

    setWaitingNow(Date.now());
    const intervalId = window.setInterval(() => {
      setWaitingNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isWaitingForOtp]);

  const exitTracking = useMemo(
    () => () => {
      // We don't clear the ride on mount anymore to allow refreshes on the rating page.
      // clearCurrentRide() is now called after submission or when skipping.
      navigate(routeHome, { replace: true });
    },
    [navigate, routeHome],
  );

  const completeTracking = useMemo(
    () => (statusValue = 'completed') => {
      const completedRideSnapshot = {
        ...state,
        rideId,
        fare,
        paymentMethod,
        driverPaymentCollection: rideRealtime?.driverPaymentCollection || state.driverPaymentCollection || null,
        pickup: pickupLabel,
        drop: dropLabel,
        driver,
        status: statusValue,
        liveStatus: statusValue,
        feedback: rideRealtime?.feedback || state.feedback || null,
        arrivedAt: rideRealtime?.arrivedAt || state.arrivedAt || '',
        completedAt: rideRealtime?.completedAt || rideRealtime?.arrivedAt || state.arrivedAt || Date.now(),
      };

      saveCurrentRide(completedRideSnapshot);
      navigate(routeComplete, {
        replace: true,
        state: completedRideSnapshot,
      });
    },
    [driver, dropLabel, fare, navigate, paymentMethod, pickupLabel, rideId, rideRealtime?.completedAt, rideRealtime?.feedback, routeComplete, state],
  );

  useEffect(() => {
    latestCompleteTrackingRef.current = completeTracking;
  }, [completeTracking]);

  useEffect(() => {
    hasCompletedRedirectRef.current = false;
  }, [rideId]);

  useEffect(() => {
    let active = true;

    if (!rideId) {
      exitTracking();
      return () => {
        active = false;
      };
    }

    const hydrateRideState = async () => {
      try {
        const response = await api.get(`/rides/${rideId}`);
        const payload = unwrapApiPayload(response);
        const nextStatus = String(payload?.liveStatus || payload?.status || '').toLowerCase();

        if (!active) {
          return;
        }

        if (POST_RIDE_REDIRECT_STATUSES.has(nextStatus)) {
          const mergedDriver = mergeDriverSnapshot(fallbackDriver, payload?.driver || {});
          setRideRealtime({
            pickup: {
              coordinates: payload?.pickupLocation?.coordinates,
              address: payload?.pickupAddress || latestStateRef.current.pickup || 'Pickup',
            },
            drop: {
              coordinates: payload?.dropLocation?.coordinates,
              address: payload?.dropAddress || latestStateRef.current.drop || 'Drop',
            },
            driverLocation: payload?.lastDriverLocation
              ? { coordinates: payload.lastDriverLocation.coordinates }
              : null,
            status: nextStatus,
            fare: payload?.fare || latestStateRef.current.fare || 0,
            paymentMethod: payload?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
            vehicleIconType: payload?.vehicleIconType || latestStateRef.current.vehicleIconType || '',
            vehicleIconUrl: payload?.vehicleIconUrl || latestStateRef.current.vehicleIconUrl || '',
            scheduledAt: payload?.scheduledAt || latestStateRef.current.scheduledAt || null,
            otp: payload?.otp || latestStateRef.current.otp || latestStateRef.current.ride_otp || '',
            arrivedAt: payload?.arrivedAt || latestStateRef.current.arrivedAt || '',
            pricingSnapshot: payload?.pricingSnapshot || latestStateRef.current.pricingSnapshot || null,
            driverPaymentCollection: payload?.driverPaymentCollection || latestStateRef.current.driverPaymentCollection || null,
            completedAt: payload?.completedAt || null,
            feedback: payload?.feedback || null,
            driver: mergedDriver,
          });
          completeTracking(nextStatus);
          return;
        }

        if (TERMINAL_STATUSES.has(nextStatus)) {
          if (COMPLETED_TRACKING_STATUSES.has(nextStatus)) {
            const mergedDriver = mergeDriverSnapshot(fallbackDriver, payload?.driver || {});
            setRideRealtime({
              pickup: {
                coordinates: payload?.pickupLocation?.coordinates,
                address: payload?.pickupAddress || latestStateRef.current.pickup || 'Pickup',
              },
              drop: {
                coordinates: payload?.dropLocation?.coordinates,
                address: payload?.dropAddress || latestStateRef.current.drop || 'Drop',
              },
              driverLocation: payload?.lastDriverLocation
                ? { coordinates: payload.lastDriverLocation.coordinates }
                : null,
              status: nextStatus,
              fare: payload?.fare || latestStateRef.current.fare || 0,
              paymentMethod: payload?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
              vehicleIconType: payload?.vehicleIconType || latestStateRef.current.vehicleIconType || '',
              vehicleIconUrl: payload?.vehicleIconUrl || latestStateRef.current.vehicleIconUrl || '',
              scheduledAt: payload?.scheduledAt || latestStateRef.current.scheduledAt || null,
              otp: payload?.otp || latestStateRef.current.otp || latestStateRef.current.ride_otp || '',
              arrivedAt: payload?.arrivedAt || latestStateRef.current.arrivedAt || '',
              pricingSnapshot: payload?.pricingSnapshot || latestStateRef.current.pricingSnapshot || null,
              driverPaymentCollection: payload?.driverPaymentCollection || latestStateRef.current.driverPaymentCollection || null,
              completedAt: payload?.completedAt || null,
              feedback: payload?.feedback || null,
              driver: mergedDriver,
            });
            completeTracking(nextStatus);
            return;
          }
          exitTracking();
          return;
        }

        const mergedDriver = mergeDriverSnapshot(fallbackDriver, payload?.driver || {});

        setRideRealtime({
          pickup: {
            coordinates: payload?.pickupLocation?.coordinates,
            address: payload?.pickupAddress || latestStateRef.current.pickup || 'Pickup',
          },
          drop: {
            coordinates: payload?.dropLocation?.coordinates,
            address: payload?.dropAddress || latestStateRef.current.drop || 'Drop',
          },
          driverLocation: payload?.lastDriverLocation
            ? {
                coordinates: payload.lastDriverLocation.coordinates,
                heading: payload.lastDriverLocation.heading,
              }
            : null,
          status: payload?.liveStatus || payload?.status || 'accepted',
          fare: payload?.fare || latestStateRef.current.fare || 0,
          paymentMethod: payload?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
          vehicleIconType: payload?.vehicleIconType || latestStateRef.current.vehicleIconType || '',
          vehicleIconUrl: payload?.vehicleIconUrl || latestStateRef.current.vehicleIconUrl || '',
          scheduledAt: payload?.scheduledAt || latestStateRef.current.scheduledAt || null,
          otp: payload?.otp || latestStateRef.current.otp || latestStateRef.current.ride_otp || '',
          arrivedAt: payload?.arrivedAt || latestStateRef.current.arrivedAt || '',
          pricingSnapshot: payload?.pricingSnapshot || latestStateRef.current.pricingSnapshot || null,
          driverPaymentCollection: payload?.driverPaymentCollection || latestStateRef.current.driverPaymentCollection || null,
          completedAt: payload?.completedAt || null,
          feedback: payload?.feedback || null,
          driver: mergedDriver,
        });

        saveCurrentRide({
          ...latestStateRef.current,
          rideId,
          driver: mergedDriver,
          status: payload?.status || latestStateRef.current.status || 'accepted',
          liveStatus: payload?.liveStatus || payload?.status || latestStateRef.current.liveStatus || latestStateRef.current.status || 'accepted',
          scheduledAt: payload?.scheduledAt || latestStateRef.current.scheduledAt || null,
          arrivedAt: payload?.arrivedAt || latestStateRef.current.arrivedAt || '',
          pricingSnapshot: payload?.pricingSnapshot || latestStateRef.current.pricingSnapshot || null,
          driverPaymentCollection: payload?.driverPaymentCollection || latestStateRef.current.driverPaymentCollection || null,
        });
      } catch {
        // Let the active-ride validator decide whether the ride ended or the fetch was transient.
      }
    };

    const validateActiveRide = async () => {
      try {
        const activePayload = unwrapApiPayload(await api.get(activeRideEndpoint));
        const activeRideId = String(activePayload?.rideId || '');
        const activeStatus = String(activePayload?.liveStatus || activePayload?.status || '').toLowerCase();

        if (TERMINAL_STATUSES.has(activeStatus)) {
          if (active) {
            if (COMPLETED_TRACKING_STATUSES.has(activeStatus)) {
              completeTracking(activeStatus);
            } else {
              exitTracking();
            }
          }
          return false;
        }

        if (!activeRideId || activeRideId !== String(rideId)) {
          await hydrateRideState().catch(() => {});
          return false;
        }

        return true;
      } catch (err) {
        console.error('Active ride validation failed:', err);
        await hydrateRideState().catch(() => {});
        return false;
      }
    };

    hydrateRideState();
    const validationInterval = window.setInterval(() => {
      validateActiveRide().catch(() => {});
    }, ACTIVE_RIDE_VALIDATE_MS);

    return () => {
      active = false;
      window.clearInterval(validationInterval);
    };
  }, [activeRideEndpoint, rideId]); // Removed unstable dependencies (completeTracking, exitTracking, etc.) to stop infinite loop

  useEffect(() => {
    if (!TERMINAL_STATUSES.has(tripStatus)) {
      return;
    }

    if (COMPLETED_TRACKING_STATUSES.has(tripStatus)) {
      if (!hasCompletedRedirectRef.current) {
        hasCompletedRedirectRef.current = true;
        completeTracking(tripStatus);
      }
      return;
    }

    clearCurrentRide();
    const timeoutId = window.setTimeout(() => {
      navigate(routeHome, { replace: true });
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [navigate, routeHome, tripStatus]);

  useEffect(() => {
    if (!rideId) {
      return () => {};
    }

    const socket = socketService.connect({ role: 'user' });

    if (!socket) {
      return () => {};
    }

    const onRideState = (payload) => {
      if (!payload || String(payload.rideId || '') !== String(rideId)) {
        return;
      }

      const nextStatus = String(payload.liveStatus || payload.status || 'accepted').toLowerCase();

      const latestState = latestStateRef.current;
      const latestFallbackDriver = latestFallbackDriverRef.current;

      setRideRealtime((prev) => ({
        pickup: {
          coordinates: payload.pickupLocation?.coordinates,
          address: payload.pickupAddress || latestState.pickup || 'Pickup',
        },
        drop: {
          coordinates: payload.dropLocation?.coordinates,
          address: payload.dropAddress || latestState.drop || 'Drop',
        },
        driverLocation: payload.lastDriverLocation
          ? {
              coordinates: payload.lastDriverLocation.coordinates,
              heading: payload.lastDriverLocation.heading,
            }
          : null,
        status: payload.liveStatus || payload.status || 'accepted',
        fare: payload.fare || prev?.fare || latestState.fare || 0,
        paymentMethod: payload.paymentMethod || prev?.paymentMethod || latestState.paymentMethod || 'Cash',
        vehicleIconType: payload.vehicleIconType || prev?.vehicleIconType || latestState.vehicleIconType || '',
        vehicleIconUrl: payload.vehicleIconUrl || prev?.vehicleIconUrl || latestState.vehicleIconUrl || '',
        scheduledAt: payload.scheduledAt || prev?.scheduledAt || latestState.scheduledAt || null,
        otp: payload.otp || prev?.otp || latestState.otp || latestState.ride_otp || '',
        arrivedAt: payload.arrivedAt || prev?.arrivedAt || latestState.arrivedAt || '',
        pricingSnapshot: payload.pricingSnapshot || prev?.pricingSnapshot || latestState.pricingSnapshot || null,
        driverPaymentCollection: payload.driverPaymentCollection || prev?.driverPaymentCollection || latestState.driverPaymentCollection || null,
        completedAt: payload.completedAt || null,
        feedback: payload.feedback || null,
        driver: mergeDriverSnapshot(prev?.driver || latestFallbackDriver, payload.driver || {}),
      }));

      if (POST_RIDE_REDIRECT_STATUSES.has(nextStatus)) {
        latestCompleteTrackingRef.current(nextStatus);
        return;
      }

      if (nextStatus === 'cancelled') {
        clearCurrentRide();
      }
    };

    const onLocationUpdated = (payload) => {
      if (!payload || String(payload.rideId || '') !== String(rideId)) {
        return;
      }

      setRideRealtime((prev) => ({
        ...(prev || {}),
        driverLocation: {
          coordinates: payload.coordinates,
          heading: payload.heading ?? prev?.driverLocation?.heading ?? null,
        },
      }));
    };

    const onStatusUpdated = (payload) => {
      if (!payload || String(payload.rideId || '') !== String(rideId)) {
        return;
      }

      const nextStatus = payload.liveStatus || payload.status || 'accepted';
      const normalizedStatus = String(nextStatus).toLowerCase();

      if (POST_RIDE_REDIRECT_STATUSES.has(normalizedStatus)) {
        setRideRealtime((prev) => ({
          ...(prev || {}),
          status: normalizedStatus,
          arrivedAt: payload.arrivedAt || prev?.arrivedAt || null,
          driverPaymentCollection: payload.driverPaymentCollection || prev?.driverPaymentCollection || null,
          completedAt: payload.completedAt || prev?.completedAt || null,
        }));
        latestCompleteTrackingRef.current(normalizedStatus);
        return;
      }

      if (normalizedStatus === 'cancelled') {
        clearCurrentRide();
      } else {
        const latestState = latestStateRef.current;
        saveCurrentRide({
          ...latestState,
          rideId,
          driver: latestDriverRef.current,
          status: nextStatus,
          scheduledAt: payload.scheduledAt || latestState.scheduledAt || null,
          arrivedAt: payload.arrivedAt || latestState.arrivedAt || '',
          pricingSnapshot: payload.pricingSnapshot || latestState.pricingSnapshot || null,
          driverPaymentCollection: payload.driverPaymentCollection || latestState.driverPaymentCollection || null,
        });
      }

      setRideRealtime((prev) => ({
        ...(prev || {}),
        status: nextStatus,
        scheduledAt: payload.scheduledAt || prev?.scheduledAt || latestStateRef.current.scheduledAt || null,
        arrivedAt: payload.arrivedAt || prev?.arrivedAt || '',
        pricingSnapshot: payload.pricingSnapshot || prev?.pricingSnapshot || null,
        driverPaymentCollection: payload.driverPaymentCollection || prev?.driverPaymentCollection || null,
        completedAt: payload.completedAt || prev?.completedAt || null,
      }));
    };

    socketService.on('ride:state', onRideState);
    socketService.on('ride:driver-location:updated', onLocationUpdated);
    socketService.on('ride:status:updated', onStatusUpdated);
    socketService.emit('ride:join', { rideId });

    return () => {
      socketService.off('ride:state', onRideState);
      socketService.off('ride:driver-location:updated', onLocationUpdated);
      socketService.off('ride:status:updated', onStatusUpdated);
    };
  }, [rideId]);

  useEffect(() => {
    if (isScheduledUpcoming && !hasLiveDriverLocation) {
      setRoutePath([]);
      setRouteError('');
      return;
    }

    if (!isLoaded || !window.google?.maps?.DirectionsService) {
      setRoutePath([driverPosition, activeDestination]);
      setRouteError('');
      return;
    }

    if (arePositionsNearlyEqual(driverPosition, activeDestination)) {
      setRoutePath([driverPosition]);
      setRouteError('');
      return;
    }

    let active = true;
    const directionsService = new window.google.maps.DirectionsService();

    directionsService.route(
      {
        origin: driverPosition,
        destination: activeDestination,
        travelMode: window.google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: false,
      },
      (result, status) => {
        if (!active) {
          return;
        }

        if (status === 'OK' && result?.routes?.[0]?.overview_path?.length) {
          setRoutePath(
            result.routes[0].overview_path.map((point) => ({
              lat: point.lat(),
              lng: point.lng(),
            })),
          );
          setRouteError('');
          return;
        }

        setRoutePath([driverPosition, activeDestination]);
        setRouteError(status || 'Directions unavailable');
      },
    );

    return () => {
      active = false;
    };
  }, [activeDestination, driverPosition, hasLiveDriverLocation, isLoaded, isScheduledUpcoming]);

  useEffect(() => {
    if (!map || !window.google?.maps) {
      return;
    }

    if (routePath.length > 1) {
      if (!hasAutoFramedMapRef.current) {
        const bounds = new window.google.maps.LatLngBounds();
        routePath.forEach((point) => bounds.extend(point));
        bounds.extend(driverPosition);
        bounds.extend(activeDestination);
        map.fitBounds(bounds, { top: 120, right: 48, bottom: 300, left: 48 });
        hasAutoFramedMapRef.current = true;
        lastMapPanPositionRef.current = driverPosition;
        return;
      }

      lastMapPanPositionRef.current = driverPosition;
      return;
    }

    if (!hasAutoFramedMapRef.current) {
      map.panTo(driverPosition);
      map.setZoom(15);
      hasAutoFramedMapRef.current = true;
      lastMapPanPositionRef.current = driverPosition;
      return;
    }

    lastMapPanPositionRef.current = driverPosition;
  }, [activeDestination, driverPosition, map, routePath, tripStatus]);

  const handleShare = async () => {
    const text = buildRideShareText({
      appName,
      driverName: driver.name,
      vehicleNumber: driver.plate || driver.vehicleNumber,
      pickupLabel,
      dropLabel,
    });

    if (navigator.share) {
      try {
        await navigator.share({ title: `Track My Ride - ${appName}`, text });
        setShareSheetOpen(false);
        return;
      } catch (_error) {
        // Fall through to the explicit share options below.
      }
    }

    setShareSheetOpen(true);
  };

  const handleCopyShareText = () => {
    const text = buildRideShareText({
      appName,
      driverName: driver.name,
      vehicleNumber: driver.plate || driver.vehicleNumber,
      pickupLabel,
      dropLabel,
    });

    navigator.clipboard?.writeText(text).then(() => {
      setShareToast(true);
      setShareSheetOpen(false);
      setTimeout(() => setShareToast(false), 2500);
    });
  };

  const handleCallDriver = () => {
    const phone = String(driver.phone || driver.mobile || driver.phoneNumber || '').replace(/[^\d+]/g, '');

    if (!phone) {
      window.alert('Driver phone number is not available yet.');
      return;
    }

    window.open(`tel:${phone}`, '_self');
  };

  const openRideChat = () => {
    navigate(routeChat, {
      state: {
        rideId,
        peer: {
          name: driver.name || 'Driver',
          phone: driver.phone || driver.mobile || driver.phoneNumber || '',
          subtitle: 'Driver - Active now',
          role: 'Driver',
        },
      },
    });
  };

  const ActionBtn = ({ icon: Icon, label, onClick, colorClass }) => (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-[14px] border border-slate-100 bg-slate-50/80 transition-all ${colorClass || ''}`}
    >
      <Icon size={17} className="text-slate-700" strokeWidth={2} />
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
    </motion.button>
  );

  return (
    <div className="min-h-screen bg-gray-100 max-w-lg mx-auto relative font-sans overflow-hidden">
      <AnimatePresence>
        {shareToast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-slate-900 text-white px-5 py-3 rounded-[14px] text-[12px] font-black shadow-xl whitespace-nowrap"
          >
            Ride details copied!
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shareSheetOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[210] flex items-end justify-center bg-slate-950/45 px-4 pb-5 pt-12"
            onClick={() => setShareSheetOpen(false)}
          >
            <motion.div
              initial={{ y: 48, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 48, opacity: 0 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl"
            >
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Share Ride</p>
              <h3 className="mt-2 text-[20px] font-black tracking-tight text-slate-900">Send trip details</h3>
              <p className="mt-1 text-[12px] font-bold text-slate-500">Choose how you want to share this ongoing ride.</p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                {navigator.share ? (
                  <button
                    type="button"
                    onClick={handleShare}
                    className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-left"
                  >
                    <p className="text-[13px] font-black text-slate-900">System share</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-500">Open phone share apps</p>
                  </button>
                ) : null}
                <a
                  href={buildShareLinks(buildRideShareText({
                    appName,
                    driverName: driver.name,
                    vehicleNumber: driver.plate || driver.vehicleNumber,
                    pickupLabel,
                    dropLabel,
                  })).whatsapp}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-left"
                >
                  <p className="text-[13px] font-black text-slate-900">WhatsApp</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">Share in chat</p>
                </a>
                <a
                  href={buildShareLinks(buildRideShareText({
                    appName,
                    driverName: driver.name,
                    vehicleNumber: driver.plate || driver.vehicleNumber,
                    pickupLabel,
                    dropLabel,
                  })).sms}
                  className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-left"
                >
                  <p className="text-[13px] font-black text-slate-900">SMS</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">Open messages</p>
                </a>
                <button
                  type="button"
                  onClick={handleCopyShareText}
                  className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-left"
                >
                  <p className="text-[13px] font-black text-slate-900">Copy details</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">Copy to clipboard</p>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShareSheetOpen(false)}
                className="mt-4 h-12 w-full rounded-[18px] bg-slate-900 text-[12px] font-black uppercase tracking-[0.16em] text-white"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-0 z-0 bg-slate-200">
        {!HAS_VALID_GOOGLE_MAPS_KEY ? (
          <div className="flex h-full w-full items-center justify-center bg-slate-200 px-6 text-center">
            <div className="rounded-[18px] bg-white/90 px-4 py-4 shadow-sm">
              <p className="text-[12px] font-bold text-slate-900">Google Maps key missing</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">Set `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env`.</p>
            </div>
          </div>
        ) : loadError ? (
          <div className="flex h-full w-full items-center justify-center bg-slate-200 px-6 text-center">
            <div className="rounded-[18px] bg-white/90 px-4 py-4 shadow-sm">
              <p className="text-[12px] font-bold text-slate-900">Google Maps failed to load</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">Check the browser key restrictions and reload.</p>
            </div>
          </div>
        ) : isLoaded ? (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER_STYLE}
            center={driverPosition}
            zoom={14}
            onLoad={setMap}
            onUnmount={() => setMap(null)}
            options={{
              disableDefaultUI: true,
              zoomControl: true,
              clickableIcons: false,
              streetViewControl: false,
              fullscreenControl: false,
              mapTypeControl: false,
              gestureHandling: 'greedy',
            }}
          >
            {routePath.length > 1 && hasLiveDriverLocation && (
              <PolylineF
                path={routePath}
                options={{
                  strokeColor: '#111827',
                  strokeOpacity: 0.9,
                  strokeWeight: 5,
                }}
              />
            )}
            {hasLiveDriverLocation ? (
              <RotatingVehicleMarker
                position={driverPosition}
                title="Driver"
                iconUrl={vehicleIcon}
                heading={displayDriverHeading}
              />
            ) : null}
            <MarkerF
              position={activeDestination}
              title={['started', 'ongoing', 'arrived', 'completed'].includes(tripStatus) ? 'Drop' : 'Pickup'}
              icon={{
                path: window.google.maps.SymbolPath.CIRCLE,
                fillColor: ['started', 'ongoing', 'arrived', 'completed'].includes(tripStatus) ? '#ef4444' : '#10b981',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
                scale: 7,
              }}
            />
          </GoogleMap>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-200">
            <div className="rounded-[16px] bg-white/90 px-4 py-3 shadow-sm text-[12px] font-bold text-slate-700">
              Loading map
            </div>
          </div>
        )}
      </div>

      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => navigate(routeHome)}
        className="absolute top-8 left-4 z-10 w-10 h-10 bg-white/90 backdrop-blur-md rounded-[12px] shadow-[0_4px_14px_rgba(15,23,42,0.10)] border border-white/80 flex items-center justify-center"
      >
        <ChevronLeft size={18} className="text-slate-900" strokeWidth={2.5} />
      </motion.button>

      <div className="absolute top-8 left-16 right-4 z-10 bg-white/90 backdrop-blur-md rounded-[14px] px-3.5 py-2.5 shadow-[0_4px_14px_rgba(15,23,42,0.08)] border border-white/80">
        <p className="text-[11px] font-black text-slate-500 truncate">{pickupLabel} → {dropLabel}</p>
      </div>

      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => navigate(routeSos)}
        className="absolute top-24 right-4 z-10 bg-white/90 backdrop-blur-md px-3.5 py-2 rounded-full border border-white/80 shadow-[0_4px_14px_rgba(15,23,42,0.08)] flex items-center gap-1.5"
      >
        <Shield size={13} className="text-blue-500" strokeWidth={2.5} />
        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Safety</span>
      </motion.button>

      {routeError && (
        <div className="absolute top-24 left-4 z-10 rounded-[12px] border border-amber-100 bg-white/90 px-3 py-2 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Route</p>
          <p className="text-[11px] font-bold text-slate-700">Using fallback path while directions load.</p>
        </div>
      )}

      {isScheduledUpcoming ? (
        <div className="absolute top-[132px] left-4 right-4 z-10 rounded-[18px] border border-emerald-100 bg-white/92 px-4 py-3 shadow-[0_10px_28px_rgba(16,185,129,0.12)] backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Scheduled ride</p>
              <p className="mt-1 text-[15px] font-black tracking-tight text-slate-950">{scheduledDateLabel}</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">
                {hasLiveDriverLocation
                  ? 'Your driver has started sharing location for this pickup.'
                  : 'Driver assigned. We will light up live movement here as pickup time gets closer.'}
              </p>
            </div>
            <div className="rounded-[16px] bg-emerald-50 px-3 py-2 text-right">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-700">Countdown</p>
              <p className="mt-1 text-[13px] font-black text-slate-950">{scheduledCountdown || 'Ready'}</p>
            </div>
          </div>
        </div>
      ) : null}

      <motion.div
        animate={{ y: drawerOpen ? 0 : 420 }}
        className="absolute bottom-0 left-0 right-0 bg-white shadow-[0_-12px_44px_rgba(15,23,42,0.12)] z-20 rounded-t-[28px] border-t border-slate-100/50"
      >
        <div className="w-12 h-1.5 bg-slate-200/60 rounded-full mx-auto mt-2.5 mb-3.5 cursor-pointer hover:bg-slate-300 transition-colors" onClick={() => setDrawerOpen(!drawerOpen)} />

        <div className="px-4 pb-6 space-y-3.5">
          {/* Header Section: Driver & OTP */}
          <div className="flex items-start justify-between">
            <div className="flex gap-3 min-w-0">
              <div className="relative shrink-0">
                <div className="w-[62px] h-[62px] rounded-[20px] bg-[#1d2333] overflow-hidden shadow-[0_8px_20px_rgba(15,23,42,0.15)]">
                  {driverImage ? (
                    <img
                      src={driverImage}
                      className="w-full h-full object-cover opacity-90"
                      alt={driver.name || 'Driver'}
                      onError={() => setDriverImageBroken(true)}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[21px] font-black text-white/90">
                      {getInitials(driver.name)}
                    </div>
                  )}
                </div>
                {/* Car Badge */}
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-lg bg-[#111827] border-2 border-white flex items-center justify-center shadow-md">
                   <img src={vehicleIcon} alt="Vehicle icon" className="h-3.5 w-3.5 object-contain brightness-0 invert" draggable={false} />
                </div>
                {/* Rating Badge */}
                <div className="absolute -bottom-1 -right-1 bg-yellow-400 px-1.5 py-0.5 rounded-full border-2 border-white flex items-center gap-0.5 shadow-md">
                  <Star size={9} className="text-slate-900 fill-slate-900" />
                  <span className="text-[9px] font-black text-slate-900">{driver.rating || '4.9'}</span>
                </div>
              </div>

              <div className="min-w-0 pt-0.5">
                <h3 className="truncate text-[17px] font-black text-slate-900 leading-tight tracking-tight">
                  {driver.name || 'James Bond'}
                </h3>
                <p className="text-[13px] font-black text-[#f97316] mt-1 tracking-tight">
                  {tripStatus === 'arrived' ? 'Reached destination' : tripStatus === 'started' || tripStatus === 'ongoing' ? 'Trip started' : driverSubtitle}
                </p>
                <p className="truncate text-[11px] font-bold text-slate-400 mt-0.5 uppercase tracking-[0.14em]">
                  {driver.plate || 'MH12AB1234'} &middot; {vehicleLabel}
                </p>
              </div>
            </div>

            {/* OTP CARD - High Fidelity */}
            {otp && (
              <div className="bg-[#fff9ef] border border-[#fef3c7] rounded-[20px] px-3 py-3 flex flex-col items-center justify-center min-w-[80px] shadow-sm">
                <span className="text-[9px] font-black text-orange-500 uppercase tracking-[0.18em] mb-1 leading-none">OTP</span>
                <span className="text-[18px] font-black text-slate-900 tracking-tighter leading-none">{otp}</span>
              </div>
            )}
          </div>

          {isScheduledRide ? (
            <div className="rounded-[22px] border border-emerald-100 bg-emerald-50/70 px-4 py-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-700">Trip plan</p>
                  <p className="mt-1 text-[15px] font-black text-slate-950">{scheduledDateLabel}</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">
                    {isScheduledUpcoming
                      ? 'We will switch from booking mode to live pickup tracking automatically as your slot approaches.'
                      : 'Your scheduled ride is now in its live service window.'}
                  </p>
                </div>
                <div className="rounded-[16px] bg-white px-3 py-2 text-right shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Status</p>
                  <p className="mt-1 text-[13px] font-black text-slate-950">{isScheduledUpcoming ? scheduledCountdown || 'Ready' : 'Live now'}</p>
                </div>
              </div>
            </div>
          ) : null}

          {isWaitingForOtp && (
            <div className="rounded-[24px] border border-amber-100 bg-amber-50/70 px-4 py-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-amber-500 shadow-sm">
                    <Clock3 size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-amber-600">Waiting Clock</p>
                    <p className="mt-1 text-[22px] font-black tracking-tight text-slate-900">{formatTimerClock(waitingElapsedSeconds)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Free Left</p>
                  <p className="mt-1 text-[13px] font-black text-slate-900">{formatTimerClock(freeWaitingRemainingSeconds)}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white px-3 py-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Free Before Ride</p>
                  <p className="mt-1 text-[13px] font-black text-slate-900">{formatWholeMinutes(freeWaitingBeforeMinutes)}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Waiting Charge</p>
                  <p className="mt-1 text-[13px] font-black text-slate-900">
                    Rs {waitingChargePerMinute}/min
                    {waitingChargeableMinutes > 0 ? ` • ${waitingChargeableMinutes} billable` : ''}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Detailed Vehicle Status Card - High Fidelity */}
          <div className="flex items-center gap-3 rounded-[22px] bg-slate-50/40 border border-slate-50/80 px-3 py-3 shadow-[0_2px_12px_rgba(15,23,42,0.02)]">
            <div className="w-12 h-12 shrink-0 flex items-center justify-center rounded-[16px] bg-white shadow-sm border border-slate-100/50 overflow-hidden p-2">
               {hasVehiclePhoto ? (
                  <img
                    src={vehicleImage}
                    alt={vehicleLabel}
                    className="w-full h-full object-contain"
                    onError={() => setVehicleImageBroken(true)}
                  />
                ) : (
                  <img src={vehicleIcon} alt={vehicleLabel} className="h-6 w-6 object-contain opacity-60" />
                )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-0.5">Vehicle</p>
              <p className="text-[15px] font-black text-slate-900 leading-tight truncate">{vehicleLabel}</p>
              <p className="text-[12px] font-bold text-slate-500 mt-0.5 truncate">{vehicleDetails || 'Blue'}</p>
            </div>
          </div>

          {/* High-Fidelity Action Grid */}
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { id: 'call', icon: Phone, label: 'CALL', action: handleCallDriver },
              { id: 'chat', icon: MessageCircle, label: 'CHAT', action: openRideChat },
              { id: 'share', icon: Share2, label: 'SHARE', action: handleShare },
              { id: 'help', icon: AlertTriangle, label: 'HELP', action: () => navigate(routeSupport) }
            ].map((btn) => (
              <motion.button
                key={btn.id}
                whileTap={{ scale: 0.94 }}
                onClick={btn.action}
                className="flex flex-col items-center gap-1.5 py-3 rounded-[18px] bg-white border border-slate-100/60 shadow-[0_2px_8px_rgba(15,23,42,0.03)] hover:bg-slate-50 transition-all duration-200"
              >
                <div className="p-0.5">
                  <btn.icon size={18} className="text-slate-800" strokeWidth={2} />
                </div>
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.1em] leading-none">{btn.label}</span>
              </motion.button>
            ))}
          </div>

          {/* Footer: Fare & Cancellation Section */}
          <div className="flex items-end justify-between pt-2 border-t border-slate-50">
            <div className="space-y-0.5">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.18em] leading-none mb-1">Total Fare</p>
              <div className="flex items-center gap-2">
                <span className="text-[19px] font-black text-slate-950 tracking-tight leading-none">Rs {fare}.00</span>
                <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg uppercase tracking-wider border border-slate-200/50 shadow-sm">{paymentMethod}</span>
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => setShowCancelConfirm(true)}
              className="bg-white border-2 border-slate-50 text-red-500 font-black text-[11px] uppercase tracking-[0.16em] px-5 py-3 rounded-[18px] shadow-[0_8px_20px_rgba(239,68,68,0.08)] active:shadow-none hover:bg-red-50/10 transition-all"
            >
              Cancel
            </motion.button>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showCancelConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCancelConfirm(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] max-w-lg mx-auto"
            />
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 40 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[82%] max-w-sm bg-white rounded-[28px] p-7 z-[101] shadow-2xl text-center"
            >
              <div className="w-14 h-14 bg-red-50 rounded-[18px] flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={26} className="text-red-400" strokeWidth={2} />
              </div>
              <h3 className="text-[18px] font-bold text-slate-900 mb-1.5">Cancel your ride?</h3>
              <p className="text-[13px] font-bold text-slate-400 mb-6 leading-relaxed">Your captain is already on the way.</p>
              <div className="space-y-2.5">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleCancelRide}
                  className="w-full bg-slate-900 text-white py-3.5 rounded-[16px] text-[13px] font-bold uppercase tracking-widest"
                >
                  Yes, Cancel
                </motion.button>
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="w-full py-3.5 text-[13px] font-bold text-slate-400 uppercase tracking-widest"
                >
                  No, Go Back
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default RideTracking;
