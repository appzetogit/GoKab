import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Calendar, ChevronRight, Clock3, Info, MapPin, Users, Route } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import { useSettings } from '../../../../shared/context/SettingsContext';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../../admin/utils/googleMaps';

const pad = (value) => String(value).padStart(2, '0');

const formatDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}`;
};

const formatDateTimeInputValue = (date) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getTomorrowLocalDateTime = () => formatDateTimeInputValue(new Date(Date.now() + 60 * 60 * 1000));
const getTodayLocalDate = () => formatDateInputValue(new Date());

const getMaxAdvanceDate = () => {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return formatDateInputValue(nextWeek);
};

const getMaxAdvanceDateTime = () => {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return formatDateTimeInputValue(nextWeek);
};

const DEFAULT_BID_STEP_AMOUNT = 10;
const DEFAULT_BID_HEADROOM_PERCENT = 20;
const AVERAGE_OUTSTATION_SPEED_KMPH = 42;

const unwrap = (response) => response?.data?.data || response?.data || response;
const normalizeId = (value) => String(value?._id || value?.id || value || '').trim();

const toConfiguredPositiveInteger = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
};

const clampPercentage = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, numeric));
};

const alignBidAmountToStep = ({ baseFare, amount, stepAmount }) => {
  const safeBaseFare = Math.max(0, Math.round(Number(baseFare || 0)));
  const safeStepAmount = toConfiguredPositiveInteger(stepAmount, DEFAULT_BID_STEP_AMOUNT);
  const safeAmount = Math.max(safeBaseFare, Math.round(Number(amount || 0)));
  const delta = safeAmount - safeBaseFare;

  if (delta === 0) {
    return safeBaseFare;
  }

  return safeBaseFare + (Math.ceil(delta / safeStepAmount) * safeStepAmount);
};

const calculateDefaultBidCeiling = (fare, stepAmount = DEFAULT_BID_STEP_AMOUNT, headroomPercent = DEFAULT_BID_HEADROOM_PERCENT) => {
  const safeFare = Math.max(0, Number(fare || 0));
  const raisedFare = safeFare * (1 + (clampPercentage(headroomPercent, DEFAULT_BID_HEADROOM_PERCENT) / 100));
  return alignBidAmountToStep({ baseFare: safeFare, amount: raisedFare, stepAmount });
};

const getDisplayDate = (rideMode, travelDate) => (rideMode === 'schedule' ? travelDate : 'Ride Now');

const getVehicleTypes = (response) => {
  const data = unwrap(response);
  return data?.vehicle_types || data?.results || (Array.isArray(data) ? data : []);
};

const getSetPriceRows = (response) => {
  const data = unwrap(response);
  return data?.paginator?.data || data?.results || [];
};

const getTypeLabel = (type) => type?.name || type?.vehicle_type || type?.label || 'Vehicle';

const getIconValue = (type) => String(type?.icon_types || type?.name || '').toLowerCase();

const getVehicleIcon = (type = {}) => {
  const customIcon = String(type?.image || type?.map_icon || type?.icon || '').trim();
  if (customIcon) return customIcon;

  const value = getIconValue(type);
  if (value.includes('bike')) return '/1_Bike.png';
  if (value.includes('auto')) return '/2_AutoRickshaw.png';
  if (value.includes('ehc')) return '/ehcv.png';
  if (value.includes('hcv')) return '/hcv.png';
  if (value.includes('lcv')) return '/LCV.png';
  if (value.includes('mcv')) return '/mcv.png';
  if (value.includes('truck')) return '/truck.png';
  if (value.includes('lux')) return '/Luxury.png';
  if (value.includes('premium')) return '/Premium.png';
  if (value.includes('suv')) return '/SUV.png';
  return '/4_Taxi.png';
};

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getRuleServiceLocationId = (rule) => normalizeId(
  rule?.service_location_id?._id
  || rule?.service_location_id?.id
  || rule?.service_location_id
  || rule?.zone?.service_location?._id
  || rule?.zone?.service_location?.id
  || rule?.zone?.service_location_id
  || '',
);

const sortPricingRules = (rules = []) => (
  [...rules].sort((first, second) => {
    const firstUpdatedAt = new Date(first?.updatedAt || first?.createdAt || 0).getTime();
    const secondUpdatedAt = new Date(second?.updatedAt || second?.createdAt || 0).getTime();
    return secondUpdatedAt - firstUpdatedAt;
  })
);

const isActiveOutstationPricingRule = (rule) => {
  const isActive = Number(rule?.active ?? 1) === 1 && String(rule?.status || 'active').toLowerCase() !== 'inactive';
  const scope = String(rule?.pricing_scope || 'ride').trim().toLowerCase();
  const enabled = Boolean(rule?.enable_outstation_ride) || Number(rule?.support_outstation || 0) > 0;
  return isActive && scope === 'ride' && enabled;
};

const matchesTransportType = (rule, transportType) => {
  const normalizedRuleTransport = String(rule?.transport_type || 'taxi').trim().toLowerCase();
  const normalizedTransportType = String(transportType || 'taxi').trim().toLowerCase() || 'taxi';

  if (normalizedTransportType === 'both') {
    return normalizedRuleTransport === 'taxi' || normalizedRuleTransport === 'both';
  }

  return normalizedRuleTransport === normalizedTransportType || normalizedRuleTransport === 'both';
};

const findBestOutstationPricingRule = ({ rules, vehicleTypeId, serviceLocationId, transportType }) => {
  const normalizedVehicleTypeId = normalizeId(vehicleTypeId);
  const normalizedServiceLocationId = normalizeId(serviceLocationId);
  const normalizedTransportType = String(transportType || 'taxi').trim().toLowerCase() || 'taxi';

  const candidates = sortPricingRules(rules.filter((rule) => {
    const matchesVehicle = normalizeId(rule?.vehicle_type?._id || rule?.vehicle_type || rule?.type_id) === normalizedVehicleTypeId;
    return matchesVehicle && isActiveOutstationPricingRule(rule) && matchesTransportType(rule, normalizedTransportType);
  }));

  if (!candidates.length) {
    return null;
  }

  const exactTransportMatch = (rule) => String(rule?.transport_type || 'taxi').trim().toLowerCase() === normalizedTransportType;

  const exactServiceLocation = candidates.find((rule) => (
    normalizedServiceLocationId
    && getRuleServiceLocationId(rule) === normalizedServiceLocationId
    && exactTransportMatch(rule)
  ));
  if (exactServiceLocation) return exactServiceLocation;

  const serviceLocationAnyTransport = candidates.find((rule) => (
    normalizedServiceLocationId && getRuleServiceLocationId(rule) === normalizedServiceLocationId
  ));
  if (serviceLocationAnyTransport) return serviceLocationAnyTransport;

  const genericTransportMatch = candidates.find((rule) => !getRuleServiceLocationId(rule) && exactTransportMatch(rule));
  if (genericTransportMatch) return genericTransportMatch;

  return candidates.find((rule) => !getRuleServiceLocationId(rule)) || candidates[0];
};

const calculateDistanceMeters = (fromCoords = [], toCoords = []) => {
  const [fromLng, fromLat] = fromCoords;
  const [toLng, toLat] = toCoords;

  if (![fromLng, fromLat, toLng, toLat].every((value) => Number.isFinite(Number(value)))) {
    return 0;
  }

  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const startLat = toRadians(fromLat);
  const endLat = toRadians(toLat);
  const a =
    Math.sin(latDelta / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusMeters * c);
};

const estimateDurationMinutes = (distanceMeters = 0) => {
  if (!Number.isFinite(Number(distanceMeters)) || Number(distanceMeters) <= 0) {
    return 0;
  }

  const metersPerMinute = (AVERAGE_OUTSTATION_SPEED_KMPH * 1000) / 60;
  return Math.max(1, Math.round(Number(distanceMeters) / metersPerMinute));
};

const calculateOutstationFare = ({ pricingRule, distanceMeters, durationMinutes, tripType }) => {
  const distanceMultiplier = tripType === 'Round Trip' ? 2 : 1;
  const durationMultiplier = tripType === 'Round Trip' ? 2 : 1;
  const distanceKm = Math.max(0, (Number(distanceMeters || 0) / 1000) * distanceMultiplier);
  const effectiveDurationMinutes = Math.max(0, Number(durationMinutes || 0) * durationMultiplier);

  const basePrice = toFiniteNumber(pricingRule?.outstation_base_price, 0);
  const baseDistance = Math.max(0, toFiniteNumber(pricingRule?.outstation_base_distance, 0));
  const pricePerDistance = toFiniteNumber(pricingRule?.outstation_price_per_distance, 0);
  const timePrice = toFiniteNumber(pricingRule?.outstation_time_price, 0);
  const serviceTax = toFiniteNumber(pricingRule?.service_tax, 0);
  const extraDistanceKm = Math.max(0, distanceKm - baseDistance);

  const subtotal = basePrice + (extraDistanceKm * pricePerDistance) + (effectiveDurationMinutes * timePrice);
  const total = subtotal + (subtotal * serviceTax) / 100;

  return Math.max(0, Math.round(total));
};

const normalizeVehicleType = (type, pricingRule, index) => {
  const dispatchType = String(type?.dispatch_type || 'normal').trim().toLowerCase();

  return {
    id: String(type?._id || type?.id || type?.name || index),
    vehicleTypeId: String(type?._id || type?.id || ''),
    transportType: String(type?.transport_type || 'taxi').trim().toLowerCase() || 'taxi',
    iconType: type?.icon_types || 'car',
    icon: getVehicleIcon(type),
    vehicleIconUrl: getVehicleIcon(type),
    name: getTypeLabel(type),
    seats: Math.max(1, Number(type?.capacity || 4)),
    desc: type?.short_description || type?.description || 'Outstation ride option',
    dispatchType,
    supportsBidding: dispatchType === 'bidding' || dispatchType === 'both',
    pricingRule,
    raw: type,
  };
};

const IntercityVehicle = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = useSettings();
  const routeState = location.state || {};
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const { isLoaded: isMapLoaded, loadError: mapLoadError } = useAppGoogleMapsLoader();

  const fromCity = routeState.fromCity || '';
  const toCity = routeState.toCity || '';
  const pickupAddress = routeState.pickupAddress || '';
  const pickupCoords = Array.isArray(routeState.pickupCoords) ? routeState.pickupCoords : null;
  const dropAddress = routeState.dropAddress || toCity;
  const dropCoords = Array.isArray(routeState.dropCoords) ? routeState.dropCoords : null;
  const serviceLocationId = routeState.serviceLocationId || routeState.service_location_id || '';

  const [tripType, setTripType] = useState(routeState.tripType || 'One Way');
  const [rideMode, setRideMode] = useState(routeState.rideMode || 'schedule');
  const [travelDate, setTravelDate] = useState(
    routeState.rideMode === 'schedule' && routeState.date && routeState.date !== 'Ride Now'
      ? routeState.date
      : getTodayLocalDate(),
  );
  const [scheduledAt, setScheduledAt] = useState(
    routeState.rideMode === 'schedule' && routeState.scheduledAt
      ? String(routeState.scheduledAt).slice(0, 16)
      : getTomorrowLocalDateTime(),
  );
  const [passengers, setPassengers] = useState(1);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [pricingRules, setPricingRules] = useState([]);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);
  const [isLoadingPricingRules, setIsLoadingPricingRules] = useState(true);
  const [vehicleError, setVehicleError] = useState('');
  const [tripMetrics, setTripMetrics] = useState(() => {
    const fallbackDistanceMeters = calculateDistanceMeters(pickupCoords || [], dropCoords || []);
    return {
      distanceMeters: fallbackDistanceMeters,
      durationMinutes: estimateDurationMinutes(fallbackDistanceMeters),
    };
  });
  const [isResolvingTripMetrics, setIsResolvingTripMetrics] = useState(true);

  const travelDateInputRef = useRef(null);
  const scheduledAtInputRef = useRef(null);
  const minTravelDate = useMemo(() => getTodayLocalDate(), []);
  const maxTravelDate = useMemo(() => getMaxAdvanceDate(), []);
  const minScheduledAt = useMemo(() => getTomorrowLocalDateTime(), []);
  const maxScheduledAt = useMemo(() => getMaxAdvanceDateTime(), []);

  useEffect(() => {
    if (!fromCity || !toCity || !pickupCoords || !dropCoords) {
      navigate(`${routePrefix}/intercity`, { replace: true });
    }
  }, [dropCoords, fromCity, navigate, pickupCoords, routePrefix, toCity]);

  useEffect(() => {
    let active = true;

    const loadVehicles = async () => {
      try {
        setIsLoadingVehicles(true);
        setVehicleError('');
        const response = await api.get('/users/vehicle-types');
        if (!active) {
          return;
        }

        const nextVehicles = getVehicleTypes(response).filter((type) => {
          const isActive = type.active !== false && Number(type.status ?? 1) !== 0;
          const transportType = String(type.transport_type || 'taxi').toLowerCase();
          return isActive && (transportType === 'taxi' || transportType === 'both');
        });

        setVehicleTypes(nextVehicles);
      } catch (error) {
        if (active) {
          setVehicleTypes([]);
          setVehicleError(error?.message || 'Could not load vehicle types.');
        }
      } finally {
        if (active) {
          setIsLoadingVehicles(false);
        }
      }
    };

    loadVehicles();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadPricingRules = async () => {
      try {
        setIsLoadingPricingRules(true);
        const response = await api.get('/admin/types/set-prices', {
          params: { scope: 'ride' },
        });
        if (!active) {
          return;
        }

        setPricingRules(getSetPriceRows(response));
      } catch {
        if (active) {
          setPricingRules([]);
        }
      } finally {
        if (active) {
          setIsLoadingPricingRules(false);
        }
      }
    };

    loadPricingRules();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const fallbackDistanceMeters = calculateDistanceMeters(pickupCoords || [], dropCoords || []);
    const fallbackDurationMinutes = estimateDurationMinutes(fallbackDistanceMeters);

    if (!pickupCoords || !dropCoords) {
      setIsResolvingTripMetrics(false);
      setTripMetrics({
        distanceMeters: fallbackDistanceMeters,
        durationMinutes: fallbackDurationMinutes,
      });
      return;
    }

    if (mapLoadError || !HAS_VALID_GOOGLE_MAPS_KEY) {
      setIsResolvingTripMetrics(false);
      setTripMetrics({
        distanceMeters: fallbackDistanceMeters,
        durationMinutes: fallbackDurationMinutes,
      });
      return;
    }

    if (!isMapLoaded || !window.google?.maps?.DirectionsService) {
      setIsResolvingTripMetrics(true);
      return;
    }

    let active = true;
    setIsResolvingTripMetrics(true);
    const directionsService = new window.google.maps.DirectionsService();

    directionsService.route(
      {
        origin: { lat: pickupCoords[1], lng: pickupCoords[0] },
        destination: { lat: dropCoords[1], lng: dropCoords[0] },
        travelMode: window.google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: false,
      },
      (result, status) => {
        if (!active) {
          return;
        }

        const routeLegs = result?.routes?.[0]?.legs || [];
        if (status === 'OK' && routeLegs.length) {
          const distanceMeters = routeLegs.reduce((sum, leg) => sum + Number(leg?.distance?.value || 0), 0);
          const durationMinutes = Math.max(
            1,
            Math.round(routeLegs.reduce((sum, leg) => sum + Number(leg?.duration?.value || 0), 0) / 60),
          );

          setTripMetrics({ distanceMeters, durationMinutes });
          setIsResolvingTripMetrics(false);
          return;
        }

        setTripMetrics({
          distanceMeters: fallbackDistanceMeters,
          durationMinutes: fallbackDurationMinutes,
        });
        setIsResolvingTripMetrics(false);
      },
    );

    return () => {
      active = false;
    };
  }, [dropCoords, isMapLoaded, mapLoadError, pickupCoords]);

  const vehicles = useMemo(() => {
    return vehicleTypes
      .map((type, index) => {
        const pricingRule = findBestOutstationPricingRule({
          rules: pricingRules,
          vehicleTypeId: type?._id || type?.id,
          serviceLocationId,
          transportType: type?.transport_type || 'taxi',
        });

        if (!pricingRule) {
          return null;
        }

        return normalizeVehicleType(type, pricingRule, index);
      })
      .filter(Boolean);
  }, [pricingRules, serviceLocationId, vehicleTypes]);

  const pricedVehicles = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        ...vehicle,
        estimatedFare: calculateOutstationFare({
          pricingRule: vehicle.pricingRule,
          distanceMeters: tripMetrics.distanceMeters,
          durationMinutes: tripMetrics.durationMinutes,
          tripType,
        }),
      })),
    [tripMetrics.distanceMeters, tripMetrics.durationMinutes, tripType, vehicles],
  );

  useEffect(() => {
    if (!selectedVehicleId && pricedVehicles.length) {
      setSelectedVehicleId(pricedVehicles[0].id);
    }
  }, [pricedVehicles, selectedVehicleId]);

  const selectedVehicle = useMemo(
    () => pricedVehicles.find((vehicle) => vehicle.id === selectedVehicleId) || pricedVehicles[0] || null,
    [pricedVehicles, selectedVehicleId],
  );

  useEffect(() => {
    if (!selectedVehicle) return;
    setPassengers((current) => Math.min(Math.max(current, 1), selectedVehicle.seats));
  }, [selectedVehicle]);

  useEffect(() => {
    if (travelDate < minTravelDate) {
      setTravelDate(minTravelDate);
      return;
    }

    if (travelDate > maxTravelDate) {
      setTravelDate(maxTravelDate);
    }
  }, [maxTravelDate, minTravelDate, travelDate]);

  useEffect(() => {
    if (!scheduledAt) return;

    if (scheduledAt < minScheduledAt) {
      setScheduledAt(minScheduledAt);
      return;
    }

    if (scheduledAt > maxScheduledAt) {
      setScheduledAt(maxScheduledAt);
    }
  }, [maxScheduledAt, minScheduledAt, scheduledAt]);

  if (!fromCity || !toCity || !pickupCoords || !dropCoords) {
    return null;
  }

  const finalFare = Number(selectedVehicle?.estimatedFare || 0);
  const configuredBidStepAmount = toConfiguredPositiveInteger(
    settings?.bidRide?.bidding_amount_increase_or_decrease,
    DEFAULT_BID_STEP_AMOUNT,
  );
  const configuredBidHighPercentage = clampPercentage(
    settings?.bidRide?.user_bidding_high_percentage,
    DEFAULT_BID_HEADROOM_PERCENT,
  );
  const tripDistanceKm = (tripMetrics.distanceMeters / 1000) * (tripType === 'Round Trip' ? 2 : 1);
  const isFarePending = isResolvingTripMetrics || isLoadingPricingRules;

  const openPicker = (inputRef) => {
    if (typeof inputRef.current?.showPicker === 'function') {
      inputRef.current.showPicker();
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.click();
  };

  const handleContinue = () => {
    if (!selectedVehicle) return;

    if (rideMode === 'schedule') {
      const parsedSchedule = new Date(scheduledAt);
      if (!scheduledAt || Number.isNaN(parsedSchedule.getTime())) {
        setScheduleError('Choose a valid schedule date and time.');
        return;
      }

      if (!travelDate || travelDate < minTravelDate) {
        setScheduleError('Travel date cannot be earlier than today.');
        return;
      }

      if (travelDate > maxTravelDate) {
        setScheduleError('Advance booking is available for up to 7 days only.');
        return;
      }

      if (parsedSchedule.getTime() <= Date.now() + 60 * 1000) {
        setScheduleError('Schedule time must be at least 1 minute ahead.');
        return;
      }
    }

    setScheduleError('');

    const vehicleState = {
      id: selectedVehicle.id,
      vehicleTypeId: selectedVehicle.vehicleTypeId,
      transportType: selectedVehicle.transportType,
      iconType: selectedVehicle.iconType,
      icon: selectedVehicle.icon,
      vehicleIconUrl: selectedVehicle.vehicleIconUrl,
      name: selectedVehicle.name,
      seats: selectedVehicle.seats,
      desc: selectedVehicle.desc,
      dispatchType: selectedVehicle.dispatchType,
      supportsBidding: selectedVehicle.supportsBidding,
      estimatedFare: selectedVehicle.estimatedFare,
      baseFare: finalFare,
      fare: finalFare,
    };

    navigate(`${routePrefix}/intercity/details`, {
      state: {
        ...routeState,
        fromCity,
        toCity,
        tripType,
        rideMode,
        date: getDisplayDate(rideMode, travelDate),
        travelDate,
        scheduledAt: rideMode === 'schedule' ? new Date(scheduledAt).toISOString() : null,
        pickupAddress,
        pickupCoords,
        dropAddress,
        dropCoords,
        serviceLocationId,
        distance: tripDistanceKm,
        estimatedDistanceMeters: tripMetrics.distanceMeters * (tripType === 'Round Trip' ? 2 : 1),
        estimatedDurationMinutes: tripMetrics.durationMinutes * (tripType === 'Round Trip' ? 2 : 1),
        vehicle: vehicleState,
        passengers,
        fare: finalFare,
        baseFare: finalFare,
        bookingMode: selectedVehicle.supportsBidding ? 'bidding' : 'normal',
        bidStepAmount: configuredBidStepAmount,
        userMaxBidFare: selectedVehicle.supportsBidding
          ? calculateDefaultBidCeiling(finalFare, configuredBidStepAmount, configuredBidHighPercentage)
          : finalFare,
      },
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 max-w-lg mx-auto pb-32">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur px-5 pt-10 pb-4">
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
          >
            <ArrowLeft size={18} />
          </motion.button>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">Intercity booking</p>
            <h1 className="truncate text-lg font-semibold text-slate-900">{toCity}</h1>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">Route</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">{fromCity} to {toCity}</h2>
              <p className="mt-2 text-sm text-slate-500">{dropAddress}</p>
            </div>
            <div className="rounded-full bg-[#20A354]/10 px-3 py-1 text-xs font-bold text-[#20A354]">
              {Math.max(1, pricedVehicles.length)} vehicle{pricedVehicles.length === 1 ? '' : 's'}
            </div>
          </div>
          {pickupAddress ? (
            <div className="mt-4 flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <MapPin size={16} className="mt-0.5 shrink-0 text-[#20A354]" />
              <span className="line-clamp-2">{pickupAddress}</span>
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Distance</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{tripDistanceKm.toFixed(tripDistanceKm >= 100 ? 0 : 1)} km</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">ETA</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {(tripMetrics.durationMinutes * (tripType === 'Round Trip' ? 2 : 1)).toFixed(0)} mins
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Trip details</h3>
            <p className="mt-1 text-sm text-slate-500">Choose how and when this trip should run.</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {['One Way', 'Round Trip'].map((type) => {
              const active = tripType === type;
              return (
                <button
                  type="button"
                  key={type}
                  onClick={() => setTripType(type)}
                  className={`rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                    active ? 'border-[#20A354] bg-[#20A354]/10 text-[#20A354]' : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRideMode('now')}
              className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                rideMode === 'now' ? 'border-[#20A354] bg-[#20A354]/10 text-[#20A354]' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <Clock3 size={16} />
              Ride now
            </button>
            <button
              type="button"
              onClick={() => setRideMode('schedule')}
              className={`flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                rideMode === 'schedule' ? 'border-[#20A354] bg-[#20A354]/10 text-[#20A354]' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <Calendar size={16} />
              Schedule
            </button>
          </div>

          {rideMode === 'schedule' ? (
            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-slate-700">Travel date</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => openPicker(travelDateInputRef)}
                  className="flex h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm text-slate-900 outline-none transition focus:border-[#20A354]"
                >
                  <span>{travelDate || 'Select travel date'}</span>
                  <Calendar size={16} className="text-slate-400" />
                </button>
                <input
                  ref={travelDateInputRef}
                  type="date"
                  min={minTravelDate}
                  max={maxTravelDate}
                  value={travelDate}
                  onChange={(event) => {
                    setTravelDate(event.target.value);
                    setScheduleError('');
                  }}
                  className="pointer-events-none absolute inset-0 opacity-0"
                  tabIndex={-1}
                />
              </div>
              <label className="mb-2 mt-4 block text-sm font-medium text-slate-700">Pickup time</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => openPicker(scheduledAtInputRef)}
                  className="flex h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm text-slate-900 outline-none transition focus:border-[#20A354]"
                >
                  <span>{scheduledAt ? scheduledAt.replace('T', ' ') : 'Select pickup time'}</span>
                  <Clock3 size={16} className="text-slate-400" />
                </button>
                <input
                  ref={scheduledAtInputRef}
                  type="datetime-local"
                  min={minScheduledAt}
                  max={maxScheduledAt}
                  value={scheduledAt}
                  onChange={(event) => {
                    setScheduledAt(event.target.value);
                    setScheduleError('');
                  }}
                  className="pointer-events-none absolute inset-0 opacity-0"
                  tabIndex={-1}
                />
              </div>
              {scheduleError ? (
                <p className="mt-2 text-sm font-medium text-rose-500">{scheduleError}</p>
              ) : (
                <p className="mt-2 text-xs text-slate-500">Drivers will be notified automatically around this scheduled time.</p>
              )}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-slate-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">Passengers</p>
                <p className="text-xs text-slate-500">Up to {selectedVehicle?.seats || 1} seats</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPassengers((current) => Math.max(1, current - 1))}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700"
              >
                -
              </button>
              <span className="w-8 text-center text-base font-semibold text-slate-900">{passengers}</span>
              <button
                type="button"
                onClick={() => setPassengers((current) => Math.min(selectedVehicle?.seats || 1, current + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-700"
              >
                +
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Choose vehicle</h3>
            <p className="mt-1 text-sm text-slate-500">Only vehicles with active outstation pricing are shown here.</p>
          </div>

          {vehicleError ? (
            <div className="rounded-3xl border border-rose-100 bg-rose-50 px-6 py-5 text-sm font-medium text-rose-600">
              {vehicleError}
            </div>
          ) : null}

          {isLoadingVehicles || isLoadingPricingRules ? (
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center">
              <p className="text-sm font-medium text-slate-500">Loading outstation vehicles...</p>
            </div>
          ) : pricedVehicles.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Info size={20} />
              </div>
              <p className="text-sm font-medium text-slate-900">No outstation vehicles available</p>
              <p className="mt-1 text-sm text-slate-500">Enable outstation pricing for a vehicle in admin to show it here.</p>
            </div>
          ) : (
            pricedVehicles.map((vehicle) => {
              const isActive = selectedVehicleId === vehicle.id;

              return (
                <button
                  type="button"
                  key={vehicle.id}
                  onClick={() => {
                    setSelectedVehicleId(vehicle.id);
                    if (passengers > vehicle.seats) {
                      setPassengers(vehicle.seats);
                    }
                  }}
                  className={`w-full rounded-3xl border p-4 text-left transition ${
                    isActive ? 'border-[#20A354] bg-[#20A354]/10 shadow-sm' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white">
                      <img src={vehicle.icon} alt={vehicle.name} className="h-10 w-10 object-contain" draggable={false} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="truncate text-base font-semibold text-slate-900">{vehicle.name}</h4>
                          <p className="mt-1 text-sm text-slate-500">{vehicle.seats} seats - {vehicle.desc}</p>
                          <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-slate-500">
                            <Route size={13} />
                            <span>{tripDistanceKm.toFixed(tripDistanceKm >= 100 ? 0 : 1)} km route</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-slate-900">
                            {isFarePending ? 'Calculating...' : `Rs ${vehicle.estimatedFare.toLocaleString()}`}
                          </p>
                          <p className="text-xs text-slate-500">outstation fare</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </section>
      </div>

      <div className="fixed bottom-0 left-1/2 w-full max-w-lg -translate-x-1/2 border-t border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">{tripType} - {getDisplayDate(rideMode, travelDate)}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {isFarePending ? 'Calculating...' : `Rs ${finalFare.toLocaleString()}`}
            </p>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={handleContinue}
            disabled={!selectedVehicle}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#20A354] hover:bg-[#16783c] px-6 text-sm font-bold text-white shadow-md hover:shadow-lg disabled:opacity-50 transition-colors"
          >
            Continue
            <ChevronRight size={16} />
          </motion.button>
        </div>
      </div>
    </div>
  );
};

export default IntercityVehicle;
