import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toHistorySafeState } from '../../../../shared/utils/historyState';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Fuel, Shield, ChevronRight, Star, Info, Car, Search, X, Bike, Sparkles, Filter, Check, MapPin, Navigation } from 'lucide-react';
import { userService } from '../../services/userService';
const DURATION_TABS = ['Hourly', 'Half-Day', 'Daily'];
const RENTAL_SELECTED_VEHICLE_STORAGE_KEY = 'selectedRentalVehicleDetail';
const RENTAL_PAGE_SIZE = 10;

const toRadians = (value) => (Number(value) * Math.PI) / 180;

const calculateDistanceKm = (from, to) => {
  if (!from || !to) return null;

  const fromLat = Number(from.latitude);
  const fromLng = Number(from.longitude);
  const toLat = Number(to.latitude);
  const toLng = Number(to.longitude);

  if (
    !Number.isFinite(fromLat) ||
    !Number.isFinite(fromLng) ||
    !Number.isFinite(toLat) ||
    !Number.isFinite(toLng)
  ) {
    return null;
  }

  const earthRadiusKm = 6371;
  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(lngDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatDistance = (value) => {
  if (!Number.isFinite(value)) return null;
  if (value < 1) return `${Math.max(100, Math.round(value * 1000))} m away`;
  return `${value.toFixed(value < 10 ? 1 : 0)} km away`;
};

const getCurrentCoordinates = () =>
  new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: Number(position.coords.latitude),
          longitude: Number(position.coords.longitude),
        }),
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  });

const infoBanner = {
  Hourly: 'Short rentals for quick city use.',
  'Half-Day': 'Mid-length rentals for errands and local trips.',
  Daily: 'Full-day rentals for flexible travel and extended usage.',
};

const durationSuffix = { Hourly: '/hr', 'Half-Day': '/6hr', Daily: '/day' };

const gradientPairs = [
  ['#F0FDF4', '#FFFFFF'],
  ['#ECFDF5', '#FFFFFF'],
  ['#F7FEE7', '#FFFFFF'],
  ['#DCFCE7', '#FFFFFF'],
  ['#FEF2F2', '#FFFFFF'],
  ['#FFF7ED', '#FFFFFF'],
];

const normalizeSearchValue = (value = '') => String(value || '').trim().toLowerCase();

const toSerializableValue = (value, fallback) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
};

const findPricingBucket = (pricing = [], minHours, maxHours = Infinity) =>
  pricing.find(
    (item) =>
      Number(item.durationHours || 0) >= minHours &&
      Number(item.durationHours || 0) <= maxHours &&
      item.active !== false,
  );

const normalizeRentalVehicle = (item = {}, index = 0) => {
  const [gradientFrom, gradientTo] = gradientPairs[index % gradientPairs.length];
  const pricing = Array.isArray(item.pricing) ? item.pricing : [];
  const hourly = findPricingBucket(pricing, 1, 5) || pricing[0] || null;
  const halfDay = findPricingBucket(pricing, 6, 12) || hourly || pricing[0] || null;
  const daily = findPricingBucket(pricing, 24, Infinity) || pricing[pricing.length - 1] || halfDay || hourly;
  const capacity = Number(item.capacity || 0);
  const luggageCapacity = Number(item.luggageCapacity || 0);
  const isBike = String(item.vehicleCategory || '').toLowerCase() === 'bike';

  const featureSet = new Set(Array.isArray(item.amenities) ? item.amenities.filter(Boolean) : []);
  if (capacity > 0) featureSet.add(`${capacity} seat${capacity === 1 ? '' : 's'}`);
  if (luggageCapacity > 0) featureSet.add(`${luggageCapacity} bag${luggageCapacity === 1 ? '' : 's'} space`);
  if (!featureSet.size) {
    featureSet.add(isBike ? 'Helmet included' : 'Comfort ride');
  }

  const prices = {
    Hourly: Number(hourly?.price || 0),
    'Half-Day': Number(halfDay?.price || 0),
    Daily: Number(daily?.price || 0),
  };

  const kmLimit = {
    Hourly: `${Number(hourly?.includedKm || 0)} km`,
    'Half-Day': `${Number(halfDay?.includedKm || 0)} km`,
    Daily: `${Number(daily?.includedKm || 0)} km`,
  };

  const sortedPackages = [...pricing].sort(
    (a, b) => Number(a.durationHours || 0) - Number(b.durationHours || 0),
  );
  const mostExpensive = sortedPackages.reduce(
    (best, current) =>
      Number(current.price || 0) > Number(best?.price || 0) ? current : best,
    sortedPackages[0] || null,
  );
  const cheapest = sortedPackages.reduce(
    (best, current) =>
      Number(current.price || 0) < Number(best?.price || 0) ? current : best,
    sortedPackages[0] || null,
  );

  let tag = `${item.vehicleCategory || 'Rental'} Ready`;
  let tagColor = 'text-emerald-700';
  let tagBg = 'bg-emerald-50 border-emerald-100';

  if (mostExpensive && String(mostExpensive.id) === String(daily?.id)) {
    tag = 'Premium';
    tagColor = 'text-green-700';
    tagBg = 'bg-green-50 border-green-100';
  } else if (cheapest && String(cheapest.id) === String(hourly?.id)) {
    tag = 'Best Value';
    tagColor = 'text-emerald-600';
    tagBg = 'bg-emerald-50 border-emerald-100';
  } else if (isBike) {
    tag = 'Most Popular';
    tagColor = 'text-orange-500';
    tagBg = 'bg-orange-50 border-orange-100';
  }

  const gallery = [
    item.coverImage,
    item.image,
    ...(Array.isArray(item.galleryImages) ? item.galleryImages : []),
    ...(Array.isArray(item.gallery) ? item.gallery : []),
    item.map_icon,
  ].filter((value, currentIndex, array) => value && array.indexOf(value) === currentIndex);

  return {
    id: item.id || item._id,
    name: item.name || 'Rental Vehicle',
    tag,
    tagColor,
    tagBg,
    image: item.image || '',
    rating: '4.8',
    fuel: isBike ? 'Self-drive · License required' : 'Self-drive · Clean and sanitized',
    prices,
    kmLimit,
    features: Array.from(featureSet).slice(0, 4),
    gradientFrom,
    gradientTo,
    rawPricing: pricing,
    gallery,
    blueprint: item.blueprint || { lowerDeck: [], upperDeck: [] },
    amenities: Array.isArray(item.amenities) ? item.amenities.filter(Boolean) : [],
    shortDescription: item.short_description || '',
    description: item.description || '',
    luggageCapacity,
    capacity,
    vehicleCategory: item.vehicleCategory || 'Vehicle',
    advancePayment: {
      enabled: Boolean(item.advancePayment?.enabled),
      paymentMode: 'fixed',
      amount: Number(item.advancePayment?.amount || 0),
      label: item.advancePayment?.label || 'Advance booking payment',
      notes: item.advancePayment?.notes || '',
    },
    serviceStoreIds: Array.isArray(item.serviceStoreIds) ? item.serviceStoreIds.map(String) : [],
  };
};

const RentalSkeleton = () => (
  <div className="space-y-4">
    {[1, 2, 3].map((i) => (
      <div key={i} className="rounded-[24px] border border-white/80 bg-white/90 shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
        <div className="px-4 pt-3.5 pb-3 flex items-center justify-between bg-slate-50/50">
          <div className="flex-1 space-y-2">
            <div className="h-3 w-16 skeleton rounded-full" />
            <div className="h-5 w-32 skeleton rounded-md" />
            <div className="h-3 w-24 skeleton rounded-md" />
            <div className="flex gap-2">
              <div className="h-3 w-8 skeleton rounded-full" />
              <div className="h-3 w-12 skeleton rounded-full" />
            </div>
          </div>
          <div className="h-16 w-20 skeleton rounded-2xl shrink-0" />
        </div>
        <div className="px-4 pb-4 pt-3 space-y-3">
          <div className="flex gap-1">
            <div className="h-4 w-12 skeleton rounded-full" />
            <div className="h-4 w-12 skeleton rounded-full" />
            <div className="h-4 w-12 skeleton rounded-full" />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="h-2 w-8 skeleton rounded-full" />
              <div className="h-6 w-20 skeleton rounded-md" />
            </div>
            <div className="h-9 w-24 skeleton rounded-xl" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

const BikeRentalHome = () => {
  const [selectedDuration, setSelectedDuration] = useState('Hourly');
  const [vehicles, setVehicles] = useState([]);
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState(() => {
    try {
      const stored = window.sessionStorage.getItem('selectedRentalStore');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [userCoordinates, setUserCoordinates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedType, setSelectedType] = useState('bike'); // 'bike' | 'car'
  const [selectedCategory, setSelectedCategory] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';

  const isVehicleBike = (v) => {
    const category = String(v.vehicleCategory || '').toLowerCase();
    return (
      category === 'bike' ||
      category.includes('bike') ||
      category.includes('scooter') ||
      category.includes('two') ||
      Number(v.capacity || 0) <= 2
    );
  };

  // Reset category filter when switching between bike/car type
  useEffect(() => {
    setSelectedCategory(null);
    setCurrentPage(1);
  }, [selectedType]);

  // Reset page when category changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCategory]);

  const openVehicleDetail = (vehicle) => {
    const payload = {
      vehicle: toSerializableValue(vehicle, null),
      duration: selectedDuration,
      selectedCenter: selectedStore ? toSerializableValue(selectedStore, null) : null,
    };

    try {
      window.sessionStorage.setItem(RENTAL_SELECTED_VEHICLE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures and continue with navigation state.
    }

    navigate(`${routePrefix}/rental/vehicle`, { state: toHistorySafeState(payload) });
  };

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        const [vehiclesRes, storesRes, locationsRes, coords] = await Promise.all([
          userService.getRentalVehicles(),
          userService.getServiceStores(),
          userService.getServiceLocations(),
          getCurrentCoordinates(),
        ]);

        const rawVehicles = vehiclesRes?.data?.results || vehiclesRes?.results || [];
        const rawStores = storesRes?.data?.results || storesRes?.results || [];
        const rawLocations = locationsRes?.data?.results || locationsRes?.results || [];

        if (!mounted) return;

        setUserCoordinates(coords);

        const locationMap = new Map(
          rawLocations
            .filter((item) => item.active !== false && item.status !== 'inactive')
            .map((item) => [String(item._id || item.id), item.service_location_name || item.name])
        );

        // Normalize and sort stores/centers
        const processedStores = rawStores
          .filter((store) => store.active !== false && store.status === 'active')
          .map((store) => {
            const distance = calculateDistanceKm(coords, {
              latitude: store.latitude,
              longitude: store.longitude,
            });
            const locationId = store.service_location_id || store.zone_id?.service_location_id;
            const cityName = locationMap.get(String(locationId)) || '';

            return {
              id: String(store._id || store.id),
              name: store.name || 'Service Center',
              address: store.address || '',
              latitude: Number(store.latitude ?? null),
              longitude: Number(store.longitude ?? null),
              cityName,
              distanceKm: distance,
              distanceLabel: formatDistance(distance),
            };
          })
          .sort((a, b) => {
            if (Number.isFinite(a.distanceKm) && Number.isFinite(b.distanceKm)) {
              return a.distanceKm - b.distanceKm;
            }
            if (Number.isFinite(a.distanceKm)) return -1;
            if (Number.isFinite(b.distanceKm)) return 1;
            return a.name.localeCompare(b.name);
          });

        setStores(processedStores);

        // Map and normalize vehicles
        const normalizedVehicles = rawVehicles
          .map((item, index) => normalizeRentalVehicle(item, index))
          .filter((item) => Object.values(item.prices).some((price) => Number(price) > 0));

        setVehicles(normalizedVehicles);

        // Sync selectedStore if details changed
        if (selectedStore) {
          const updatedStore = processedStores.find(s => s.id === selectedStore.id);
          if (updatedStore) {
            setSelectedStore(updatedStore);
          }
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(error?.message || 'Could not load rental data.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadData();
    return () => {
      mounted = false;
    };
  }, []);

  const vehiclesForSelectedStore = useMemo(() => {
    if (!selectedStore) return vehicles;
    return vehicles.filter(
      (v) => v.serviceStoreIds.length === 0 || v.serviceStoreIds.includes(selectedStore.id)
    );
  }, [vehicles, selectedStore]);

  const filteredStores = useMemo(() => {
    if (selectedStore) return [];
    
    return stores.filter((store) => {
      return vehicles.some((vehicle) => {
        const matchesType = selectedType === 'bike' ? isVehicleBike(vehicle) : !isVehicleBike(vehicle);
        if (!matchesType) return false;
        return vehicle.serviceStoreIds.length === 0 || vehicle.serviceStoreIds.includes(store.id);
      });
    });
  }, [stores, vehicles, selectedType, selectedStore]);

  const handleSelectStore = (store) => {
    setSelectedStore(store);
    setSearchQuery('');
    setCurrentPage(1);
    try {
      if (store) {
        window.sessionStorage.setItem('selectedRentalStore', JSON.stringify(store));
      } else {
        window.sessionStorage.removeItem('selectedRentalStore');
      }
    } catch {
      // Ignore storage errors
    }
  };

  const availableCountLabel = useMemo(() => {
    const targetVehicles = vehiclesForSelectedStore;
    const bikes = targetVehicles.filter(isVehicleBike).length;
    const cars = targetVehicles.length - bikes;

    if (selectedType === 'bike') {
      return `${bikes} bike${bikes === 1 ? '' : 's'}`;
    }
    if (selectedType === 'car') {
      return `${cars} car${cars === 1 ? '' : 's'}`;
    }

    return `${targetVehicles.length} vehicle${targetVehicles.length === 1 ? '' : 's'}`;
  }, [vehiclesForSelectedStore, selectedType]);

  const availableCategories = useMemo(() => {
    const typeFiltered = vehiclesForSelectedStore.filter((v) => {
      if (selectedType === 'all') return true;
      const isBike = isVehicleBike(v);
      return selectedType === 'bike' ? isBike : !isBike;
    });

    const cats = [...new Set(typeFiltered.map((v) => v.vehicleCategory))].filter(Boolean);
    return cats.filter((cat) => {
      const lower = cat.toLowerCase();
      if (selectedType === 'bike' && lower === 'bike') return false;
      if (selectedType === 'car' && lower === 'car') return false;
      return true;
    });
  }, [vehiclesForSelectedStore, selectedType]);

  const rentalSuggestions = useMemo(() => {
    const seen = new Set();
    const suggestions = [];

    vehiclesForSelectedStore.forEach((vehicle) => {
      [vehicle.name, vehicle.vehicleCategory, ...(vehicle.amenities || []), ...(vehicle.features || [])]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .forEach((item) => {
          const key = item.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            suggestions.push(item);
          }
        });
    });

    return suggestions;
  }, [vehiclesForSelectedStore]);

  const visibleSuggestions = useMemo(() => {
    const query = normalizeSearchValue(searchQuery);

    if (!query) {
      return rentalSuggestions.slice(0, 6);
    }

    return rentalSuggestions
      .filter((item) => normalizeSearchValue(item).includes(query))
      .slice(0, 6);
  }, [rentalSuggestions, searchQuery]);

  const filteredVehicles = useMemo(() => {
    let result = vehiclesForSelectedStore;

    // 1. Search Query Filter
    const query = normalizeSearchValue(searchQuery);
    if (query) {
      result = result.filter((vehicle) => {
        const haystack = [
          vehicle.name,
          vehicle.vehicleCategory,
          vehicle.shortDescription,
          vehicle.description,
          vehicle.fuel,
          ...(vehicle.amenities || []),
          ...(vehicle.features || []),
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      });
    }

    // 2. Primary Type Filter (Bike vs Car)
    if (selectedType !== 'all') {
      result = result.filter((v) => {
        const isBike = isVehicleBike(v);
        return selectedType === 'bike' ? isBike : !isBike;
      });
    }

    // 3. Sub-category Filter
    if (selectedCategory) {
      result = result.filter((v) => v.vehicleCategory === selectedCategory);
    }

    return result;
  }, [searchQuery, vehiclesForSelectedStore, selectedType, selectedCategory]);

  const filteredCountLabel = `${filteredVehicles.length} result${filteredVehicles.length === 1 ? '' : 's'}`;
  const totalPages = Math.max(1, Math.ceil(filteredVehicles.length / RENTAL_PAGE_SIZE));
  const paginatedVehicles = useMemo(() => {
    const startIndex = (currentPage - 1) * RENTAL_PAGE_SIZE;
    return filteredVehicles.slice(startIndex, startIndex + RENTAL_PAGE_SIZE);
  }, [currentPage, filteredVehicles]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage((previousPage) => Math.min(previousPage, totalPages));
  }, [totalPages]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F6FCF7_0%,#F0FDF4_38%,#ECFDF5_100%)] max-w-lg mx-auto font-sans relative overflow-hidden pb-12">
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-lime-100/70 blur-3xl pointer-events-none" />
      <div className="absolute bottom-28 right-[-40px] h-40 w-40 rounded-full bg-emerald-100/70 blur-3xl pointer-events-none" />

      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 z-30 w-full"
      >
        <div className="bg-white/85 backdrop-blur-2xl px-5 pt-12 pb-5 border-b border-white/40 shadow-[0_8px_32px_rgba(15,23,42,0.06)] relative overflow-hidden">
          <div className="absolute top-0 right-0 h-32 w-32 rounded-full bg-lime-400/10 blur-[40px] pointer-events-none" />
          <div className="absolute top-0 left-0 h-24 w-24 rounded-full bg-emerald-400/10 blur-[40px] pointer-events-none" />

          <div className="relative flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <motion.button
                whileHover={{ x: -2 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => {
                  if (selectedStore) {
                    handleSelectStore(null);
                  } else {
                    navigate(-1);
                  }
                }}
                className="w-10 h-10 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-[0_4px_12px_rgba(16,185,129,0.24)] shrink-0 group transition-all"
              >
                <ArrowLeft size={20} className="text-white group-hover:opacity-80 transition-opacity" strokeWidth={2.5} />
              </motion.button>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500/60 leading-none mb-1.5">Self-drive rentals</p>
                <h1 className="text-[24px] font-[900] tracking-tight text-emerald-950 leading-none">
                  {selectedStore ? 'Choose Ride' : 'Choose Location'}
                </h1>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="px-3 py-1 rounded-full bg-emerald-600 text-[10px] font-bold text-white shadow-sm uppercase tracking-wider">
                {selectedStore ? availableCountLabel : `${stores.length} Center${stores.length === 1 ? '' : 's'}`}
              </span>
            </div>
          </div>

          {selectedStore && (
            <div className="relative mb-5">
              <div className="flex gap-1.5 bg-slate-100/60 p-1.5 rounded-[20px] border border-slate-200/40 shadow-inner">
                {DURATION_TABS.map((tab) => {
                  const isActive = selectedDuration === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setSelectedDuration(tab)}
                      className="relative flex-1 py-2.5 rounded-[14px] text-[11px] font-[800] uppercase tracking-wider transition-all duration-300 outline-none"
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeTab"
                          className="absolute inset-0 bg-white rounded-[14px] shadow-[0_4px_12px_rgba(15,23,42,0.08)] border border-slate-100"
                          transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
                        />
                      )}
                      <span className={`relative z-10 transition-colors duration-300 ${isActive ? 'text-emerald-900' : 'text-slate-400'}`}>
                        {tab}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="relative">
            <div className="flex gap-1.5 bg-slate-100/60 p-1.5 rounded-[20px] border border-slate-200/40 shadow-inner">
              {[
                { id: 'bike', label: 'Bikes', icon: Bike },
                { id: 'car', label: 'Cars & SUVs', icon: Car },
              ].map((tab) => {
                const isActive = selectedType === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setSelectedType(tab.id);
                      setSelectedCategory(null);
                      setCurrentPage(1);
                    }}
                    className="relative flex-1 py-3 rounded-[14px] text-[11px] font-[800] uppercase tracking-wider transition-all duration-300 outline-none flex items-center justify-center gap-2"
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeCategoryTab"
                        className="absolute inset-0 bg-white rounded-[14px] shadow-[0_4px_12px_rgba(15,23,42,0.08)] border border-slate-100"
                        transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
                      />
                    )}
                    <Icon size={14} className={`relative z-10 transition-colors duration-300 ${isActive ? 'text-emerald-700' : 'text-slate-400'}`} />
                    <span className={`relative z-10 transition-colors duration-300 ${isActive ? 'text-emerald-950 font-black' : 'text-slate-400 font-bold'}`}>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selectedStore && visibleSuggestions.length > 0 && !searchQuery && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2 overflow-x-auto no-scrollbar pt-4 pb-1"
            >
              {visibleSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setSearchQuery(suggestion)}
                  className="shrink-0 rounded-full border border-emerald-100 bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-700 shadow-sm hover:border-emerald-300 hover:bg-emerald-50/50 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </motion.div>
          )}
        </div>
      </motion.header>

      <div className="px-5 pt-6 space-y-5">
        {selectedStore && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center justify-between rounded-[24px] border border-white/80 bg-white/60 backdrop-blur-md px-4 py-3.5 shadow-[0_8px_20px_rgba(15,23,42,0.04)]"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0 shadow-sm">
                <MapPin size={16} className="text-emerald-700" strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400/80 leading-none mb-1">Selected Store</p>
                <p className="text-[13px] font-black text-emerald-950 truncate leading-tight">{selectedStore.name}</p>
                {selectedStore.address && (
                  <p className="text-[10px] font-bold text-slate-500 truncate mt-0.5">{selectedStore.address}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => handleSelectStore(null)}
              className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-100/80 transition-colors shrink-0"
            >
              Change
            </button>
          </motion.div>
        )}

        {/* Premium Filter Hub */}
        {selectedStore && (
          <div className="rounded-[24px] border border-white/80 bg-white/40 backdrop-blur-xl p-4 shadow-[0_8px_32px_rgba(15,23,42,0.04)] space-y-4 relative overflow-hidden">
            <div className="absolute -top-12 -left-12 h-24 w-24 rounded-full bg-emerald-500/5 blur-2xl pointer-events-none" />
            <div className="absolute -bottom-12 -right-12 h-24 w-24 rounded-full bg-lime-500/5 blur-2xl pointer-events-none" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Filter size={14} className="text-emerald-700" strokeWidth={2.5} />
                </div>
                <span className="text-[12px] font-extrabold uppercase tracking-wider text-slate-700">Filter Fleet</span>
              </div>
              {selectedCategory && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setSelectedCategory(null);
                  }}
                  className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 hover:bg-emerald-100/70 px-2.5 py-1 rounded-full transition-colors border border-emerald-100"
                >
                  Reset Filters
                </motion.button>
              )}
            </div>

            <AnimatePresence>
              {availableCategories.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="pt-1.5 border-t border-slate-100/80">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400/80 mb-2 leading-none">
                      Select Category
                    </p>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                      {availableCategories.map((cat) => {
                        const isActive = selectedCategory === cat;
                        return (
                          <button
                            key={cat}
                            onClick={() => setSelectedCategory(isActive ? null : cat)}
                            className={`shrink-0 rounded-full border px-3.5 py-2 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 transition-all ${isActive
                                ? 'border-emerald-200 bg-emerald-50/80 text-emerald-800 shadow-[0_2px_8px_rgba(16,185,129,0.08)]'
                                : 'border-slate-200/70 bg-white/60 text-slate-500 hover:border-slate-300 hover:bg-white'
                              }`}
                          >
                            {isActive && (
                              <motion.span
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                className="inline-block"
                              >
                                <Check size={10} strokeWidth={3} className="text-emerald-600" />
                              </motion.span>
                            )}
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="relative pt-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-[800] uppercase tracking-[0.2em] text-slate-400">
              {selectedStore ? 'Available Near You' : 'Available Locations'}
            </p>
            {searchQuery && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-[10px] font-[800] uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md"
              >
                {selectedStore ? filteredCountLabel : `${filteredStores.length} result${filteredStores.length === 1 ? '' : 's'}`}
              </motion.span>
            )}
          </div>
          <h2 className="text-[20px] font-[900] tracking-tight text-emerald-950">
            {selectedStore ? 'Explore Fleet' : 'Explore Service Centers'}
          </h2>
        </div>
      </div>

      <div className="px-5 pt-4 pb-12 space-y-4">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <RentalSkeleton />
            </motion.div>
          ) : errorMessage ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="rounded-[24px] border border-rose-100 bg-rose-50/90 p-5 text-[13px] font-bold text-rose-500 shadow-[0_8px_24px_rgba(15,23,42,0.04)]"
            >
              {errorMessage}
            </motion.div>
          ) : !selectedStore ? (
            filteredStores.length === 0 ? (
              <motion.div
                key="empty-stores"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="rounded-[24px] border border-white/80 bg-white/90 p-6 text-center shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[16px] bg-slate-100 text-slate-400">
                  <MapPin size={22} />
                </div>
                <p className="mt-4 text-[15px] font-black text-emerald-950">No service centers found</p>
                <p className="mt-1 text-[12px] font-bold text-slate-400">Try another hub or city name.</p>
              </motion.div>
            ) : (
              filteredStores.map((store, idx) => (
                <motion.div
                  key={store.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.38, delay: idx * 0.05, ease: 'easeOut' }}
                  onClick={() => handleSelectStore(store)}
                  className="rounded-[24px] border border-white/80 bg-white/90 shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden cursor-pointer hover:border-emerald-300 transition-all p-4.5 flex items-center justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-100 bg-emerald-50 text-emerald-700">
                        {store.cityName || "Hub"}
                      </span>
                      {store.distanceLabel && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-100 bg-slate-50 text-slate-500">
                          {store.distanceLabel}
                        </span>
                      )}
                    </div>
                    <h3 className="text-[16px] font-extrabold text-emerald-950 leading-tight mt-2">{store.name}</h3>
                    <div className="flex items-start gap-1.5 mt-2">
                      <MapPin size={13} className="text-slate-400 shrink-0 mt-0.5" />
                      <p className="text-[12px] font-semibold text-slate-500 leading-normal line-clamp-2">{store.address}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 shrink-0">
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`https://www.google.com/maps/dir/?api=1&destination=${store.latitude},${store.longitude}`, '_blank');
                      }}
                      title="Navigate to store"
                      className="w-10 h-10 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 flex items-center justify-center text-emerald-700 transition-all"
                    >
                      <Navigation size={18} strokeWidth={2.5} />
                    </motion.button>
                    <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                      <ChevronRight size={18} strokeWidth={3} />
                    </div>
                  </div>
                </motion.div>
              ))
            )
          ) : filteredVehicles.length === 0 ? (
            <motion.div
              key="empty-search"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-[24px] border border-white/80 bg-white/90 p-6 text-center shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[16px] bg-slate-100 text-slate-400">
                <Search size={22} />
              </div>
              <p className="mt-4 text-[15px] font-black text-emerald-950">No rentals matched your search</p>
              <p className="mt-1 text-[12px] font-bold text-slate-400">Try another vehicle name, category, or amenity.</p>
            </motion.div>
          ) : (
            paginatedVehicles.map((v, idx) => (
              <motion.div
                key={v.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.38, delay: idx * 0.07, ease: 'easeOut' }}
                className="rounded-[24px] border border-white/80 bg-white/90 shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden"
              >
                <div
                  className="px-4 pt-3.5 pb-3 flex items-center justify-between"
                  style={{ background: `linear-gradient(135deg, ${v.gradientFrom} 0%, ${v.gradientTo} 100%)` }}
                >
                  <div className="flex-1 min-w-0 pr-2 space-y-1">
                    <span className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded-full border ${v.tagBg} ${v.tagColor}`}>
                      {v.tag}
                    </span>
                    <h3 className="text-[16px] font-extrabold text-emerald-950 leading-tight tracking-tight">{v.name}</h3>
                    {v.shortDescription ? (
                      <p className="text-[11px] font-medium text-slate-500/80">{v.shortDescription}</p>
                    ) : null}
                    <div className="flex items-center gap-1">
                      <Star size={10} className="text-yellow-500 fill-yellow-400" />
                      <span className="text-[11px] font-bold text-slate-700">{v.rating}</span>
                      <span className="text-[10px] font-medium text-slate-400">· {v.kmLimit[selectedDuration]} limit</span>
                    </div>
                  </div>
                  {v.image ? (
                    <img src={v.image} alt={v.name} className="h-20 w-24 object-contain drop-shadow-lg shrink-0 -mt-2 -mb-2" />
                  ) : (
                    <div className="flex h-20 w-24 items-center justify-center rounded-[20px] bg-white/60 text-slate-300 shadow-sm shrink-0">
                      <Car size={28} />
                    </div>
                  )}
                </div>

                <div className="px-4 pb-4 pt-3 space-y-2.5 border-t border-slate-50">
                  <div className="flex flex-wrap gap-1">
                    {v.features.map((feature) => (
                      <span key={feature} className="text-[9px] font-bold bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full border border-slate-100">
                        {feature}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Fuel size={11} className="text-slate-300 shrink-0" />
                    <span className="text-[11px] font-bold text-slate-400">{v.fuel}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.15em] block">Price</span>
                      <div className="flex items-baseline gap-0.5">
                        <span className="text-[24px] font-extrabold text-emerald-950 tracking-tighter leading-none">₹{v.prices[selectedDuration]}</span>
                        <span className="text-[11px] font-bold text-slate-400/80 ml-0.5">{durationSuffix[selectedDuration]}</span>
                      </div>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={() => openVehicleDetail(v)}
                      className="bg-emerald-600 text-white px-4 py-2.5 rounded-[12px] text-[11px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-[0_6px_16px_rgba(16,185,129,0.22)] hover:bg-emerald-700 active:bg-emerald-800 transition-all"
                    >
                      Book Now <ChevronRight size={13} strokeWidth={3} className="opacity-60" />
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>

        {selectedStore && !loading && !errorMessage && filteredVehicles.length > RENTAL_PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-3 rounded-[20px] border border-white/80 bg-white/90 px-4 py-3.5 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
              className="rounded-[12px] border border-emerald-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700 disabled:opacity-40"
            >
              Previous
            </button>
            <div className="text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Page</p>
              <p className="mt-1 text-[13px] font-black text-emerald-950">{currentPage} / {totalPages}</p>
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
              className="rounded-[12px] border border-emerald-200 bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-emerald-700 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-3 rounded-[16px] border border-white/80 bg-white/90 px-4 py-3.5 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
          <div className="w-8 h-8 rounded-[10px] bg-emerald-50 flex items-center justify-center shrink-0">
            <Shield size={15} className="text-emerald-500" strokeWidth={2} />
          </div>
          <p className="text-[11px] font-bold text-slate-400 leading-relaxed">
            All rental vehicles shown here come from the admin catalog. Valid driving license and verification are required before pickup.
          </p>
        </div>
      </div>
    </div>
  );
};

export default BikeRentalHome;
