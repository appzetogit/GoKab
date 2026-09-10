import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MapPin, Calendar, Clock, ChevronRight, AlertCircle, Plane, Map as MapIcon, Navigation, LoaderCircle, Check, X } from 'lucide-react';
import { GoogleMap } from '@react-google-maps/api';
import { useAppGoogleMapsLoader, INDIA_CENTER } from '../../../admin/utils/googleMaps';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (response) => response?.data?.data || response?.data || response;
const normalizeId = (value) => String(value?._id || value?.id || value || '').trim();
const getAirports = (response) => {
  const data = unwrap(response);
  return data?.airports || data?.results || (Array.isArray(data) ? data : []);
};

const getVehicleTypes = (response) => {
  const data = unwrap(response);
  return data?.vehicle_types || data?.results || (Array.isArray(data) ? data : []);
};
 
const getSetPriceRows = (response) => {
  const data = unwrap(response);
  return (data?.paginator?.data || data?.results || []).filter((row) => {
    const scope = String(row?.pricing_scope || 'ride').trim().toLowerCase();
    return scope === 'ride';
  });
};

const isActiveAirportRule = (rule) => {
  const isActive = Number(rule?.active ?? 1) === 1 && String(rule?.status || 'active').toLowerCase() !== 'inactive';
  return isActive && Boolean(rule?.enable_airport_ride);
};

const getRuleServiceLocationId = (rule) => normalizeId(
  rule?.service_location_id?._id
  || rule?.service_location_id?.id
  || rule?.service_location_id
  || rule?.service_location?._id
  || rule?.service_location?.id
  || rule?.zone_id?.service_location_id?._id
  || rule?.zone_id?.service_location_id?.id
  || rule?.zone_id?.service_location_id
  || rule?.zone?.service_location_id?._id
  || rule?.zone?.service_location_id?.id
  || rule?.zone?.service_location_id
  || ''
);

const sortPricingRules = (rules = []) => (
  [...rules].sort((first, second) => {
    const firstUpdatedAt = new Date(first?.updatedAt || first?.createdAt || 0).getTime();
    const secondUpdatedAt = new Date(second?.updatedAt || second?.createdAt || 0).getTime();
    return secondUpdatedAt - firstUpdatedAt;
  })
);

const matchesTransportType = (rule, transportType) => {
  const normalizedRuleTransport = String(rule?.transport_type || 'taxi').trim().toLowerCase();
  const normalizedTransportType = String(transportType || 'taxi').trim().toLowerCase() || 'taxi';

  if (normalizedTransportType === 'both') {
    return normalizedRuleTransport === 'taxi' || normalizedRuleTransport === 'both';
  }

  return normalizedRuleTransport === normalizedTransportType || normalizedRuleTransport === 'both';
};

const findBestAirportPricingRule = ({ rules, vehicleTypeId, serviceLocationId, transportType }) => {
  const normalizedVehicleTypeId = normalizeId(vehicleTypeId);
  const normalizedServiceLocationId = normalizeId(serviceLocationId);
  const normalizedTransportType = String(transportType || 'taxi').trim().toLowerCase() || 'taxi';

  const candidates = sortPricingRules(rules.filter((rule) => {
    const matchesVehicle = normalizeId(rule?.vehicle_type?._id || rule?.vehicle_type || rule?.type_id) === normalizedVehicleTypeId;
    return matchesVehicle && isActiveAirportRule(rule) && matchesTransportType(rule, normalizedTransportType);
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

const getVehicleIcon = (type = {}) => {
  const customIcon = String(type?.image || type?.map_icon || type?.icon || '').trim();
  if (customIcon) return customIcon;

  const value = String(type?.icon_types || type?.name || '').toLowerCase();
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

const getVehicleLabel = (type) => type?.name || type?.vehicle_type || type?.label || 'Vehicle';

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const popularSuggestions = [
  { description: 'Delhi International Airport (DEL), New Delhi', title: 'Delhi Airport (DEL)' },
  { description: 'Connaught Place, New Delhi, Delhi', title: 'Connaught Place' },
  { description: 'Noida Sector 62, Noida, Uttar Pradesh', title: 'Noida Sector 62' },
  { description: 'Huda City Centre Metro Station, Sector 29, Gurugram, Haryana', title: 'Huda City Centre' },
  { description: 'Pipaliyahana Square, Indore, Madhya Pradesh', title: 'Pipaliyahana Square' },
  { description: 'Vijay Nagar, Indore, Madhya Pradesh', title: 'Vijay Nagar' },
];

const AirportCab = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state || {};
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const routeServiceLocationId = routeState.serviceLocationId || routeState.service_location_id || '';

  const [pickup, setPickup] = useState(routeState.pickup || '');
  const [pickupCoords, setPickupCoords] = useState(routeState.pickupCoords || null);
  const [terminal, setTerminal] = useState(routeState.terminal || '');
  const [date, setDate] = useState(routeState.date || '');
  const [time, setTime] = useState(routeState.time || '');
  const [vehicle, setVehicle] = useState('');
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const urlAirportId = queryParams.get('airportId') || '';

  const [airportId, setAirportId] = useState(
    urlAirportId || routeState.airport?._id || routeState.airport?.id || routeState.airportId || ''
  );
  const [errors, setErrors] = useState({});
  const [airports, setAirports] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [pricingRules, setPricingRules] = useState([]);
  const [isLoadingAirports, setIsLoadingAirports] = useState(true);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);
  const [isLoadingPricingRules, setIsLoadingPricingRules] = useState(true);
  const [airportError, setAirportError] = useState('');
  const [vehicleError, setVehicleError] = useState('');

  // Map Picker & Autocomplete States
  const { isLoaded } = useAppGoogleMapsLoader();
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapCenter, setMapCenter] = useState(INDIA_CENTER);
  const [pickedAddress, setPickedAddress] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Map picker refs
  const mapInstanceRef = useRef(null);
  const lastCenterRef = useRef(INDIA_CENTER);
  const autocompleteServiceRef = useRef(null);
  const geocoderRef = useRef(null);

  // 2-step flow state: 'select_airport' or 'booking_details'
  const [step, setStep] = useState(
    urlAirportId || routeState.airport?._id || routeState.airport?.id || routeState.airportId
      ? 'booking_details'
      : 'select_airport'
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const paramAirportId = params.get('airportId');
    if (paramAirportId) {
      setAirportId(paramAirportId);
      setStep('booking_details');
    } else {
      setStep('select_airport');
      setAirportId('');
    }
  }, [location.search]);

  // Load Google Maps API utilities
  useEffect(() => {
    if (!isLoaded || !window.google?.maps?.places?.AutocompleteService) return;
    autocompleteServiceRef.current = new window.google.maps.places.AutocompleteService();
    geocoderRef.current = new window.google.maps.Geocoder();
  }, [isLoaded]);

  useEffect(() => {
    let active = true;

    const loadAirports = async () => {
      try {
        setIsLoadingAirports(true);
        setAirportError('');
        const response = await api.get('/users/airports', {
          params: routeServiceLocationId ? { service_location_id: routeServiceLocationId } : {},
        });
        if (!active) return;
        setAirports(getAirports(response));
      } catch (error) {
        if (active) {
          setAirports([]);
          setAirportError(error?.message || 'Could not load airports.');
        }
      } finally {
        if (active) {
          setIsLoadingAirports(false);
        }
      }
    };

    loadAirports();

    return () => {
      active = false;
    };
  }, [routeServiceLocationId]);

  useEffect(() => {
    let active = true;

    const loadVehicles = async () => {
      try {
        setIsLoadingVehicles(true);
        setVehicleError('');
        const response = await api.get('/users/vehicle-types');
        if (!active) return;

        const nextVehicles = getVehicleTypes(response).filter((type) => {
          const isActive = type.active !== false && Number(type.status ?? 1) !== 0;
          const transportType = String(type.transport_type || 'taxi').toLowerCase();
          return isActive && (transportType === 'taxi' || transportType === 'both');
        });

        setVehicleTypes(nextVehicles);
      } catch (error) {
        if (active) {
          setVehicleTypes([]);
          setVehicleError(error?.message || 'Could not load airport vehicles.');
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
        if (!active) return;

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

  const selectedAirport = useMemo(
    () => airports.find((item) => normalizeId(item) === normalizeId(airportId)) || null,
    [airportId, airports],
  );

  useEffect(() => {
    if (step === 'booking_details') {
      if (!airportId && airports.length) {
        setAirportId(normalizeId(airports[0]));
        return;
      }
      if (airportId && airports.length && !airports.some((item) => normalizeId(item) === normalizeId(airportId))) {
        setAirportId(normalizeId(airports[0]));
      }
    }
  }, [airportId, airports, step]);

  useEffect(() => {
    if (!selectedAirport) return;
    const airportTerminal = String(selectedAirport.terminal || '').trim();
    if (!terminal && airportTerminal) {
      const list = airportTerminal.split(',').map(t => t.trim()).filter(Boolean);
      if (list.length > 0) {
        setTerminal(list[0]);
      }
    }
  }, [selectedAirport, terminal]);

  const effectiveServiceLocationId = normalizeId(
    selectedAirport?.service_location_id?._id
    || selectedAirport?.service_location_id?.id
    || selectedAirport?.service_location_id
    || routeServiceLocationId,
  );

  const vehicles = useMemo(() => (
    vehicleTypes
      .map((type, index) => {
        const pricingRule = findBestAirportPricingRule({
          rules: pricingRules,
          vehicleTypeId: type?._id || type?.id,
          serviceLocationId: effectiveServiceLocationId,
          transportType: type?.transport_type || 'taxi',
        });

        if (!pricingRule) {
          return null;
        }

        return {
          id: String(type?._id || type?.id || type?.name || index),
          vehicleTypeId: String(type?._id || type?.id || ''),
          name: getVehicleLabel(type),
          icon: getVehicleIcon(type),
          fare: Math.max(
            0,
            Math.round(
              toFiniteNumber(pricingRule?.base_price, 0)
              + toFiniteNumber(pricingRule?.airport_surge, 0)
              + toFiniteNumber(pricingRule?.support_airport_fee, 0)
              + toFiniteNumber(selectedAirport?.airport_surge, 0)
              + toFiniteNumber(selectedAirport?.support_airport_fee, 0),
            ),
          ),
          desc: type?.short_description || type?.description || 'Airport transfer option',
          seats: Math.max(1, Number(type?.capacity || 4)),
          pricingRule,
        };
      })
      .filter(Boolean)
  ), [effectiveServiceLocationId, pricingRules, vehicleTypes, selectedAirport]);

  useEffect(() => {
    if (!vehicle && vehicles.length) {
      setVehicle(vehicles[0].id);
      return;
    }

    if (vehicle && !vehicles.some((item) => item.id === vehicle)) {
      setVehicle(vehicles[0]?.id || '');
    }
  }, [vehicle, vehicles]);

  const selectedVehicle = vehicles.find((item) => item.id === vehicle) || vehicles[0] || null;

  const validate = () => {
    const nextErrors = {};
    if (!selectedAirport) nextErrors.airport = 'Select an airport';
    if (!pickup.trim()) nextErrors.pickup = 'Pickup address is required';
    if (!terminal) nextErrors.terminal = 'Select a terminal';
    if (!date) nextErrors.date = 'Select travel date';
    if (!time) nextErrors.time = 'Select travel time';
    if (!selectedVehicle) nextErrors.vehicle = 'No airport vehicles are enabled right now';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleBook = () => {
    if (!validate() || !selectedVehicle) return;

    const airportCoords = selectedAirport?.longitude != null && selectedAirport?.latitude != null
      ? [Number(selectedAirport.longitude), Number(selectedAirport.latitude)]
      : null;
    // The terminal value is free text and the quick-select chips already supply
    // it as "Terminal 1", so only prefix the label when the user hasn't typed
    // one themselves — otherwise the address reads "Terminal Terminal 1".
    const trimmedTerminal = String(terminal || '').trim();
    const terminalLabel = /^terminal\b/i.test(trimmedTerminal) ? trimmedTerminal : `Terminal ${trimmedTerminal}`;
    const dropAddress = `${airportHeading}${trimmedTerminal ? ` - ${terminalLabel}` : ''}`;
    const scheduledAt = date && time ? new Date(`${date}T${time}`).toISOString() : null;

    navigate(`${routePrefix}/cab/airport-confirm`, {
      state: {
        isAirport: true,
        airport: selectedAirport,
        airportId: normalizeId(selectedAirport),
        pickup,
        pickupCoords,
        dropAddress,
        dropCoords: airportCoords,
        serviceLocationId: effectiveServiceLocationId,
        terminal,
        date,
        time,
        scheduledAt,
        vehicle: selectedVehicle,
        vehicleTypeId: selectedVehicle.vehicleTypeId,
        vehicleIconType: selectedVehicle.name,
        vehicleIconUrl: selectedVehicle.icon,
        fare: selectedVehicle.fare,
      },
    });
  };

  const handleBack = () => {
    if (step === 'booking_details') {
      navigate(location.pathname, { state: routeState });
    } else {
      navigate(-1);
    }
  };

  // Autocomplete change handler
  const handlePickupChange = (val) => {
    setPickup(val);
    setErrors((current) => ({ ...current, pickup: '' }));

    if (!val.trim() || val.trim().length < 3 || !autocompleteServiceRef.current) {
      setAutocompleteResults([]);
      setShowSuggestions(val.trim().length > 0 ? false : true);
      return;
    }

    autocompleteServiceRef.current.getPlacePredictions(
      {
        input: val.trim(),
        componentRestrictions: { country: 'in' },
      },
      (predictions, status) => {
        if (status === 'OK' && predictions) {
          setAutocompleteResults(predictions.slice(0, 5));
          setShowSuggestions(true);
        } else {
          setAutocompleteResults([]);
        }
      }
    );
  };

  // Select suggestion item
  const handleSelectSuggestion = (suggestion) => {
    const address = suggestion.description || suggestion.formatted_address || suggestion;
    setPickup(address);
    setShowSuggestions(false);
    setAutocompleteResults([]);

    if (geocoderRef.current && window.google) {
      geocoderRef.current.geocode({ address }, (results, status) => {
        if (status === 'OK' && results?.[0]?.geometry?.location) {
          const loc = results[0].geometry.location;
          setPickupCoords([loc.lng(), loc.lat()]);
        }
      });
    }
  };

  // Map Picker event handlers
  const handleOpenMapPicker = () => {
    let center = INDIA_CENTER;
    if (pickupCoords) {
      center = { lat: pickupCoords[1], lng: pickupCoords[0] };
    } else if (selectedAirport?.latitude && selectedAirport?.longitude) {
      center = {
        lat: Number(selectedAirport.latitude),
        lng: Number(selectedAirport.longitude),
      };
    }
    setMapCenter(center);
    lastCenterRef.current = center;
    setPickedAddress(pickup || 'Locating address...');
    setShowMapPicker(true);
  };

  const handleMapIdle = () => {
    if (!mapInstanceRef.current || !geocoderRef.current) return;
    const center = mapInstanceRef.current.getCenter();
    const lat = center.lat();
    const lng = center.lng();

    const dist = Math.abs(lat - lastCenterRef.current.lat) + Math.abs(lng - lastCenterRef.current.lng);
    if (dist < 0.0001) return;

    lastCenterRef.current = { lat, lng };
    setIsGeocoding(true);

    geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
      setIsGeocoding(false);
      if (status === 'OK' && results?.[0]) {
        setPickedAddress(results[0].formatted_address);
      } else {
        setPickedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    });
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (mapInstanceRef.current) {
          mapInstanceRef.current.panTo(newCoords);
          mapInstanceRef.current.setZoom(16);
        }
      },
      () => {
        setIsLocating(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleConfirmMapLocation = () => {
    setPickup(pickedAddress);
    setPickupCoords([lastCenterRef.current.lng, lastCenterRef.current.lat]);
    setErrors((current) => ({ ...current, pickup: '' }));
    setShowMapPicker(false);
  };

  const terminalPills = useMemo(() => {
    if (!selectedAirport?.terminal) return [];
    return String(selectedAirport.terminal)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }, [selectedAirport]);

  const airportHeading = selectedAirport?.name || 'Airport';
  const isLoading = isLoadingAirports || isLoadingVehicles || isLoadingPricingRules;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F0FDF4_0%,#F8FAFC_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans pb-36 relative overflow-y-auto">
      {/* Decorative Blur Background Circles */}
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-emerald-100/60 blur-3xl pointer-events-none" />
      <div className="absolute top-80 left-[-40px] h-44 w-44 rounded-full bg-green-100/50 blur-3xl pointer-events-none" />

      {/* Sticky Header */}
      <header className="bg-white/90 backdrop-blur-md px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-white/80 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-3">
          <button 
            onClick={handleBack} 
            className="w-9 h-9 rounded-[12px] border border-slate-100 bg-white flex items-center justify-center shadow-sm active:scale-95 transition-all"
          >
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </button>
          <div className="flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Auto & Cab</p>
            <h1 className="text-[20px] font-extrabold tracking-tight text-slate-855">
              {step === 'select_airport' ? 'Select Airport' : 'Book Airport Cab'}
            </h1>
          </div>
          <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-100">
            Fixed Fare
          </span>
        </div>
      </header>

      {/* Step 1: Airport Selection */}
      {step === 'select_airport' && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="p-5 space-y-5"
        >
          {/* Beautiful Header Banner */}
          <div className="rounded-[24px] overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-800 p-5 flex items-center gap-4 shadow-[0_8px_30px_rgba(16,185,129,0.2)] relative">
            <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-white/5 rounded-full pointer-events-none" />
            <div className="flex-1">
              <p className="text-[10px] font-bold text-emerald-200 uppercase tracking-wider mb-1">On-Time & Reliable</p>
              <h2 className="text-[18px] font-extrabold text-white leading-tight">Airport Cabs</h2>
              <p className="text-[12px] font-medium text-emerald-100/90 mt-1">Fixed fares · No surge pricing · 24/7 service</p>
            </div>
            <div className="w-14 h-14 bg-white/10 rounded-[18px] flex items-center justify-center shrink-0 border border-white/10">
              <Plane size={28} className="text-white" strokeWidth={1.5} />
            </div>
          </div>

          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 ml-1 mb-3">Available Airports</h3>
            
            {airportError ? (
              <div className="rounded-[18px] border border-red-100 bg-red-50 px-4 py-3.5 text-[12px] font-medium text-red-600">
                {airportError}
              </div>
            ) : isLoadingAirports ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-24 w-full rounded-[20px] bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : airports.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-slate-200 bg-white/90 px-4 py-8 text-center text-[13px] font-medium text-slate-450">
                No active airports available at the moment.
              </div>
            ) : (
              <div className="space-y-3.5">
                {airports.map((item) => {
                  const itemId = normalizeId(item);
                  const isSelected = itemId === normalizeId(selectedAirport);
                  const serviceLocationName = item?.service_location_id?.name || item?.service_location_id?.service_location_name || '';

                  return (
                    <button
                      key={itemId}
                      onClick={() => {
                        setAirportId(itemId);
                        const aptTerminal = String(item?.terminal || '').trim();
                        const list = aptTerminal.split(',').map(t => t.trim()).filter(Boolean);
                        setTerminal(list.length > 0 ? list[0] : '');
                        setErrors((current) => ({ ...current, airport: '', terminal: '' }));
                        navigate(`${location.pathname}?airportId=${itemId}`, { state: routeState });
                      }}
                      className={`w-full rounded-[20px] border-2 p-4 text-left transition-all relative overflow-hidden group flex flex-col justify-between min-h-[115px] ${
                        isSelected 
                          ? 'border-emerald-500 bg-emerald-50/30 shadow-md shadow-emerald-500/5' 
                          : 'border-slate-100 bg-white hover:border-emerald-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 w-full">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold tracking-wider px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100">
                              {item?.code || 'APT'}
                            </span>
                            <span className="text-[11px] font-medium text-slate-550">
                              {serviceLocationName}
                            </span>
                          </div>
                          <p className="text-[16px] font-bold text-slate-800 mt-2 tracking-tight leading-snug">
                            {item?.name || 'Airport'}
                          </p>
                        </div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                          isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-50 text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-600'
                        }`}>
                          <ChevronRight size={16} strokeWidth={2.5} />
                        </div>
                      </div>

                      {item?.address && (
                        <p className="text-[11px] font-normal text-slate-400 truncate mt-2 border-t border-slate-100/60 pt-2 w-full">
                          {item.address}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Step 2: Booking Details Form */}
      {step === 'booking_details' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="px-5 pt-4 space-y-5"
        >
          {/* Selected Airport Summary Card */}
          <div className="rounded-[18px] border border-emerald-100 bg-emerald-50/50 p-4 flex items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-600/10 flex items-center justify-center text-emerald-700 shrink-0">
                <Plane size={20} strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 bg-emerald-600 text-white rounded">
                    {selectedAirport?.code || 'APT'}
                  </span>
                  <span className="text-[13px] font-bold text-slate-700 truncate">{selectedAirport?.name}</span>
                </div>
                <p className="text-[11px] font-normal text-slate-400 truncate mt-0.5">{selectedAirport?.address}</p>
              </div>
            </div>
            <button
              onClick={() => navigate(location.pathname, { state: routeState })}
              className="text-[11px] font-semibold text-emerald-600 bg-white border border-emerald-200 px-3 py-1.5 rounded-[10px] active:scale-95 transition-all shrink-0 hover:bg-emerald-50"
            >
              Change
            </button>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Pickup Address */}
            <div className="relative">
              <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 ml-1 mb-1.5 block">Pickup Address</label>
              <div className={`flex items-center gap-3 rounded-[16px] px-4 py-3.5 border-2 transition-all bg-white ${
                errors.pickup ? 'border-red-200 bg-red-50/50' : 'border-slate-100 focus-within:border-emerald-500'
              }`}>
                <MapPin size={16} className="text-slate-400 shrink-0" strokeWidth={2} />
                <input
                  type="text"
                  value={pickup}
                  onChange={(event) => handlePickupChange(event.target.value)}
                  onFocus={() => {
                    if (!pickup.trim()) {
                      setShowSuggestions(true);
                    }
                  }}
                  placeholder="Enter pickup address / city location"
                  className="flex-1 bg-transparent border-none text-[14px] font-semibold text-slate-700 focus:outline-none placeholder:text-slate-350"
                />

                {pickup && (
                  <button
                    type="button"
                    onClick={() => {
                      setPickup('');
                      setPickupCoords(null);
                      setAutocompleteResults([]);
                      setShowSuggestions(false);
                    }}
                    className="p-1 rounded-full text-slate-300 hover:text-slate-400 shrink-0"
                  >
                    <X size={14} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleOpenMapPicker}
                  className="p-1 rounded-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 shrink-0 active:scale-95 transition-all"
                  title="Locate on Map"
                >
                  <MapIcon size={18} strokeWidth={2.2} />
                </button>
              </div>

              {/* Autocomplete / Popular Location Suggestions Dropdown */}
              {showSuggestions && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowSuggestions(false)} />
                  <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-slate-100 rounded-[18px] shadow-[0_8px_30px_rgba(15,23,42,0.08)] overflow-hidden max-h-56 overflow-y-auto">
                    {autocompleteResults.length > 0 ? (
                      autocompleteResults.map((item) => (
                        <button
                          key={item.place_id || item.description}
                          type="button"
                          onClick={() => handleSelectSuggestion(item)}
                          className="w-full text-left px-4 py-3 text-[13px] font-medium text-slate-700 hover:bg-emerald-50/50 border-b border-slate-50 last:border-b-0 flex items-start gap-2.5 transition-colors"
                        >
                          <MapPin size={15} className="text-slate-400 shrink-0" strokeWidth={1.5} />
                          <span className="truncate">{item.description}</span>
                        </button>
                      ))
                    ) : (
                      popularSuggestions.map((item) => (
                        <button
                          key={item.description}
                          type="button"
                          onClick={() => handleSelectSuggestion(item)}
                          className="w-full text-left px-4 py-3.5 text-[13px] font-medium text-slate-700 hover:bg-emerald-50/50 border-b border-slate-50 last:border-b-0 flex items-start gap-2.5 transition-colors"
                        >
                          <MapPin size={15} className="text-slate-450 shrink-0 mt-1" strokeWidth={1.5} />
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 text-[12.5px] leading-none">{item.title}</p>
                            <p className="text-[11px] text-slate-400 truncate mt-1 leading-none">{item.description}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}

              {errors.pickup && (
                <p className="text-[11px] font-medium text-red-500 ml-1 mt-1 flex items-center gap-1">
                  <AlertCircle size={11} strokeWidth={3} /> {errors.pickup}
                </p>
              )}
            </div>

            {/* Terminal */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 ml-1 mb-1.5 block">Terminal</label>
              <div className={`flex items-center gap-3 rounded-[16px] px-4 py-3.5 border-2 transition-all bg-white ${
                errors.terminal ? 'border-red-200 bg-red-50/50' : 'border-slate-100 focus-within:border-emerald-500'
              }`}>
                <Plane size={16} className="text-slate-400 shrink-0" strokeWidth={2} />
                <input
                  type="text"
                  value={terminal}
                  onChange={(event) => {
                    setTerminal(event.target.value);
                    setErrors((current) => ({ ...current, terminal: '' }));
                  }}
                  placeholder="Enter terminal (e.g. T1, T3)"
                  className="flex-1 bg-transparent border-none text-[14px] font-semibold text-slate-700 focus:outline-none placeholder:text-slate-350"
                />
              </div>

              {/* Terminal Quick-Select Pills */}
              {terminalPills.length > 0 && (
                <div className="mt-2 pl-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-medium text-slate-400 mr-1">Quick Select:</span>
                  {terminalPills.map((term) => {
                    const isSelected = String(terminal).trim().toLowerCase() === term.toLowerCase();
                    return (
                      <button
                        key={term}
                        type="button"
                        onClick={() => {
                          setTerminal(term);
                          setErrors((current) => ({ ...current, terminal: '' }));
                        }}
                        className={`text-[11px] font-medium px-3 py-1 rounded-full border transition-all ${
                          isSelected
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : 'bg-white text-slate-650 border-slate-200 hover:border-emerald-300'
                        }`}
                      >
                        {term}
                      </button>
                    );
                  })}
                </div>
              )}

              {errors.terminal && (
                <p className="text-[11px] font-medium text-red-500 ml-1 mt-1 flex items-center gap-1">
                  <AlertCircle size={11} strokeWidth={3} /> {errors.terminal}
                </p>
              )}
            </div>

            {/* Travel Date & Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 ml-1 mb-1.5 block flex items-center gap-1">
                  <Calendar size={10} strokeWidth={3} /> Date
                </label>
                <input
                  type="date"
                  value={date}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setErrors((current) => ({ ...current, date: '' }));
                  }}
                  className={`w-full rounded-[14px] px-3 py-3 text-[13px] font-semibold text-slate-700 border-2 focus:outline-none transition-all bg-white ${
                    errors.date ? 'border-red-200 bg-red-50/50' : 'border-slate-100 focus:border-emerald-500'
                  }`}
                />
                {errors.date && <p className="text-[11px] font-medium text-red-500 ml-1 mt-1">{errors.date}</p>}
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 ml-1 mb-1.5 block flex items-center gap-1">
                  <Clock size={10} strokeWidth={3} /> Time
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(event) => {
                    setTime(event.target.value);
                    setErrors((current) => ({ ...current, time: '' }));
                  }}
                  className={`w-full rounded-[14px] px-3 py-3 text-[13px] font-semibold text-slate-700 border-2 focus:outline-none transition-all bg-white ${
                    errors.time ? 'border-red-200 bg-red-50/50' : 'border-slate-100 focus:border-emerald-500'
                  }`}
                />
                {errors.time && <p className="text-[11px] font-medium text-red-500 ml-1 mt-1">{errors.time}</p>}
              </div>
            </div>

            {/* Choose Vehicle */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 ml-1 mb-2.5">Choose Vehicle</p>
              {vehicleError ? (
                <div className="rounded-[18px] border border-red-100 bg-red-50 px-4 py-3.5 text-[12px] font-medium text-red-600">
                  {vehicleError}
                </div>
              ) : isLoading ? (
                <div className="rounded-[18px] border border-slate-100 bg-white px-4 py-8 text-center text-[12px] font-medium text-slate-500">
                  Loading airport vehicles...
                </div>
              ) : vehicles.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-white p-5 text-center">
                  <p className="text-[13px] font-medium text-slate-700">No airport vehicles available</p>
                  <p className="mt-1 text-[11px] font-normal text-slate-400">
                    Only vehicles with airport ride enabled in set price are shown here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {vehicles.map((item) => {
                    const isSelected = vehicle === item.id;
                    return (
                      <motion.button
                        key={item.id}
                        type="button"
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          setVehicle(item.id);
                          setErrors((current) => ({ ...current, vehicle: '' }));
                        }}
                        className={`w-full flex items-center gap-4 p-4 rounded-[20px] border-2 transition-all text-left ${
                          isSelected 
                            ? 'border-emerald-500 bg-emerald-50/30 shadow-md shadow-emerald-500/5' 
                            : 'border-slate-100 bg-white hover:border-emerald-255'
                        }`}
                      >
                        <img src={item.icon} alt={item.name} className="h-11 w-11 object-contain shrink-0" draggable={false} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-bold text-slate-800 truncate">{item.name}</span>
                            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 shrink-0">
                              Fixed Fare
                            </span>
                          </div>
                          <p className="text-[11px] font-normal text-slate-500 truncate">{item.desc} · {item.seats} seats</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[17px] font-bold text-slate-800">Rs {item.fare}</p>
                          <p className="text-[10px] font-medium text-slate-400">one way</p>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              )}
              {errors.vehicle && (
                <p className="text-[11px] font-medium text-red-500 ml-1 mt-1 flex items-center gap-1">
                  <AlertCircle size={11} strokeWidth={3} /> {errors.vehicle}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Fixed Bottom Booking Panel in Step 2 */}
      {step === 'booking_details' && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-6 pt-3 bg-gradient-to-t from-[#EEF2F7] via-[#F3F4F6]/95 to-transparent pointer-events-none z-30">
          <div className="pointer-events-auto bg-white rounded-[20px] border border-white shadow-[0_4px_14px_rgba(15,23,42,0.06)] px-4 py-3 flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold text-slate-450 uppercase tracking-wider">Fixed Fare</p>
              <p className="text-[20px] font-bold text-emerald-700">{selectedVehicle ? `Rs ${selectedVehicle.fare}` : '--'}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold text-slate-450 uppercase tracking-wider">Vehicle</p>
              <p className="text-[13px] font-semibold text-slate-700">{selectedVehicle?.name || 'Unavailable'}</p>
            </div>
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleBook}
            disabled={!selectedVehicle || isLoading}
            className="pointer-events-auto w-full bg-emerald-600 py-4 rounded-[18px] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(16,185,129,0.25)] flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-emerald-700 transition-colors"
          >
            Book Airport Cab <ChevronRight size={17} strokeWidth={3} className="opacity-60" />
          </motion.button>
        </div>
      )}

      {/* Locate on Map Modal */}
      <AnimatePresence>
        {showMapPicker && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="fixed inset-0 z-[100] bg-white flex flex-col max-w-lg mx-auto"
          >
            {/* Map Header */}
            <div className="absolute top-0 left-0 right-0 z-20 px-5 pt-10 pb-4 bg-gradient-to-b from-white via-white/80 to-transparent">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowMapPicker(false)}
                  className="w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center border border-slate-100 active:scale-95 transition-all"
                >
                  <ArrowLeft size={20} className="text-slate-900" strokeWidth={2.5} />
                </button>
                <div className="flex-1 bg-white rounded-2xl shadow-lg border border-slate-100 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Select Point</p>
                  <p className="text-[14px] font-semibold text-slate-900 truncate leading-tight">
                    {isGeocoding ? 'Locating address...' : pickedAddress || 'Pinning location'}
                  </p>
                </div>
              </div>
            </div>

            {/* Map Container */}
            <div className="flex-1 w-full h-full relative bg-slate-50">
              {isLoaded ? (
                <GoogleMap
                  mapContainerClassName="w-full h-full"
                  center={mapCenter}
                  zoom={15}
                  onLoad={(map) => {
                    mapInstanceRef.current = map;
                  }}
                  onIdle={handleMapIdle}
                  options={{
                    disableDefaultUI: true,
                    zoomControl: false,
                    gestureHandling: 'greedy',
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-450">
                  <LoaderCircle className="animate-spin text-emerald-600" size={32} />
                  <p className="text-[13px] font-medium">Loading Google Maps...</p>
                </div>
              )}

              {/* Bouncing Map Pin in the center of the viewport */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 flex flex-col items-center">
                <MapPin size={38} className="text-emerald-600 drop-shadow-md animate-bounce" fill="rgba(16,185,129,0.25)" strokeWidth={2.2} />
                <div className="w-3 h-1 bg-slate-900/30 rounded-full blur-[1px] -mt-0.5" />
              </div>

              {/* Float GPS button */}
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                className="absolute right-5 bottom-36 w-11 h-11 bg-white rounded-full shadow-lg border border-slate-100 flex items-center justify-center text-slate-700 active:scale-95 transition-all z-20 hover:bg-slate-50"
              >
                {isLocating ? (
                  <LoaderCircle className="animate-spin text-emerald-600" size={18} />
                ) : (
                  <Navigation size={18} className="rotate-45" />
                )}
              </button>
            </div>

            {/* Bottom Drawer details */}
            <div className="bg-white border-t border-slate-100 px-5 pt-4 pb-8 flex flex-col gap-4 shadow-[0_-8px_30px_rgba(15,23,42,0.04)] z-20">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pin Location</p>
                <p className="text-[15px] font-bold text-slate-800 mt-1 leading-snug">{pickedAddress || 'Move map to select location'}</p>
              </div>

              <button
                type="button"
                onClick={handleConfirmMapLocation}
                disabled={isGeocoding || !pickedAddress}
                className="w-full bg-emerald-600 text-[15px] font-bold text-white py-4 rounded-[18px] shadow-[0_8px_24px_rgba(16,185,129,0.25)] hover:bg-emerald-700 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                Confirm Location
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AirportCab;
