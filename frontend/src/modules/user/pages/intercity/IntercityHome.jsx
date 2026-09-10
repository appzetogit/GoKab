import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  LoaderCircle,
  MapPin,
  Clock,
  Navigation,
  X,
  AlertTriangle,
  User,
  ArrowUpDown,
  PhoneCall,
  Briefcase,
  Compass,
  Check,
  MapPinned,
} from 'lucide-react';
import { GoogleMap } from '@react-google-maps/api';
import { useAppGoogleMapsLoader, HAS_VALID_GOOGLE_MAPS_KEY, INDIA_CENTER } from '../../../admin/utils/googleMaps';
import { userService } from '../../services/userService';
import toast from 'react-hot-toast';
import ujjainTourImg from '@/assets/ujjain_tour.png';
import offersBannerImg from '@/assets/offers_banner.png';

const normalizeSearchValue = (value) => String(value || '').trim().toLowerCase();

const formatDateToDDMMYYYY = (dateStr) => {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}-${month}-${year}`;
};

const formatTimeTo12Hour = (timeStr) => {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.split(':');
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${String(displayHour).padStart(2, '0')}:${minutes} ${ampm}`;
};

const unwrapResults = (response) => {
  const payload = response?.data?.data || response?.data || response;
  return payload?.results || payload?.service_locations || (Array.isArray(payload) ? payload : []);
};

const getServiceLocationLabel = (item = {}) =>
  String(item?.service_location_name || item?.name || item?.city || '').trim();

const resolveServiceLocationId = (item = {}) => String(item?._id || item?.id || '').trim();

const extractCityName = (results = []) => {
  const components = Array.isArray(results?.[0]?.address_components) ? results[0].address_components : [];
  const cityComponent = components.find((component) =>
    component.types.includes('locality')
    || component.types.includes('administrative_area_level_2')
    || component.types.includes('administrative_area_level_1'),
  );
  return String(cityComponent?.long_name || '').trim();
};

const findMatchingServiceLocation = (serviceLocations = [], cityName = '') => {
  const normalizedCity = normalizeSearchValue(cityName);
  if (!normalizedCity) {
    return null;
  }

  return serviceLocations.find((item) => normalizeSearchValue(getServiceLocationLabel(item)) === normalizedCity)
    || serviceLocations.find((item) => normalizeSearchValue(getServiceLocationLabel(item)).includes(normalizedCity))
    || null;
};

const buildDestinationResult = (prediction = {}) => ({
  title: prediction.structured_formatting?.main_text || prediction.description || '',
  address: prediction.description || '',
  placeId: prediction.place_id || '',
});

const IntercityHome = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const { isLoaded } = useAppGoogleMapsLoader();

  const [loading, setLoading] = useState(true);
  const [serviceLocations, setServiceLocations] = useState([]);

  const [fromCity, setFromCity] = useState('');
  const [serviceLocationId, setServiceLocationId] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupCoords, setPickupCoords] = useState(null);

  const [toCitySearch, setToCitySearch] = useState('');
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [isToFocused, setIsToFocused] = useState(false);
  const [remoteResults, setRemoteResults] = useState([]);
  const [isSearchingDestinations, setIsSearchingDestinations] = useState(false);

  const [travelDate, setTravelDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [travelTime, setTravelTime] = useState(() => {
    const now = new Date(Date.now() + 60 * 60 * 1000);
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [tripType, setTripType] = useState('One Way');

  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapCenter, setMapCenter] = useState(INDIA_CENTER);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const mapInstanceRef = useRef(null);
  const lastCenterRef = useRef(INDIA_CENTER);
  const geocoderRef = useRef(null);
  const autocompleteServiceRef = useRef(null);
  const autocompleteSessionTokenRef = useRef(null);
  const latestSearchRef = useRef(0);
  const searchCacheRef = useRef(new Map());
  const dateTimeInputRef = useRef(null);

  useEffect(() => {
    let active = true;

    const loadInitialData = async () => {
      try {
        setLoading(true);
        const response = await userService.getServiceLocations();
        if (!active) {
          return;
        }

        const results = unwrapResults(response);
        setServiceLocations(Array.isArray(results) ? results : []);
      } catch {
        if (active) {
          setServiceLocations([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadInitialData();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !window.google?.maps?.places?.AutocompleteService) {
      return;
    }

    autocompleteServiceRef.current = autocompleteServiceRef.current || new window.google.maps.places.AutocompleteService();
    autocompleteSessionTokenRef.current = autocompleteSessionTokenRef.current
      || new window.google.maps.places.AutocompleteSessionToken();
  }, [isLoaded]);

  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setMapCenter(coords);
        setPickupCoords([coords.lng, coords.lat]);
      },
      null,
      { enableHighAccuracy: true },
    );
  }, []);

  useEffect(() => {
    if (isLoaded && pickupCoords && !pickupAddress) {
      const coords = { lat: pickupCoords[1], lng: pickupCoords[0] };
      reverseGeocode(coords);
    }
  }, [isLoaded, pickupCoords]);

  const getAutocompleteSessionToken = () => {
    if (!window.google?.maps?.places?.AutocompleteSessionToken) {
      return null;
    }

    if (!autocompleteSessionTokenRef.current) {
      autocompleteSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
    }

    return autocompleteSessionTokenRef.current;
  };

  const resetAutocompleteSessionToken = () => {
    if (!window.google?.maps?.places?.AutocompleteSessionToken) {
      autocompleteSessionTokenRef.current = null;
      return;
    }

    autocompleteSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
  };

  const getGeocoder = () => {
    if (!window.google?.maps?.Geocoder) {
      return null;
    }

    if (!geocoderRef.current) {
      geocoderRef.current = new window.google.maps.Geocoder();
    }

    return geocoderRef.current;
  };

  const reverseGeocode = (coords) => {
    const geocoder = getGeocoder();
    if (!geocoder) return;

    setIsGeocoding(true);
    geocoder.geocode({ location: coords }, (results, status) => {
      setIsGeocoding(false);
      if (status === 'OK' && results?.[0]) {
        const address = results[0].formatted_address;
        const detectedCity = extractCityName(results);
        const matchedLocation = findMatchingServiceLocation(serviceLocations, detectedCity);

        setPickupAddress(address);
        if (matchedLocation) {
          setFromCity(getServiceLocationLabel(matchedLocation));
          setServiceLocationId(resolveServiceLocationId(matchedLocation));
          return;
        }

        setFromCity(detectedCity || fromCity);
        return;
      }

      setPickupAddress(`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
    });
  };

  useEffect(() => {
    if (!pickupAddress || !serviceLocations.length || serviceLocationId) {
      return;
    }

    const matchedLocation = findMatchingServiceLocation(serviceLocations, fromCity || pickupAddress);
    if (matchedLocation) {
      setFromCity(getServiceLocationLabel(matchedLocation));
      setServiceLocationId(resolveServiceLocationId(matchedLocation));
    }
  }, [fromCity, pickupAddress, serviceLocationId, serviceLocations]);

  useEffect(() => {
    const query = toCitySearch.trim();
    if (!query || query.length < 3 || !autocompleteServiceRef.current) {
      setRemoteResults([]);
      setIsSearchingDestinations(false);
      return;
    }

    const normalizedQuery = query.toLowerCase();
    const cached = searchCacheRef.current.get(normalizedQuery);
    if (cached) {
      setRemoteResults(cached);
      setIsSearchingDestinations(false);
      return;
    }

    const requestId = latestSearchRef.current + 1;
    latestSearchRef.current = requestId;
    setIsSearchingDestinations(true);

    const timeoutId = window.setTimeout(() => {
      autocompleteServiceRef.current.getPlacePredictions(
        {
          input: query,
          componentRestrictions: { country: 'in' },
          sessionToken: getAutocompleteSessionToken(),
          types: ['geocode'],
        },
        (predictions = [], status) => {
          if (latestSearchRef.current !== requestId) {
            return;
          }

          const nextResults = status === 'OK'
            ? predictions.slice(0, 6).map(buildDestinationResult)
            : [];

          searchCacheRef.current.set(normalizedQuery, nextResults);
          setRemoteResults(nextResults);
          setIsSearchingDestinations(false);
        },
      );
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toCitySearch]);

  const handleMapIdle = () => {
    if (!mapInstanceRef.current || !window.google?.maps?.Geocoder) return;
    const center = mapInstanceRef.current.getCenter();
    const lat = center.lat();
    const lng = center.lng();
    const diff = Math.abs(lat - lastCenterRef.current.lat) + Math.abs(lng - lastCenterRef.current.lng);

    if (diff < 0.00001) {
      setIsDragging(false);
      return;
    }

    lastCenterRef.current = { lat, lng };
    setIsDragging(false);
    reverseGeocode({ lat, lng });
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const nextCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (mapInstanceRef.current) {
          mapInstanceRef.current.panTo(nextCenter);
          mapInstanceRef.current.setZoom(17);
        } else {
          setMapCenter(nextCenter);
        }
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true },
    );
  };

  const handleSwapLocations = () => {
    if (!pickupAddress && !toCitySearch) return;

    const previousPickup = pickupAddress;
    const previousPickupCoords = pickupCoords;
    const previousFromCity = fromCity;
    const previousServiceLocationId = serviceLocationId;

    setPickupAddress(selectedDestination?.address || toCitySearch || '');
    setPickupCoords(selectedDestination?.coords || null);
    setFromCity(selectedDestination?.title || toCitySearch || '');
    setServiceLocationId('');

    setToCitySearch(previousPickup || previousFromCity || '');
    if (previousPickup) {
      setSelectedDestination({
        title: previousFromCity || previousPickup,
        address: previousPickup,
        coords: previousPickupCoords,
        serviceLocationId: previousServiceLocationId,
      });
    } else {
      setSelectedDestination(null);
    }
  };

  const handleDateTimeChange = (e) => {
    const val = e.target.value;
    if (val) {
      const [d, t] = val.split('T');
      setTravelDate(d);
      setTravelTime(t);
    }
  };

  const triggerDateTimePicker = () => {
    if (dateTimeInputRef.current) {
      if (typeof dateTimeInputRef.current.showPicker === 'function') {
        dateTimeInputRef.current.showPicker();
      } else {
        dateTimeInputRef.current.focus();
        dateTimeInputRef.current.click();
      }
    }
  };

  const resolveDestinationSelection = async () => {
    if (selectedDestination?.coords && selectedDestination?.address) {
      return selectedDestination;
    }

    const query = String(toCitySearch || '').trim();
    if (!query) {
      return null;
    }

    const geocoder = getGeocoder();
    if (!geocoder) {
      return null;
    }

    return new Promise((resolve) => {
      geocoder.geocode({ address: query }, (results, status) => {
        if (status === 'OK' && results?.[0]?.geometry?.location) {
          const locationValue = results[0].geometry.location;
          resolve({
            title: results[0].address_components?.[0]?.long_name || query,
            address: results[0].formatted_address || query,
            coords: [locationValue.lng(), locationValue.lat()],
          });
          return;
        }

        resolve(null);
      });
    });
  };

  const handleDestinationSelect = async (result) => {
    if (!result) return;

    const geocoder = getGeocoder();

    if (result.placeId && geocoder) {
      geocoder.geocode({ placeId: result.placeId }, (results, status) => {
        if (status === 'OK' && results?.[0]?.geometry?.location) {
          const bestMatch = results[0];
          const nextDestination = {
            title: result.title || bestMatch.formatted_address || '',
            address: bestMatch.formatted_address || result.address || result.title || '',
            coords: [bestMatch.geometry.location.lng(), bestMatch.geometry.location.lat()],
          };

          setSelectedDestination(nextDestination);
          setToCitySearch(nextDestination.address);
          setIsToFocused(false);
          resetAutocompleteSessionToken();
          return;
        }

        setSelectedDestination(result);
        setToCitySearch(result.address || result.title || '');
        setIsToFocused(false);
        resetAutocompleteSessionToken();
      });
      return;
    }

    setSelectedDestination(result);
    setToCitySearch(result.address || result.title || '');
    setIsToFocused(false);
    resetAutocompleteSessionToken();
  };

  const handleExploreCabs = async () => {
    if (!pickupAddress) {
      toast.error('Please set your pickup location');
      setShowMapPicker(true);
      return;
    }

    const destination = await resolveDestinationSelection();
    if (!destination?.coords) {
      toast.error('Please choose a valid destination from the suggestions');
      setIsToFocused(true);
      return;
    }

    const combinedScheduledAt = new Date(`${travelDate}T${travelTime}`);
    navigate(`${routePrefix}/intercity/vehicle`, {
      state: {
        fromCity: fromCity || 'Pickup City',
        toCity: destination.title || destination.address || toCitySearch,
        dropAddress: destination.address || destination.title || toCitySearch,
        dropCoords: destination.coords,
        tripType,
        rideMode: 'schedule',
        date: travelDate,
        scheduledAt: combinedScheduledAt.toISOString(),
        pickupAddress,
        pickupCoords,
        serviceLocationId,
        serviceLocationName: fromCity || '',
      },
    });
  };

  const displayDateStr = formatDateToDDMMYYYY(travelDate);
  const displayTimeStr = formatTimeTo12Hour(travelTime);

  const destinationSuggestions = useMemo(() => remoteResults, [remoteResults]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] max-w-lg mx-auto font-sans relative overflow-x-hidden flex flex-col pb-28">
      <AnimatePresence>
        {showMapPicker && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            className="fixed inset-0 z-[100] bg-white flex flex-col max-w-lg mx-auto"
          >
            <div className="absolute top-0 left-0 right-0 z-20 px-6 pt-12 pb-6 bg-gradient-to-b from-white via-white/95 to-transparent">
              <div className="flex items-center gap-3">
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowMapPicker(false)}
                  className="w-10 h-10 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-slate-100"
                >
                  <ArrowLeft size={20} className="text-slate-900" strokeWidth={2.5} />
                </motion.button>
                <div className="flex-1 bg-white rounded-[24px] shadow-lg border border-[#d5e8f2] px-5 py-4 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#258cc4] mb-1">Pinpoint Pickup</p>
                  <p className="text-[14px] font-bold text-slate-900 truncate leading-tight">
                    {isGeocoding ? 'Finding exact address...' : (pickupAddress || 'Set location on map')}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 relative bg-slate-100">
              {HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={mapCenter}
                  zoom={15}
                  onLoad={(map) => (mapInstanceRef.current = map)}
                  onIdle={handleMapIdle}
                  onDragStart={() => setIsDragging(true)}
                  options={{
                    disableDefaultUI: true,
                    clickableIcons: false,
                    gestureHandling: 'greedy',
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-slate-50 p-10 text-center">
                  <AlertTriangle size={40} className="text-amber-400" />
                  <p className="text-[14px] font-bold text-slate-500">
                    Map service unavailable. Please check your connection or API key.
                  </p>
                </div>
              )}

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[100%] pointer-events-none z-10">
                <motion.div
                  animate={isDragging || isGeocoding ? { y: -15 } : { y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="flex flex-col items-center"
                >
                  <div className="w-12 h-12 bg-[#258cc4] rounded-[18px] flex items-center justify-center shadow-2xl border-4 border-white">
                    <MapPinned size={20} className="text-white" />
                  </div>
                  <div className="w-1 h-6 bg-[#258cc4] -mt-2 shadow-2xl" />
                </motion.div>
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-2 bg-black/20 rounded-full blur-md" />
              </div>

              <button
                onClick={handleUseCurrentLocation}
                className="absolute bottom-10 right-6 w-14 h-14 bg-white rounded-2xl shadow-xl flex items-center justify-center border border-slate-100 active:scale-90 transition-all z-20"
              >
                {isLocating ? <LoaderCircle size={24} className="animate-spin text-[#258cc4]" /> : <Navigation size={24} className="text-slate-900" />}
              </button>
            </div>

            <div className="px-6 pt-6 pb-12 bg-white border-t border-slate-50">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  const center = mapInstanceRef.current?.getCenter?.();
                  if (center) {
                    setPickupCoords([center.lng(), center.lat()]);
                  }
                  setShowMapPicker(false);
                }}
                disabled={isGeocoding}
                className="w-full h-16 bg-[#20A354] rounded-[22px] text-white font-black text-[16px] uppercase tracking-widest shadow-xl shadow-[#20A354]/20 flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-40"
              >
                <Check size={20} strokeWidth={3} />
                Confirm Pickup
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="px-6 py-4 flex items-center justify-between sticky top-0 bg-white border-b border-slate-100 z-30 shadow-sm">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => navigate(routePrefix || '/')}
          className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center border border-slate-100"
        >
          <ArrowLeft size={20} className="text-slate-800" strokeWidth={2.5} />
        </motion.button>
        <h2 className="text-[17px] font-extrabold text-slate-900 tracking-tight">Outstation Cabs</h2>
        <div className="w-9 h-9 rounded-full bg-[#ebf5fb] flex items-center justify-center text-[#258cc4] hover:opacity-90 cursor-pointer shadow-inner">
          <User size={18} strokeWidth={2.5} />
        </div>
      </header>

      <div className="px-5 pt-4">
        <div className="bg-white rounded-[28px] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.04)] border border-slate-100 relative">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-slate-200" />
            <span className="text-[10px] font-extrabold text-[#258cc4] tracking-[0.15em] uppercase whitespace-nowrap">
              India's Premier Intercity Cabs
            </span>
            <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-slate-200" />
          </div>

          <div className="flex border border-slate-200 rounded-xl p-1 mb-5 bg-white">
            <button
              onClick={() => setTripType('One Way')}
              className={`flex-1 py-3.5 rounded-lg text-center transition-all duration-200 flex flex-col items-center justify-center ${tripType === 'One Way' ? 'bg-[#20A354] text-white shadow-sm font-bold' : 'text-slate-800 hover:bg-slate-50'}`}
            >
              <span className="text-[13px] font-extrabold tracking-wide uppercase leading-tight">One Way</span>
              <span className={`text-[9px] mt-0.5 leading-none opacity-85 ${tripType === 'One Way' ? 'text-white' : 'text-slate-500'}`}>
                Drop-off only
              </span>
            </button>
            <button
              onClick={() => setTripType('Round Trip')}
              className={`flex-1 py-3.5 rounded-lg text-center transition-all duration-200 flex flex-col items-center justify-center ${tripType === 'Round Trip' ? 'bg-[#20A354] text-white shadow-sm font-bold' : 'text-slate-800 hover:bg-slate-50'}`}
            >
              <span className="text-[13px] font-extrabold tracking-wide uppercase leading-tight">Round Trip</span>
              <span className={`text-[9px] mt-0.5 leading-none opacity-85 ${tripType === 'Round Trip' ? 'text-white' : 'text-slate-500'}`}>
                Return with same cab
              </span>
            </button>
          </div>

          <div className="relative border border-slate-200 rounded-2xl bg-[#f0f6fa] p-0.5 overflow-visible">
            <div
              onClick={() => setShowMapPicker(true)}
              className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-[#e6f0f5] rounded-t-2xl transition-colors border-b border-slate-200/80"
            >
              <div className="w-6 h-6 shrink-0 flex items-center justify-center text-slate-400">
                <MapPin size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase leading-none mb-1.5">FROM</p>
                <p className="text-[15px] font-bold text-slate-800 truncate leading-snug">
                  {pickupAddress || 'Enter Pickup Location'}
                </p>
                {fromCity ? (
                  <p className="text-[11px] font-semibold text-[#258cc4] mt-1 truncate">
                    {fromCity}{serviceLocationId ? ' service area' : ''}
                  </p>
                ) : null}
              </div>
            </div>

            <button
              onClick={handleSwapLocations}
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-md border border-slate-200 flex items-center justify-center z-10 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
            >
              <ArrowUpDown size={15} className="text-[#258cc4]" />
            </button>

            <div className="px-5 py-4 flex items-center gap-4 rounded-b-2xl relative">
              <div className="w-6 h-6 shrink-0 flex items-center justify-center text-[#258cc4]">
                <MapPin size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase leading-none mb-1">TO</p>
                <input
                  type="text"
                  placeholder="Search destination"
                  value={toCitySearch}
                  onChange={(e) => {
                    setToCitySearch(e.target.value);
                    setSelectedDestination(null);
                  }}
                  onFocus={() => setIsToFocused(true)}
                  className="w-full bg-transparent border-0 outline-none p-0 font-bold text-[15px] text-slate-800 placeholder:text-slate-400 leading-snug mt-0.5"
                />
              </div>
              {toCitySearch && (
                <button
                  type="button"
                  onClick={() => {
                    setToCitySearch('');
                    setSelectedDestination(null);
                  }}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-200/50"
                >
                  <X size={14} />
                </button>
              )}

              <AnimatePresence>
                {isToFocused && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsToFocused(false)} />

                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 max-h-72 overflow-y-auto"
                    >
                      {loading ? (
                        <div className="p-8 flex items-center justify-center gap-2.5 text-slate-400">
                          <LoaderCircle size={18} className="animate-spin text-[#20A354]" />
                          <span className="text-[13px] font-medium">Loading locations...</span>
                        </div>
                      ) : isSearchingDestinations ? (
                        <div className="p-8 flex items-center justify-center gap-2.5 text-slate-400">
                          <LoaderCircle size={18} className="animate-spin text-[#20A354]" />
                          <span className="text-[13px] font-medium">Searching destinations...</span>
                        </div>
                      ) : destinationSuggestions.length > 0 ? (
                        destinationSuggestions.map((result, index) => (
                          <button
                            key={`${result.placeId || result.address || result.title}-${index}`}
                            type="button"
                            onClick={() => handleDestinationSelect(result)}
                            className="w-full px-5 py-3.5 text-left hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0 transition-colors group"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-[14px] font-black text-slate-800 group-hover:text-[#258cc4] transition-colors">
                                {result.title}
                              </p>
                              <p className="text-[11px] font-medium text-slate-500 mt-1 truncate">
                                {result.address}
                              </p>
                            </div>
                            <ChevronRight size={16} className="text-slate-300 shrink-0 ml-3" />
                          </button>
                        ))
                      ) : (
                        <div className="p-8 text-center text-slate-400">
                          <p className="text-[13px] font-bold">
                            {toCitySearch.trim().length < 3 ? 'Type at least 3 characters' : 'No destinations matching query'}
                          </p>
                          <p className="text-[11px] mt-0.5">Search for any city, station, hotel, or landmark</p>
                        </div>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div
            onClick={triggerDateTimePicker}
            className="mt-4 p-4 rounded-2xl bg-[#ebf5fb] border border-[#d5e8f2] flex items-center gap-4 cursor-pointer hover:bg-[#d9ecf6] transition-colors group relative"
          >
            <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-[#258cc4] shadow-sm">
              <Calendar size={18} />
            </div>
            <div className="flex-1">
              <p className="text-[9px] font-extrabold text-slate-400 tracking-wider uppercase leading-none mb-1.5">TRIP START</p>
              <div className="flex items-baseline gap-2">
                <span className="text-[15px] font-black text-slate-800 leading-none">{displayDateStr}</span>
                <span className="text-[12px] font-medium text-slate-500 leading-none">{displayTimeStr}</span>
              </div>
            </div>
            <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            <input
              ref={dateTimeInputRef}
              type="datetime-local"
              min={new Date().toISOString().slice(0, 16)}
              value={`${travelDate}T${travelTime}`}
              onChange={handleDateTimeChange}
              className="absolute pointer-events-none opacity-0 inset-0 w-full h-full"
            />
          </div>

          <button
            onClick={handleExploreCabs}
            type="button"
            className="mt-5 w-full bg-[#20A354] hover:bg-[#16783c] text-white font-extrabold text-[15px] py-4 rounded-xl tracking-widest shadow-md hover:shadow-lg active:scale-[0.98] transition-all text-center uppercase"
          >
            EXPLORE CABS
          </button>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex gap-4 overflow-x-auto px-5 py-2 scrollbar-hide">
          <div className="w-[280px] shrink-0 h-[140px] rounded-2xl overflow-hidden relative shadow-md group">
            <img
              src={ujjainTourImg}
              alt="Ujjain & Mahakaleshwar Tour"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent flex flex-col justify-end p-4">
              <span className="self-start bg-black/75 border border-amber-400/40 text-amber-400 text-[8px] font-extrabold px-2 py-0.5 rounded-full tracking-wider uppercase mb-1">
                Exclusive
              </span>
              <h4 className="text-white text-[15px] font-black uppercase tracking-tight leading-tight">
                Ujjain & Mahakaleshwar Tour
              </h4>
            </div>
          </div>

          <div className="w-[280px] shrink-0 h-[140px] rounded-2xl overflow-hidden relative shadow-md group">
            <img
              src={offersBannerImg}
              alt="Outstation Cab Offers"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent flex flex-col justify-end p-4">
              <span className="self-start bg-[#20A354] text-white text-[8px] font-extrabold px-2 py-0.5 rounded-full tracking-wider uppercase mb-1">
                Offers
              </span>
              <h4 className="text-white text-[15px] font-black uppercase tracking-tight leading-tight">
                First Intercity Trip? Get 20% Off!
              </h4>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 mt-6">
        <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl flex items-center justify-between shadow-sm">
          <div className="min-w-0 flex-1 pr-3">
            <p className="text-[8px] font-extrabold text-[#20A354] tracking-wider uppercase mb-0.5">SAY HELLO TO</p>
            <h4 className="text-[13px] font-extrabold text-slate-900 leading-tight">YOUR TRAVEL EXPERT</h4>
            <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">Get expert advice for smarter travel plans!</p>
          </div>
          <button
            onClick={() => window.open('tel:+918000000000', '_self')}
            type="button"
            className="bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-1.5 shadow-sm transition-all text-[11px] font-black cursor-pointer shrink-0 active:scale-95"
          >
            <PhoneCall size={12} className="text-[#258cc4]" />
            Call Expert | 24x7
          </button>
        </div>
      </div>

      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-white border-t border-slate-200 grid grid-cols-3 h-16 items-center z-40 pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.04)]">
        <button
          onClick={() => setTripType('One Way')}
          className={`flex flex-col items-center justify-center h-full border-r border-slate-100 transition-colors ${tripType === 'One Way' ? 'bg-[#20A354] text-white font-extrabold' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Compass size={18} strokeWidth={2.5} className="mb-0.5" />
          <span className="text-[9px] tracking-wide uppercase font-extrabold">One Way</span>
        </button>

        <button
          onClick={() => setTripType('Round Trip')}
          className={`flex flex-col items-center justify-center h-full border-r border-slate-100 transition-colors ${tripType === 'Round Trip' ? 'bg-[#20A354] text-white font-extrabold' : 'text-slate-500 hover:bg-slate-50'}`}
        >
          <Briefcase size={18} strokeWidth={2.5} className="mb-0.5" />
          <span className="text-[9px] tracking-wide uppercase font-extrabold">Round Trip</span>
        </button>

        <button
          onClick={() => navigate(`${routePrefix}/rental`)}
          className="flex flex-col items-center justify-center h-full border-r border-slate-100 text-slate-500 hover:bg-slate-50 transition-colors"
        >
          <Clock size={18} strokeWidth={2.5} className="mb-0.5" />
          <span className="text-[9px] tracking-wide uppercase font-extrabold">Local</span>
        </button>
      </nav>
    </div>
  );
};

export default IntercityHome;
