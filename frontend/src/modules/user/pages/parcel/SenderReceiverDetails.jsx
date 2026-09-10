import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Contact,
  LocateFixed,
  MapPin,
  Mic,
  Navigation,
  PackageCheck,
  Phone,
  Plus,
  User,
  X,
} from 'lucide-react';
import { GoogleMap, OverlayView } from '@react-google-maps/api';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../../admin/utils/googleMaps';
import { userAuthService } from '../../services/authService';
import api from '../../../../shared/api/axiosInstance';
import BikeIcon from '../../../../assets/icons/bike.png';
import AutoIcon from '../../../../assets/icons/auto.png';
import CarIcon from '../../../../assets/icons/car.png';
import PremiumIcon from '../../../../assets/icons/Premium.png';
import LuxuryIcon from '../../../../assets/icons/Luxury.png';
import SuvIcon from '../../../../assets/icons/SUV.png';
import TruckIcon from '../../../../assets/icons/truck.png';
import LcvIcon from '../../../../assets/icons/LCV.png';
import McvIcon from '../../../../assets/icons/mcv.png';
import HcvIcon from '../../../../assets/icons/hcv.png';
import EhcvIcon from '../../../../assets/icons/ehcv.png';

const Motion = motion;
const PHONE_REGEX = /^[6-9]\d{9}$/;
const PARCEL_BOOKING_DRAFT_KEY = 'parcelBookingDraft';
const DELIVERY_CATEGORY_SEARCH_TOKENS = {
  trucks: ['truck', 'lcv', 'hcv', 'mcv', 'loader'],
  '2wheeler': ['bike', 'scooter', 'cycle', '2-wheeler'],
  movers: ['mover', 'packers'],
};
const LOCATION_COORDS = {
  'Pipaliyahana, Indore': [75.9048, 22.7039],
  'Vijay Nagar': [75.8937, 22.7533],
  'Vijay Nagar Square': [75.8947, 22.7518],
  Rajwada: [75.8553, 22.7187],
  Bhawarkua: [75.8586, 22.6926],
  'MG Road': [75.8721, 22.7196],
  'Palasia Square': [75.8863, 22.7242],
  'LIG Colony': [75.8904, 22.7322],
  'Scheme No 54': [75.8978, 22.7567],
  'AB Road': [75.8878, 22.7423],
  'Geeta Bhawan': [75.8834, 22.7208],
  'Sapna Sangeeta': [75.8587, 22.6984],
  'Mahalaxmi Nagar': [75.9114, 22.7676],
};
const POPULAR_LOCATIONS = Object.keys(LOCATION_COORDS);
const DEFAULT_COORDS = { lat: 22.7196, lng: 75.8577 };
const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' };

const getCoords = (title, fallback = [75.8577, 22.7196]) => LOCATION_COORDS[title] || fallback;

const readStoredUserInfo = () => {
  if (typeof window === 'undefined') return {};

  try {
    return JSON.parse(window.localStorage.getItem('userInfo') || '{}');
  } catch {
    return {};
  }
};

const readParcelBookingDraft = () => {
  if (typeof window === 'undefined') return {};

  try {
    return JSON.parse(window.sessionStorage.getItem(PARCEL_BOOKING_DRAFT_KEY) || '{}');
  } catch {
    return {};
  }
};

const coordPairToLatLng = (coords, fallback = DEFAULT_COORDS) => {
  if (Array.isArray(coords) && coords.length >= 2) {
    const [lng, lat] = coords;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  return fallback;
};

const latLngToCoordPair = (position) => [Number(position.lng), Number(position.lat)];

const toRadians = (value) => (Number(value) * Math.PI) / 180;

const calculateDistanceKm = (fromCoords, toCoords) => {
  const from = coordPairToLatLng(fromCoords, null);
  const to = coordPairToLatLng(toCoords, null);

  if (!from || !to) {
    return 0;
  }

  const earthRadiusKm = 6371;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  return earthRadiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const getNearbyPopularLocations = (anchorCoords, excludedLocations = [], limit = 4) => {
  if (!Array.isArray(anchorCoords) || anchorCoords.length < 2) {
    return POPULAR_LOCATIONS.slice(0, limit);
  }

  const excluded = new Set(
    excludedLocations
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean),
  );

  return Object.entries(LOCATION_COORDS)
    .filter(([name]) => !excluded.has(name.toLowerCase()))
    .map(([name, coords]) => ({
      name,
      distanceKm: calculateDistanceKm(anchorCoords, coords),
    }))
    .sort((first, second) => first.distanceKm - second.distanceKm)
    .slice(0, limit)
    .map((item) => item.name);
};

const normalizeDeliveryPricing = (vehicle = {}) => {
  const basePrice = Number(vehicle?.delivery_distance_pricing?.base_price ?? 0);
  const freeDistance = Number(vehicle?.delivery_distance_pricing?.free_distance ?? 0);
  const distancePrice = Number(vehicle?.delivery_distance_pricing?.distance_price ?? 0);
  const timePrice = Number(vehicle?.delivery_distance_pricing?.time_price ?? 0);

  return {
    enabled: Boolean(
      vehicle?.delivery_distance_pricing?.enabled ||
      basePrice > 0 ||
      distancePrice > 0 ||
      timePrice > 0
    ),
    basePrice,
    freeDistance,
    distancePrice,
  };
};

const calculateVehicleFare = (vehicle, distanceKm) => {
  const pricing = normalizeDeliveryPricing(vehicle);
  if (!pricing.enabled) {
    return null;
  }

  const extraDistanceKm = Math.max(Number(distanceKm || 0) - pricing.freeDistance, 0);
  const total = pricing.basePrice + extraDistanceKm * pricing.distancePrice;
  return Math.max(0, Math.round(total));
};

const formatCoordLabel = (coords) => {
  const position = coordPairToLatLng(coords);
  return `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
};

const formatLatLngLabel = (position) => `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
const COORDINATE_LABEL_REGEX = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;
const isCoordinateLabel = (value = '') => COORDINATE_LABEL_REGEX.test(String(value || '').trim());
const getVehicleId = (vehicle) => String(vehicle?._id || vehicle?.id || '').trim();
const isDeliveryVehicle = (vehicle) => vehicle?.active && ['delivery', 'both'].includes(String(vehicle?.transport_type || '').trim().toLowerCase());
const matchesDeliveryCategory = (vehicle, categoryId) => {
  const normalizedCategoryId = String(categoryId || '').trim().toLowerCase();
  if (!normalizedCategoryId) return false;

  const configuredCategory = String(vehicle?.delivery_category || '').trim().toLowerCase();
  if (configuredCategory) {
    return configuredCategory === normalizedCategoryId;
  }

  const searchTokens = DELIVERY_CATEGORY_SEARCH_TOKENS[normalizedCategoryId] || [];
  const vehicleName = String(vehicle?.name || '').toLowerCase();
  const iconType = String(vehicle?.icon_types || '').toLowerCase();
  return searchTokens.some((token) => vehicleName.includes(token) || iconType.includes(token));
};

const getDeliveryVehicleIcon = (vehicle) => {
  const configuredIcon = String(vehicle?.image || vehicle?.preview_image || vehicle?.previewImage || vehicle?.icon || vehicle?.map_icon || '').trim();
  if (configuredIcon) return configuredIcon;

  const iconType = String(vehicle?.icon_types || vehicle?.vehicleIconType || vehicle?.name || '').trim().toLowerCase();
  if (iconType.includes('bike')) return BikeIcon;
  if (iconType.includes('auto')) return AutoIcon;
  if (iconType.includes('ehc')) return EhcvIcon;
  if (iconType.includes('hcv')) return HcvIcon;
  if (iconType.includes('lcv')) return LcvIcon;
  if (iconType.includes('mcv')) return McvIcon;
  if (iconType.includes('truck')) return TruckIcon;
  if (iconType.includes('lux')) return LuxuryIcon;
  if (iconType.includes('premium')) return PremiumIcon;
  if (iconType.includes('suv')) return SuvIcon;

  return CarIcon;
};

const getDeliveryVehicleMapIcon = (vehicle) => {
  const configuredMapIcon = String(vehicle?.map_icon || vehicle?.vehicleIconUrl || vehicle?.icon || '').trim();
  if (configuredMapIcon) return configuredMapIcon;

  const iconType = String(vehicle?.icon_types || vehicle?.vehicleIconType || vehicle?.name || '').trim().toLowerCase();
  if (iconType.includes('bike')) return '/1_Bike.png';
  if (iconType.includes('auto')) return '/2_AutoRickshaw.png';
  if (iconType.includes('ehc')) return '/ehcv.png';
  if (iconType.includes('hcv')) return '/hcv.png';
  if (iconType.includes('lcv')) return '/LCV.png';
  if (iconType.includes('mcv')) return '/mcv.png';
  if (iconType.includes('truck')) return '/truck.png';
  if (iconType.includes('lux')) return '/Luxury.png';
  if (iconType.includes('premium')) return '/Premium.png';
  if (iconType.includes('suv')) return '/SUV.png';

  return '/4_Taxi.png';
};

const getDeliveryEtaMinutes = (distanceKm) => Math.max(8, Math.round(Math.max(0, Number(distanceKm || 0)) * 4.5));

const getLiveVehiclePosition = (coords) => {
  const position = coordPairToLatLng(coords);
  return {
    lat: position.lat + 0.0022,
    lng: position.lng + 0.0022,
  };
};

const MapDotMarker = ({ position, title, fillColor }) => (
  <OverlayView
    position={position}
    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    getPixelPositionOffset={() => ({ x: -7, y: -7 })}
  >
    <div
      className="pointer-events-none h-3.5 w-3.5 rounded-full border-2 border-white shadow-[0_8px_18px_rgba(15,23,42,0.22)]"
      style={{ backgroundColor: fillColor }}
      title={title}
      aria-label={title}
    />
  </OverlayView>
);

const MapVehicleMarker = ({ position, iconUrl, title }) => (
  <OverlayView
    position={position}
    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    getPixelPositionOffset={() => ({ x: -24, y: -24 })}
  >
    <img
      src={iconUrl}
      alt={title}
      draggable={false}
      className="pointer-events-none h-12 w-12 object-contain drop-shadow-[0_8px_12px_rgba(15,23,42,0.28)]"
      title={title}
    />
  </OverlayView>
);

const PhoneInput = ({ label, value, onChange, error, name, onClearError, disabled = false }) => (
  <div className="space-y-2">
    <label className="ml-1 text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</label>
    <div
      className={`flex items-center gap-3 rounded-[18px] border p-4 transition-all ${
        error
          ? 'border-red-200 bg-red-50'
          : value && PHONE_REGEX.test(value)
            ? 'border-emerald-100 bg-emerald-50'
            : 'border-slate-200 bg-slate-50/80'
      }`}
    >
      <Phone
        size={18}
        className={
          error ? 'text-red-500' : value && PHONE_REGEX.test(value) ? 'text-emerald-500' : 'text-slate-400'
        }
      />
      <input
        type="tel"
        maxLength={10}
        disabled={disabled}
        className="flex-1 bg-transparent text-[15px] font-semibold text-slate-900 outline-none placeholder:text-slate-300"
        value={value}
        placeholder="10-digit mobile number"
        onChange={(event) => {
          const nextValue = event.target.value.replace(/\D/g, '');
          onChange(nextValue);
          if (onClearError) onClearError(name, nextValue);
        }}
      />
      {value && PHONE_REGEX.test(value) ? <CheckCircle2 size={18} className="shrink-0 text-emerald-500" /> : null}
    </div>
    {error ? (
      <p className="ml-2 flex items-center gap-1 text-[11px] font-black text-red-500">
        <AlertCircle size={11} strokeWidth={3} />
        {error}
      </p>
    ) : null}
  </div>
);

const MapPickerSheet = ({ open, title, confirmLabel, value, initialCoords, onClose, onConfirm }) => {
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const [center, setCenter] = useState(coordPairToLatLng(initialCoords));
  const [selectedAddress, setSelectedAddress] = useState(value || formatCoordLabel(initialCoords));
  const [isLocating, setIsLocating] = useState(false);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const mapRef = useRef(null);
  const draggingRef = useRef(false);
  const geocodeTimerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const resetTimer = setTimeout(() => {
      setCenter(coordPairToLatLng(initialCoords));
      setSelectedAddress(value || formatCoordLabel(initialCoords));
    }, 0);

    return () => clearTimeout(resetTimer);
  }, [initialCoords, open, value]);

  useEffect(() => {
    if (!open || !isLoaded || !window.google?.maps?.Geocoder) return undefined;

    clearTimeout(geocodeTimerRef.current);
    geocodeTimerRef.current = setTimeout(() => {
      setIsResolvingAddress(true);
      const geocoder = new window.google.maps.Geocoder();

      geocoder.geocode({ location: center }, (results, status) => {
        setIsResolvingAddress(false);

        if (status === 'OK' && results?.[0]?.formatted_address) {
          setSelectedAddress(results[0].formatted_address);
          return;
        }

        setSelectedAddress(formatLatLngLabel(center));
      });
    }, 450);

    return () => clearTimeout(geocodeTimerRef.current);
  }, [center, isLoaded, open]);

  const commitMapCenter = () => {
    if (!mapRef.current) return;
    const mapCenter = mapRef.current.getCenter();
    if (!mapCenter) return;

    setCenter({
      lat: mapCenter.lat(),
      lng: mapCenter.lng(),
    });
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setSelectedAddress('Location access is not available on this device.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setIsLocating(false);
        setCenter(next);
        if (mapRef.current) {
          mapRef.current.panTo(next);
          mapRef.current.setZoom(16);
        }
      },
      () => {
        setIsLocating(false);
        setSelectedAddress('Could not fetch your current location.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <Motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm">
        <Motion.div
          initial={{ opacity: 0, y: '100%' }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute inset-x-0 bottom-0 top-[10%] mx-auto flex max-w-lg flex-col overflow-hidden rounded-t-[34px] bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Map Picker</p>
              <h3 className="text-lg font-black tracking-tight text-slate-900">{title}</h3>
            </div>
            <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
              <X size={18} />
            </button>
          </div>

          <div className="relative flex-1 bg-slate-100">
            {HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
              <GoogleMap
                mapContainerStyle={MAP_CONTAINER_STYLE}
                center={center}
                zoom={16}
                onLoad={(map) => {
                  mapRef.current = map;
                }}
                onUnmount={() => {
                  mapRef.current = null;
                }}
                onDragStart={() => {
                  draggingRef.current = true;
                }}
                onDragEnd={() => {
                  draggingRef.current = false;
                  commitMapCenter();
                }}
                onIdle={() => {
                  if (!mapRef.current || draggingRef.current) return;
                  commitMapCenter();
                }}
                options={{
                  disableDefaultUI: true,
                  zoomControl: false,
                  clickableIcons: false,
                  streetViewControl: false,
                  fullscreenControl: false,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm font-bold text-slate-500">
                {loadError ? 'Map could not be loaded right now.' : 'Loading map...'}
              </div>
            )}

            <div className="pointer-events-none absolute inset-x-0 top-0 px-4 pt-4">
              <div className="rounded-[22px] border border-white bg-white/92 px-4 py-4 shadow-xl backdrop-blur-md">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                  {isResolvingAddress ? 'Resolving address...' : 'Selected location'}
                </p>
                <p className="mt-1 text-[13px] font-semibold text-slate-700">{selectedAddress}</p>
              </div>
            </div>

            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border-4 border-white bg-emerald-600 shadow-xl">
                <MapPin size={18} className="text-white" />
              </div>
            </div>

            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={isLocating}
              className="absolute bottom-4 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-100 bg-white text-slate-900 shadow-xl"
            >
              <LocateFixed size={20} className={isLocating ? 'animate-pulse text-emerald-600' : ''} />
            </button>
          </div>

          <div className="bg-white px-5 pb-8 pt-5">
            <button
              type="button"
              onClick={() => onConfirm(latLngToCoordPair(center), selectedAddress)}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-emerald-600 text-sm font-black text-white shadow-[0_14px_28px_rgba(16,185,129,0.24)]"
            >
              {confirmLabel}
              <ChevronRight size={16} />
            </button>
          </div>
        </Motion.div>
      </Motion.div>
    </AnimatePresence>
  );
};

const ContactDetailsSheet = ({
  open,
  onClose,
  onSave,
  senderName,
  setSenderName,
  senderMobile,
  setSenderMobile,
  useSelfForReceiver,
  setUseSelfForReceiver,
  receiverName,
  setReceiverName,
  receiverMobile,
  setReceiverMobile,
  errors,
  clearError,
}) => {
  if (!open) return null;

  return (
    <AnimatePresence>
      <Motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm">
        <Motion.div
          initial={{ opacity: 0, y: '100%' }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: '100%' }}
          transition={{ type: 'spring', damping: 26, stiffness: 220 }}
          className="absolute inset-x-0 bottom-0 mx-auto max-w-lg overflow-hidden rounded-t-[34px] bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Booking Details</p>
              <h3 className="text-lg font-black tracking-tight text-slate-900">Sender & receiver</h3>
            </div>
            <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-50 text-slate-500">
              <X size={18} />
            </button>
          </div>

          <div className="max-h-[75vh] space-y-6 overflow-y-auto px-5 py-5">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <User size={16} />
                </div>
                <p className="text-sm font-black text-slate-900">Sender</p>
              </div>

              <div className="space-y-2">
                <div className={`flex items-center gap-3 rounded-[18px] border px-4 py-3 ${errors.senderName ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50/80'}`}>
                  <User size={16} className="text-slate-400" />
                  <input
                    type="text"
                    value={senderName}
                    placeholder="Sender name"
                    onChange={(event) => {
                      setSenderName(event.target.value);
                      clearError('senderName');
                    }}
                    className="flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-300"
                  />
                </div>
                {errors.senderName ? <p className="text-[11px] font-black text-red-500">{errors.senderName}</p> : null}
              </div>

              <PhoneInput label="Mobile Number" value={senderMobile} onChange={setSenderMobile} error={errors.senderMobile} name="senderMobile" onClearError={clearError} />
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                  <Contact size={16} />
                </div>
                <p className="text-sm font-black text-slate-900">Receiver</p>
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-[24px] border-2 border-dashed border-slate-100 bg-slate-50/30 px-4 py-4 transition-colors hover:bg-emerald-50/40 group">
                <div className="relative flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={useSelfForReceiver}
                    onChange={(event) => setUseSelfForReceiver(event.target.checked)}
                    className="peer h-5 w-5 cursor-pointer appearance-none rounded-lg border-2 border-slate-200 bg-white checked:bg-emerald-600 checked:border-emerald-600 transition-all"
                  />
                  <CheckCircle2 size={12} className="absolute text-white opacity-0 peer-checked:opacity-100 pointer-events-none" />
                </div>
                <div className="flex-1">
                  <p className="text-[13px] font-black text-slate-900 group-hover:text-emerald-600 transition-colors">Same as Sender</p>
                  <p className="text-[11px] font-bold text-slate-400">Use sender's name and mobile for receiver</p>
                </div>
              </label>

              <div className="space-y-2">
                <div className={`flex items-center gap-3 rounded-[18px] border px-4 py-3 ${errors.receiverName ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50/80'} ${useSelfForReceiver ? 'opacity-70' : ''}`}>
                  <User size={16} className="text-slate-400" />
                  <input
                    type="text"
                    value={receiverName}
                    placeholder="Receiver name"
                    disabled={useSelfForReceiver}
                    onChange={(event) => {
                      setReceiverName(event.target.value);
                      clearError('receiverName');
                    }}
                    className="flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-300"
                  />
                </div>
                {errors.receiverName ? <p className="text-[11px] font-black text-red-500">{errors.receiverName}</p> : null}
              </div>

              <PhoneInput label="Mobile Number" value={receiverMobile} onChange={setReceiverMobile} error={errors.receiverMobile} name="receiverMobile" onClearError={clearError} disabled={useSelfForReceiver} />
            </div>
          </div>

          <div className="border-t border-slate-100 px-5 py-4">
            <button
              type="button"
              onClick={onSave}
              className="flex h-14 w-full items-center justify-center gap-2 rounded-[20px] bg-emerald-600 text-sm font-black text-white shadow-[0_14px_28px_rgba(16,185,129,0.24)]"
            >
              Save Details
              <ChevronRight size={16} />
            </button>
          </div>
        </Motion.div>
      </Motion.div>
    </AnimatePresence>
  );
};

const SenderReceiverDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = useMemo(
    () => (location.pathname.startsWith('/taxi/user') ? '/taxi/user' : ''),
    [location.pathname],
  );
  const { isLoaded: isGoogleMapsLoaded } = useAppGoogleMapsLoader();
  const storedParcelDraft = useMemo(() => readParcelBookingDraft(), []);
  const parcelState = useMemo(
    () => ({ ...storedParcelDraft, ...(location.state || {}) }),
    [location.state, storedParcelDraft],
  );
  const storedUser = useMemo(() => readStoredUserInfo(), []);
  const [senderName, setSenderName] = useState(() => parcelState.senderName || storedUser?.name || '');
  const [senderMobile, setSenderMobile] = useState(() => parcelState.senderMobile || storedUser?.phone || '');
  const [useSelfForReceiver, setUseSelfForReceiver] = useState(() => {
    const receiverNameSeed = String(parcelState.receiverName || '').trim();
    const receiverMobileSeed = String(parcelState.receiverMobile || '').trim();
    const userNameSeed = String(storedUser?.name || '').trim();
    const userPhoneSeed = String(storedUser?.phone || '').trim();
    return Boolean(
      receiverNameSeed &&
      receiverMobileSeed &&
      receiverNameSeed === userNameSeed &&
      receiverMobileSeed === userPhoneSeed,
    );
  });
  const [receiverName, setReceiverName] = useState(() => parcelState.receiverName || '');
  const [receiverMobile, setReceiverMobile] = useState(() => parcelState.receiverMobile || '');
  const [pickup, setPickup] = useState(() => parcelState.pickup || '');
  const [drop, setDrop] = useState(() => parcelState.drop || '');
  const [pickupCoords, setPickupCoords] = useState(() => parcelState.pickupCoords || getCoords(parcelState.pickup || '', [75.8577, 22.7196]));
  const [dropCoords, setDropCoords] = useState(() => parcelState.dropCoords || (parcelState.drop ? getCoords(parcelState.drop || '') : null));
  const [activeMapPicker, setActiveMapPicker] = useState(null);
  const [isContactSheetOpen, setIsContactSheetOpen] = useState(false);
  const [isLocatingPickup, setIsLocatingPickup] = useState(false);
  const [errors, setErrors] = useState({});
  const [recoveredSelectedVehicles, setRecoveredSelectedVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(() => String(parcelState.selectedVehicleId || '').trim());
  const [googleDropSuggestions, setGoogleDropSuggestions] = useState([]);
  const [isFetchingDropSuggestions, setIsFetchingDropSuggestions] = useState(false);
  const autoPickupRequestedRef = useRef(false);
  const livePickupHydratedRef = useRef(false);
  const dropInputRef = useRef(null);
  const dropGeocodeTimerRef = useRef(null);
  const dropSuggestionTimerRef = useRef(null);
  const dropSuggestionCacheRef = useRef(new Map());
  const autocompleteServiceRef = useRef(null);
  const autocompleteSessionTokenRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(PARCEL_BOOKING_DRAFT_KEY, JSON.stringify({
      ...parcelState,
      senderName,
      senderMobile,
      receiverName,
      receiverMobile,
      pickup,
      drop,
      pickupCoords,
      dropCoords,
    }));
  }, [drop, dropCoords, parcelState, pickup, pickupCoords, receiverMobile, receiverName, senderMobile, senderName]);

  useEffect(() => {
    if (dropInputRef.current) {
      dropInputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    let active = true;

    const hydrateSenderDetails = async () => {
      try {
        const response = await userAuthService.getCurrentUser();
        const user = response?.data?.user || response?.data?.data || {};

        if (!active || (!user?.name && !user?.phone)) return;

        const nextName = user.name || '';
        const nextPhone = user.phone || '';

        if (nextName || nextPhone) {
          window.localStorage.setItem('userInfo', JSON.stringify({ ...storedUser, ...user }));
        }

        setSenderName((current) => (!String(current || '').trim() || String(current || '').trim() === String(storedUser?.name || '').trim() ? nextName || current : current));
        setSenderMobile((current) => (!String(current || '').trim() || String(current || '').trim() === String(storedUser?.phone || '').trim() ? nextPhone || current : current));
      } catch {
        // ignore and keep fallback info
      }
    };

    hydrateSenderDetails();

    return () => {
      active = false;
    };
  }, [storedUser]);

  useEffect(() => {
    const routeSelectedVehicles = Array.isArray(parcelState.selectedVehicles)
      ? parcelState.selectedVehicles.filter(Boolean)
      : parcelState.selectedVehicle
        ? [parcelState.selectedVehicle].filter(Boolean)
        : [];

    if (routeSelectedVehicles.length > 0) {
      setRecoveredSelectedVehicles(routeSelectedVehicles);
      return undefined;
    }

    const selectedVehicleIds = Array.isArray(parcelState.selectedVehicleIds)
      ? parcelState.selectedVehicleIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const selectedVehicleId = String(parcelState.selectedVehicleId || '').trim();
    const selectedIdSet = new Set([...selectedVehicleIds, selectedVehicleId].filter(Boolean));
    const deliveryCategory = String(parcelState.deliveryCategory || parcelState.category || '').trim().toLowerCase();

    let active = true;

    const recoverSelectedVehicles = async () => {
      try {
        const response = await api.get('/users/vehicle-types');
        const items = response?.data?.results || response?.results || response?.data?.data?.results || [];
        const deliveryVehicles = Array.isArray(items) ? items.filter(isDeliveryVehicle) : [];

        let matchedVehicles = deliveryVehicles.filter((vehicle) => selectedIdSet.has(getVehicleId(vehicle)));
        if (matchedVehicles.length === 0 && deliveryCategory) {
          matchedVehicles = deliveryVehicles.filter((vehicle) => matchesDeliveryCategory(vehicle, deliveryCategory));
        }
        if (matchedVehicles.length === 0) {
          matchedVehicles = deliveryVehicles;
        }

        if (!active) return;
        setRecoveredSelectedVehicles(matchedVehicles);
      } catch {
        if (!active) return;
        setRecoveredSelectedVehicles([]);
      }
    };

    recoverSelectedVehicles();

    return () => {
      active = false;
    };
  }, [parcelState.category, parcelState.deliveryCategory, parcelState.selectedVehicle, parcelState.selectedVehicleId, parcelState.selectedVehicleIds, parcelState.selectedVehicles]);

  const pickupSuggestions = useMemo(
    () => POPULAR_LOCATIONS.filter((item) => item.toLowerCase().includes(String(pickup || '').toLowerCase())).slice(0, 4),
    [pickup],
  );
  const dropSuggestions = useMemo(
    () => POPULAR_LOCATIONS.filter((item) => item.toLowerCase().includes(String(drop || '').toLowerCase())).slice(0, 4),
    [drop],
  );
  const nearbyDropSuggestions = useMemo(
    () => getNearbyPopularLocations(pickupCoords, [pickup, drop], 4),
    [drop, pickup, pickupCoords],
  );
  const selectedVehicles = useMemo(() => {
    if (Array.isArray(recoveredSelectedVehicles) && recoveredSelectedVehicles.length) {
      return recoveredSelectedVehicles;
    }
    return [];
  }, [recoveredSelectedVehicles]);
  const activeSelectedVehicle = useMemo(() => {
    const currentSelection = selectedVehicles.find((vehicle) => getVehicleId(vehicle) === selectedVehicleId);
    return currentSelection || selectedVehicles[0] || null;
  }, [selectedVehicleId, selectedVehicles]);
  const activeSelectedVehicleMapIcon = useMemo(
    () => activeSelectedVehicle ? getDeliveryVehicleMapIcon(activeSelectedVehicle) : '',
    [activeSelectedVehicle],
  );
  const liveVehiclePosition = useMemo(
    () => getLiveVehiclePosition(pickupCoords),
    [pickupCoords],
  );
  const estimatedDistanceKm = useMemo(
    () => calculateDistanceKm(pickupCoords, dropCoords),
    [dropCoords, pickupCoords],
  );
  const estimatedFare = useMemo(() => {
    if (!drop.trim()) {
      return null;
    }

    const dynamicFares = selectedVehicles
      .map((vehicle) => calculateVehicleFare(vehicle, estimatedDistanceKm))
      .filter((value) => Number.isFinite(value));

    if (dynamicFares.length > 0) {
      const minFare = Math.min(...dynamicFares);
      const maxFare = Math.max(...dynamicFares);
      return {
        min: minFare,
        max: maxFare,
        approx: Math.round((minFare + maxFare) / 2),
        dynamic: true,
      };
    }

    return null;
  }, [drop, estimatedDistanceKm, selectedVehicles]);
  const vehicleFareCards = useMemo(
    () => selectedVehicles
      .map((vehicle) => ({
        vehicle,
        fare: calculateVehicleFare(vehicle, estimatedDistanceKm),
      }))
      .filter((item) => Number.isFinite(item.fare)),
    [estimatedDistanceKm, selectedVehicles],
  );

  useEffect(() => {
    if (!selectedVehicles.length) {
      setSelectedVehicleId('');
      return;
    }

    if (!selectedVehicles.some((vehicle) => getVehicleId(vehicle) === selectedVehicleId)) {
      setSelectedVehicleId(getVehicleId(selectedVehicles[0]));
    }
  }, [selectedVehicleId, selectedVehicles]);

  const validate = () => {
    const nextErrors = {};
    if (!senderName.trim()) nextErrors.senderName = 'Sender name is required';
    if (!PHONE_REGEX.test(senderMobile)) nextErrors.senderMobile = 'Enter a valid 10-digit number';
    if (!receiverName.trim()) nextErrors.receiverName = 'Receiver name is required';
    if (!PHONE_REGEX.test(receiverMobile)) nextErrors.receiverMobile = 'Enter a valid 10-digit number';
    if (!pickup.trim()) nextErrors.pickup = 'Pickup location is required';
    if (!drop.trim()) nextErrors.drop = 'Drop location is required';
    setErrors(nextErrors);
    return {
      isValid: Object.keys(nextErrors).length === 0,
      nextErrors,
    };
  };

  const clearError = (key) => {
    if (!errors[key]) return;
    setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const syncReceiverWithSelf = () => {
    const nextName = String(storedUser?.name || senderName || '').trim();
    const nextPhone = String(storedUser?.phone || senderMobile || '').trim();

    setReceiverName(nextName);
    setReceiverMobile(nextPhone);
    setErrors((prev) => ({
      ...prev,
      receiverName: '',
      receiverMobile: nextPhone && !PHONE_REGEX.test(nextPhone) ? 'Enter a valid 10-digit number' : '',
    }));
  };

  useEffect(() => {
    if (!useSelfForReceiver) return;
    const timer = setTimeout(() => {
      const nextName = String(storedUser?.name || senderName || '').trim();
      const nextPhone = String(storedUser?.phone || senderMobile || '').trim();

      setReceiverName(nextName);
      setReceiverMobile(nextPhone);
      setErrors((prev) => ({
        ...prev,
        receiverName: '',
        receiverMobile: nextPhone && !PHONE_REGEX.test(nextPhone) ? 'Enter a valid 10-digit number' : '',
      }));
    }, 0);

    return () => clearTimeout(timer);
  }, [senderMobile, senderName, storedUser, useSelfForReceiver]);

  const validatePhoneField = (key, value) => {
    const trimmedValue = String(value || '').trim();

    setErrors((prev) => {
      const nextError = trimmedValue && !PHONE_REGEX.test(trimmedValue) ? 'Enter a valid 10-digit number' : '';
      if (prev[key] === nextError) return prev;
      return { ...prev, [key]: nextError };
    });
  };

  const clearPhoneError = (key, value) => {
    validatePhoneField(key, value);
  };

  const resolveAddressFromCoords = useEffectEvent((position) =>
    new Promise((resolve) => {
      if (!isGoogleMapsLoaded || !window.google?.maps?.Geocoder) {
        resolve(formatLatLngLabel(position));
        return;
      }
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ location: position }, (results, status) => {
        if (status === 'OK' && results?.[0]?.formatted_address) {
          resolve(results[0].formatted_address);
          return;
        }
        resolve(formatLatLngLabel(position));
      });
    }));

  const resolveCoordsFromAddress = useEffectEvent((address) =>
    new Promise((resolve) => {
      const trimmedAddress = String(address || '').trim();

      if (!trimmedAddress || !isGoogleMapsLoaded || !window.google?.maps?.Geocoder) {
        resolve(null);
        return;
      }

      const geocoder = new window.google.maps.Geocoder();
      const addressQuery = /indore/i.test(trimmedAddress) ? trimmedAddress : `${trimmedAddress}, Indore`;

      geocoder.geocode({ address: addressQuery }, (results, status) => {
        if (status !== 'OK' || !results?.[0]?.geometry?.location) {
          resolve(null);
          return;
        }

        const locationPoint = results[0].geometry.location;
        resolve(latLngToCoordPair({ lat: locationPoint.lat(), lng: locationPoint.lng() }));
      });
    }));

  const resolveCoordsFromPlaceId = useEffectEvent((placeId) =>
    new Promise((resolve) => {
      const trimmedPlaceId = String(placeId || '').trim();

      if (!trimmedPlaceId || !isGoogleMapsLoaded || !window.google?.maps?.Geocoder) {
        resolve(null);
        return;
      }

      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ placeId: trimmedPlaceId }, (results, status) => {
        if (status !== 'OK' || !results?.[0]?.geometry?.location) {
          resolve(null);
          return;
        }

        const locationPoint = results[0].geometry.location;
        resolve(latLngToCoordPair({ lat: locationPoint.lat(), lng: locationPoint.lng() }));
      });
    }));

  const requestCurrentPickupLocation = useEffectEvent(() => {
    if (!navigator.geolocation) {
      setErrors((prev) => ({ ...prev, pickup: 'Current location is not available' }));
      return;
    }

    setIsLocatingPickup(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude };
        const coords = latLngToCoordPair(next);
        const address = await resolveAddressFromCoords(next);
        setPickupCoords(coords);
        setPickup(address || formatLatLngLabel(next));
        clearError('pickup');
        setIsLocatingPickup(false);
      },
      () => {
        setIsLocatingPickup(false);
        setErrors((prev) => ({ ...prev, pickup: 'Location permission denied' }));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  });

  useEffect(() => {
    if (autoPickupRequestedRef.current || livePickupHydratedRef.current) return;
    autoPickupRequestedRef.current = true;
    livePickupHydratedRef.current = true;
    const timer = setTimeout(() => {
      requestCurrentPickupLocation();
    }, 0);

    return () => clearTimeout(timer);
  }, [requestCurrentPickupLocation]);

  useEffect(() => {
    if (!pickupCoords || !pickup || !isCoordinateLabel(pickup) || !isGoogleMapsLoaded) {
      return;
    }

    let active = true;

    resolveAddressFromCoords(coordPairToLatLng(pickupCoords)).then((resolvedAddress) => {
      if (!active || !resolvedAddress || isCoordinateLabel(resolvedAddress)) {
        return;
      }

      setPickup((current) => (isCoordinateLabel(current) ? resolvedAddress : current));
    });

    return () => {
      active = false;
    };
  }, [isGoogleMapsLoaded, pickup, pickupCoords]);

  useEffect(() => {
    const trimmedDrop = String(drop || '').trim();

    clearTimeout(dropGeocodeTimerRef.current);
    clearTimeout(dropSuggestionTimerRef.current);

    if (!trimmedDrop) {
      setDropCoords(null);
      setGoogleDropSuggestions([]);
      setIsFetchingDropSuggestions(false);
      return () => clearTimeout(dropGeocodeTimerRef.current);
    }

    const presetCoords = LOCATION_COORDS[trimmedDrop];
    if (presetCoords) {
      setDropCoords((current) =>
        Array.isArray(current) && current[0] === presetCoords[0] && current[1] === presetCoords[1] ? current : presetCoords,
      );
      setGoogleDropSuggestions([]);
      setIsFetchingDropSuggestions(false);
      return () => clearTimeout(dropGeocodeTimerRef.current);
    }

    if (!isGoogleMapsLoaded || isCoordinateLabel(trimmedDrop)) {
      setGoogleDropSuggestions([]);
      setIsFetchingDropSuggestions(false);
      return () => clearTimeout(dropGeocodeTimerRef.current);
    }

    if (trimmedDrop.length < 3 || !window.google?.maps?.places?.AutocompleteService) {
      setGoogleDropSuggestions([]);
      setIsFetchingDropSuggestions(false);
      return () => clearTimeout(dropGeocodeTimerRef.current);
    }

    const cacheKey = `${trimmedDrop.toLowerCase()}|${Array.isArray(pickupCoords) ? pickupCoords.join(',') : ''}`;
    const cachedSuggestions = dropSuggestionCacheRef.current.get(cacheKey);
    if (cachedSuggestions) {
      setGoogleDropSuggestions(cachedSuggestions);
      setIsFetchingDropSuggestions(false);
      return () => clearTimeout(dropGeocodeTimerRef.current);
    }

    let active = true;
    dropSuggestionTimerRef.current = setTimeout(() => {
      if (!autocompleteServiceRef.current) {
        autocompleteServiceRef.current = new window.google.maps.places.AutocompleteService();
      }
      if (!autocompleteSessionTokenRef.current && window.google?.maps?.places?.AutocompleteSessionToken) {
        autocompleteSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
      }

      setIsFetchingDropSuggestions(true);
      const request = {
        input: trimmedDrop,
        componentRestrictions: { country: 'in' },
        types: ['geocode'],
        sessionToken: autocompleteSessionTokenRef.current || undefined,
      };

      if (Array.isArray(pickupCoords) && window.google?.maps?.Circle) {
        request.locationBias = new window.google.maps.Circle({
          center: coordPairToLatLng(pickupCoords),
          radius: 12000,
        });
      }

      autocompleteServiceRef.current.getPlacePredictions(request, (predictions = [], status) => {
        if (!active) {
          return;
        }

        const normalizedSuggestions =
          status === 'OK'
            ? predictions.slice(0, 4).map((prediction) => ({
                id: prediction.place_id || prediction.description,
                label: prediction.structured_formatting?.main_text || prediction.description,
                secondaryText: prediction.structured_formatting?.secondary_text || '',
                description: prediction.description || '',
                placeId: prediction.place_id || '',
                source: 'google',
              }))
            : [];

        dropSuggestionCacheRef.current.set(cacheKey, normalizedSuggestions);
        setGoogleDropSuggestions(normalizedSuggestions);
        setIsFetchingDropSuggestions(false);
      });
    }, 350);

    return () => {
      active = false;
      clearTimeout(dropGeocodeTimerRef.current);
      clearTimeout(dropSuggestionTimerRef.current);
    };
  }, [drop, isGoogleMapsLoaded, pickupCoords]);

  const applySuggestion = async (type, suggestion) => {
    const value = typeof suggestion === 'string' ? suggestion : suggestion?.label || suggestion?.description || '';

    if (type === 'pickup') {
      setPickup(value);
      setPickupCoords(getCoords(value));
      clearError('pickup');
      return;
    }

    setDrop(value);
    if (typeof suggestion === 'string') {
      setDropCoords(getCoords(value));
    } else if (suggestion?.placeId) {
      const resolvedCoords = await resolveCoordsFromPlaceId(suggestion.placeId);
      setDropCoords(resolvedCoords);
      if (autocompleteSessionTokenRef.current && window.google?.maps?.places?.AutocompleteSessionToken) {
        autocompleteSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
      }
    }
    setGoogleDropSuggestions([]);
    clearError('drop');
  };

  const handleProceed = async ({ fromContactSheet = false } = {}) => {
    const { isValid, nextErrors } = validate();

    if (!isValid) {
      if (nextErrors.senderName || nextErrors.senderMobile || nextErrors.receiverName || nextErrors.receiverMobile) {
        setIsContactSheetOpen(true);
        return;
      }

      if (fromContactSheet) {
        setIsContactSheetOpen(false);
      }
      return;
    }

    let resolvedPickupCoords = pickupCoords;
    let resolvedDropCoords = dropCoords;

    if (!resolvedPickupCoords && pickup.trim()) {
      resolvedPickupCoords = LOCATION_COORDS[pickup.trim()] || (await resolveCoordsFromAddress(pickup));
      if (resolvedPickupCoords) {
        setPickupCoords(resolvedPickupCoords);
      }
    }

    if (!resolvedDropCoords && drop.trim()) {
      resolvedDropCoords = LOCATION_COORDS[drop.trim()] || (await resolveCoordsFromAddress(drop));
      if (resolvedDropCoords) {
        setDropCoords(resolvedDropCoords);
      }
    }

    setIsContactSheetOpen(false);
    navigate(`${routePrefix}/parcel/searching`, {
      state: {
        ...parcelState,
        selectedVehicleId: getVehicleId(activeSelectedVehicle),
        selectedVehicleIds: activeSelectedVehicle ? [getVehicleId(activeSelectedVehicle)] : [],
        selectedVehicle: activeSelectedVehicle,
        selectedVehicles: activeSelectedVehicle ? [activeSelectedVehicle] : [],
        pickup,
        drop,
        pickupCoords: resolvedPickupCoords,
        dropCoords: resolvedDropCoords,
        senderName,
        senderMobile,
        receiverName,
        receiverMobile,
        paymentMethod: 'Cash',
        fare: estimatedFare?.approx ?? estimatedFare?.min ?? null,
        estimatedFare,
        estimatedDistanceKm,
        deliveryScope: parcelState.deliveryScope || 'city',
        isOutstation: Boolean(parcelState.isOutstation || parcelState.deliveryScope === 'outstation'),
        parcel: {
          category: parcelState.parcelType || 'Parcel',
          weight: parcelState.weight || 'Under 5kg',
          description: parcelState.description || '',
          deliveryCategory: parcelState.deliveryCategory || parcelState.parcel?.deliveryCategory || '',
          goodsTypeFor: parcelState.goodsTypeFor || parcelState.parcel?.goodsTypeFor || '',
          deliveryScope: parcelState.deliveryScope || 'city',
          isOutstation: Boolean(parcelState.isOutstation || parcelState.deliveryScope === 'outstation'),
          senderName,
          senderMobile,
          receiverName,
          receiverMobile,
        },
        isParcel: true,
        searchNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
  };

  return (
    <div className="relative mx-auto h-[100dvh] max-w-lg overflow-hidden bg-slate-50 font-['Poppins']">
      <MapPickerSheet
        open={activeMapPicker === 'pickup'}
        title="Set Pickup Location"
        value={pickup}
        initialCoords={pickupCoords}
        confirmLabel="Confirm Pickup"
        onClose={() => setActiveMapPicker(null)}
        onConfirm={(coords, address) => {
          setPickupCoords(coords);
          setPickup(address || formatCoordLabel(coords));
          clearError('pickup');
          setActiveMapPicker(null);
        }}
      />
      <MapPickerSheet
        open={activeMapPicker === 'drop'}
        title="Set Delivery Location"
        value={drop}
        initialCoords={dropCoords}
        confirmLabel="Confirm Drop"
        onClose={() => setActiveMapPicker(null)}
        onConfirm={(coords, address) => {
          setDropCoords(coords);
          setDrop(address || formatCoordLabel(coords));
          clearError('drop');
          setActiveMapPicker(null);
        }}
      />
      <ContactDetailsSheet
        open={isContactSheetOpen}
        onClose={() => setIsContactSheetOpen(false)}
        onSave={() => handleProceed({ fromContactSheet: true })}
        senderName={senderName}
        setSenderName={setSenderName}
        senderMobile={senderMobile}
        setSenderMobile={setSenderMobile}
        useSelfForReceiver={useSelfForReceiver}
        setUseSelfForReceiver={(checked) => {
          setUseSelfForReceiver(checked);
          if (!checked) {
            return;
          }
          syncReceiverWithSelf();
        }}
        receiverName={receiverName}
        setReceiverName={(value) => {
          if (useSelfForReceiver) {
            setUseSelfForReceiver(false);
          }
          setReceiverName(value);
        }}
        receiverMobile={receiverMobile}
        setReceiverMobile={(value) => {
          if (useSelfForReceiver) {
            setUseSelfForReceiver(false);
          }
          setReceiverMobile(value);
        }}
        errors={errors}
        clearError={(key, value) => {
          if (key === 'senderMobile' || key === 'receiverMobile') {
            clearPhoneError(key, value);
            return;
          }
          clearError(key);
        }}
      />

      <div className="absolute inset-0 bg-slate-200">
        {HAS_VALID_GOOGLE_MAPS_KEY && isGoogleMapsLoaded ? (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER_STYLE}
            center={coordPairToLatLng(pickupCoords)}
            zoom={13}
            options={{
              disableDefaultUI: true,
              clickableIcons: false,
              streetViewControl: false,
              fullscreenControl: false,
              mapTypeControl: false,
              gestureHandling: 'greedy',
            }}
          >
            <MapDotMarker
              position={coordPairToLatLng(pickupCoords)}
              title="Pickup"
              fillColor="#10b981"
            />
            {dropCoords ? (
              <MapDotMarker
                position={coordPairToLatLng(dropCoords)}
                title="Drop"
                fillColor="#f43f5e"
              />
            ) : null}
            {activeSelectedVehicleMapIcon ? (
              <MapVehicleMarker
                key={getVehicleId(activeSelectedVehicle) || activeSelectedVehicleMapIcon}
                position={liveVehiclePosition}
                title={activeSelectedVehicle?.name || 'Selected delivery vehicle'}
                iconUrl={activeSelectedVehicleMapIcon}
              />
            ) : null}
          </GoogleMap>
        ) : (
          <div className="h-full w-full bg-[linear-gradient(135deg,#dbe4ee_0%,#f8fafc_100%)]" />
        )}

        <div className="absolute top-6 left-4 right-4 z-20 flex items-center gap-2.5">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-white/95 shadow-[0_4px_14px_rgba(15,23,42,0.12)]"
          >
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </motion.button>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-40 flex max-h-[74dvh] min-h-[420px] flex-col overflow-hidden rounded-t-[26px] bg-white shadow-[0_-12px_44px_rgba(15,23,42,0.16)]">
        <div className="mx-auto mb-2 mt-2.5 h-1 w-10 shrink-0 rounded-full bg-slate-200" />

        <div className="shrink-0 border-b border-slate-100 px-4 pb-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex gap-3">
                <div className="flex w-2.5 shrink-0 flex-col items-center">
                  <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[#7fc76d]" />
                  <span className="my-1 h-6 w-px bg-slate-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#d95c6a]" />
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveMapPicker('pickup')}
                      className="min-w-0 flex-1 rounded-[12px] -mx-1 px-1 py-1 text-left transition hover:bg-slate-50"
                    >
                      <p className="truncate text-[13px] font-medium text-slate-700">{pickup || 'Pickup location'}</p>
                      <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">{senderName || 'Sender'} {senderMobile ? `- ${senderMobile}` : ''}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsContactSheetOpen(true)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-slate-100 bg-white text-slate-400 shadow-sm"
                      aria-label="Open sender details"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      ref={dropInputRef}
                      type="text"
                      placeholder="Where is your Drop ?"
                      value={drop}
                      onChange={(event) => {
                        setDrop(event.target.value);
                        clearError('drop');
                      }}
                      className={`min-w-0 flex-1 rounded-[12px] border bg-white px-3 py-2.5 text-[13px] font-medium text-slate-700 outline-none transition ${
                        errors.drop ? 'border-red-200 bg-red-50' : 'border-slate-200 focus:border-emerald-300'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setActiveMapPicker('drop')}
                      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-slate-600"
                      aria-label="Select drop on map"
                    >
                      <LocateFixed size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveMapPicker('drop')}
              className="flex w-[42px] shrink-0 flex-col items-center justify-center rounded-[12px] border border-slate-200 bg-white px-1 py-2 text-[10px] font-medium text-slate-600"
            >
              <MapPin size={14} strokeWidth={2.2} />
              <span className="mt-1">Map</span>
            </button>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto px-3 pt-3 pb-2 space-y-2.5">
            {!drop.trim() && googleDropSuggestions.length > 0 ? (
              <div className="space-y-2.5">
                {googleDropSuggestions.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => applySuggestion('drop', item)}
                    className="flex w-full items-start gap-3 rounded-[18px] border border-slate-100 bg-white px-4 py-3 text-left shadow-sm hover:border-emerald-200"
                  >
                    <Navigation size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-slate-800">{item.label}</p>
                      {item.secondaryText ? (
                        <p className="mt-1 truncate text-[11px] font-medium text-slate-400">{item.secondaryText}</p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            {!drop.trim() && googleDropSuggestions.length === 0 ? (
              <div className="space-y-2.5">
                {nearbyDropSuggestions.map((item) => (
                  <button
                    key={item}
                    onClick={() => applySuggestion('drop', item)}
                    className="flex w-full items-center gap-3 rounded-[18px] border border-transparent bg-slate-50/70 px-4 py-3 text-left"
                  >
                    <MapPin size={14} className="shrink-0 text-emerald-500" />
                    <span className="truncate text-[13px] font-semibold text-slate-700">{item}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {Boolean(drop) && isFetchingDropSuggestions ? (
              <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-slate-400">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-500" />
                <p className="text-[11px] font-bold uppercase tracking-widest">Finding delivery options</p>
              </div>
            ) : null}

            {drop.trim() ? (
              <React.Fragment>
                <div className="mb-1 flex items-center justify-between gap-3 px-1">
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Available Delivery Vehicles</p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">{vehicleFareCards.length} options</p>
                </div>

                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                    <MapPin size={12} className="text-emerald-500" />
                    {estimatedDistanceKm.toFixed(1)} km
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1">
                    <Clock3 size={12} className="text-slate-500" />
                    {getDeliveryEtaMinutes(estimatedDistanceKm)} min
                  </span>
                </div>

                {vehicleFareCards.length > 0 ? (
                  vehicleFareCards.map(({ vehicle, fare }, index) => {
                    const vehicleId = getVehicleId(vehicle);
                    const isSelected = vehicleId === getVehicleId(activeSelectedVehicle);
                    const vehicleIcon = getDeliveryVehicleIcon(vehicle);

                    return (
                      <motion.div
                        key={vehicleId}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.34, delay: index * 0.04, ease: [0.23, 1, 0.32, 1] }}
                        className={`overflow-hidden rounded-[18px] border transition-all ${
                          isSelected
                            ? 'border-slate-200 bg-[#fbfaf8] shadow-[0_6px_16px_rgba(15,23,42,0.08)]'
                            : 'border-transparent bg-white'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedVehicleId(vehicleId)}
                          className="flex w-full items-center gap-3 px-3 py-3 text-left"
                        >
                          <div className="flex w-[52px] shrink-0 flex-col items-center">
                            <div className="flex h-9 w-full items-center justify-center">
                              <img
                                src={vehicleIcon}
                                alt={vehicle.name || 'Delivery Vehicle'}
                                className="h-8 w-12 object-contain"
                                draggable={false}
                              />
                            </div>
                            <span className="mt-1 text-[10px] font-medium text-slate-500">{getDeliveryEtaMinutes(estimatedDistanceKm)} min</span>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <span className="block truncate text-[14px] font-semibold leading-tight text-slate-900">
                                  {vehicle.name || 'Delivery Vehicle'}
                                </span>
                                <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">
                                  {vehicle.short_description || vehicle.description || 'Admin delivery pricing'}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <span className="block text-[20px] font-semibold leading-none text-slate-900">Rs {fare}</span>
                                {isSelected ? (
                                  <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700">
                                    Selected
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            {isSelected ? (
                              <p className="mt-2 truncate text-[11px] font-medium text-slate-500">
                                Based on admin delivery pricing for about {estimatedDistanceKm.toFixed(1)} km.
                              </p>
                            ) : null}
                          </div>
                        </button>

                        {!isSelected && index < vehicleFareCards.length - 1 ? (
                          <div className="ml-[68px] border-b border-slate-100" />
                        ) : null}
                      </motion.div>
                    );
                  })
                ) : (
                  <div className="rounded-[18px] border border-slate-100 bg-white px-4 py-5 text-center">
                    <p className="text-[13px] font-bold text-slate-900">No delivery vehicles available</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-400">Try changing the route or configured parcel category.</p>
                  </div>
                )}
              </React.Fragment>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2.5">
          <button
            type="button"
            onClick={handleProceed}
            className={`mt-1 flex w-full items-center justify-center gap-2 rounded-[8px] px-4 py-3.5 text-[16px] font-medium transition ${
              drop.trim() && activeSelectedVehicle
                ? 'bg-[#1f1f1f] text-white'
                : 'bg-slate-200 text-slate-400'
            }`}
          >
            {drop.trim() ? 'Confirm Receiver Details' : 'Select Drop Location'}
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SenderReceiverDetails;
