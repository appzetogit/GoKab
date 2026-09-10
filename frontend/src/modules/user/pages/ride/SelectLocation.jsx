import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MapPin, X, Plus, Minus, Check, Map as MapIcon, LoaderCircle, Navigation, AlertTriangle, ChevronRight } from 'lucide-react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { useAppGoogleMapsLoader, INDIA_CENTER, HAS_VALID_GOOGLE_MAPS_KEY } from '../../../admin/utils/googleMaps';
import api from '../../../../shared/api/axiosInstance';
import { getSavedLocation, getSavedLocationCoords, saveLocation } from '../../services/locationStore';

const LOCATION_COORDS = {
  'Pipaliyahana, Indore': [75.9048, 22.7039],
  'Vijay Nagar': [75.8937, 22.7533],
  'Vijay Nagar Square': [75.8947, 22.7518],
  'Vijayawada': [80.6480, 16.5062],
  'Vijay Nagar Police Station': [75.8934, 22.7506],
  'Rajwada': [75.8553, 22.7187],
  'Bhawarkua': [75.8586, 22.6926],
  'MG Road': [75.8721, 22.7196],
  'Palasia Square': [75.8863, 22.7242],
  'LIG Colony': [75.8904, 22.7322],
  'Scheme No 54': [75.8978, 22.7567],
  'Bhangadh': [75.8438, 22.7552],
  'AB Road': [75.8878, 22.7423],
  'Geeta Bhawan': [75.8834, 22.7208],
  'Sapna Sangeeta': [75.8587, 22.6984],
  'Mahalaxmi Nagar': [75.9114, 22.7676],
};

const getCoords = (title, fallback = [75.8577, 22.7196]) => LOCATION_COORDS[title] || fallback;
const DEFAULT_COORDS = [75.8577, 22.7196];
const sanitizeLocationInput = (value) => String(value || '').replace(/^\s+/g, '').replace(/\s{2,}/g, ' ');
const NEARBY_SUGGESTION_RADIUS_KM = 18;

const calculateDistanceKm = (fromCoords = [], toCoords = []) => {
  const [fromLng, fromLat] = fromCoords;
  const [toLng, toLat] = toCoords;

  if (![fromLng, fromLat, toLng, toLat].every((value) => Number.isFinite(Number(value)))) {
    return Number.POSITIVE_INFINITY;
  }

  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const startLat = toRadians(fromLat);
  const endLat = toRadians(toLat);
  const a =
    Math.sin(latDelta / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;

  return earthRadiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const unwrapResults = (response) => {
  const payload = response?.data?.data || response?.data || response;
  return payload?.results || payload?.zones || (Array.isArray(payload) ? payload : []);
};

const getZoneServiceLocationId = (zone) =>
  zone?.service_location_id?._id
  || zone?.service_location_id?.id
  || zone?.service_location_id
  || zone?.service_location?._id
  || zone?.service_location?.id
  || zone?.service_location
  || '';

const isZoneActive = (zone) => zone?.active !== false && Number(zone?.status ?? 1) !== 0;

const getZoneId = (zone) => zone?._id || zone?.id || '';

const getStoreZoneId = (store) =>
  store?.zone_id?._id
  || store?.zone_id?.id
  || store?.zone_id
  || '';

const toZonePoint = (point) => {
  if (Array.isArray(point) && point.length >= 2) {
    const [lng, lat] = point;
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return { lat: Number(lat), lng: Number(lng) };
    }
  }

  if (point && typeof point === 'object') {
    const lat = Number(point.lat ?? point.latitude);
    const lng = Number(point.lng ?? point.longitude ?? point.lon);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  return null;
};

const normalizeZonePath = (zone) => {
  const source = Array.isArray(zone?.coordinates?.[0]) && Array.isArray(zone?.coordinates?.[0]?.[0])
    ? zone.coordinates[0]
    : zone?.coordinates;

  if (!Array.isArray(source)) {
    return [];
  }

  return source.map(toZonePoint).filter(Boolean);
};

const getBoundsFromPaths = (paths) => {
  if (!paths.length) {
    return null;
  }

  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;

  paths.forEach((path) => {
    path.forEach((point) => {
      north = Math.max(north, point.lat);
      south = Math.min(south, point.lat);
      east = Math.max(east, point.lng);
      west = Math.min(west, point.lng);
    });
  });

  if (![north, south, east, west].every(Number.isFinite)) {
    return null;
  }

  return { north, south, east, west };
};

const isPointInPolygon = (point, polygon) => {
  if (!point || polygon.length < 3) {
    return false;
  }

  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersects = ((yi > point.lat) !== (yj > point.lat))
      && (point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const isPointInAnyZone = (point, zonePaths) => {
  if (!zonePaths.length) {
    return true;
  }

  return zonePaths.some((path) => isPointInPolygon(point, path));
};

const SelectLocation = () => {
  const location = useLocation();
  const routeState = location.state || {};
  const serviceLocationId = routeState.service_location_id || routeState.serviceLocationId || '';
  const requestedTransportType = String(routeState.transport_type || routeState.transportType || 'taxi').trim().toLowerCase() || 'taxi';
  const isDeliveryFlow = requestedTransportType === 'delivery' || String(routeState.serviceType || '').trim().toLowerCase() === 'parcel';
  const savedLocation = getSavedLocation();
  const savedPickupLabel = String(savedLocation?.address || '').trim();
  const savedPickupCoords = getSavedLocationCoords();
  const [pickup, setPickup] = useState(() => routeState.pickup || savedPickupLabel || 'Pipaliyahana, Indore');
  const [drop, setDrop] = useState(() => routeState.drop || '');
  const [pickupCoords, setPickupCoords] = useState(() => routeState.pickupCoords || savedPickupCoords || getCoords(routeState.pickup || savedPickupLabel || 'Pipaliyahana, Indore'));
  const [dropCoords, setDropCoords] = useState(() => routeState.dropCoords || null);
  const [stops, setStops] = useState(() => routeState.stops || []);          // array of stop strings
  const [activeInput, setActiveInput] = useState('drop'); // 'pickup' | 'drop' | stopIdx
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapCenter, setMapCenter] = useState(INDIA_CENTER);
  const [pickedAddress, setPickedAddress] = useState('Loading address...');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [zones, setZones] = useState([]);
  const [zonePaths, setZonePaths] = useState([]);
  const [serviceStores, setServiceStores] = useState([]);
  const [remoteResults, setRemoteResults] = useState([]);
  const [isSearchingLocations, setIsSearchingLocations] = useState(false);
  const mapInstanceRef = useRef(null);
  const lastCenterRef = useRef(INDIA_CENTER);
  const geocoderRef = useRef(null);
  const autocompleteServiceRef = useRef(null);
  const autocompleteSessionTokenRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const latestSearchRef = useRef(0);
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const navigate = useNavigate();
  const routePrefix = window.location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';

  // Comprehensive location presets for major hubs across India
  const allResults = [
    // INDORE & MP
    { title: 'Vijay Nagar', address: 'Vijay Nagar, Indore, Madhya Pradesh' },
    { title: 'Vijay Nagar Square', address: 'Vijay Nagar Square, Bhagyashree Colony, Indore' },
    { title: 'Indore Railway Station', address: 'Indore Junction Railway Station, MP' },
    { title: 'Devi Ahilyabai Holkar Airport', address: 'Indore Airport, MP' },
    { title: 'Rajwada Palace', address: 'Rajwada, Old Palasia, Indore, MP' },
    { title: 'Bhawarkua Square', address: 'Bhawarkua, Indore, Madhya Pradesh' },
    { title: 'Palasia Square', address: 'Palasia Square, AB Road, Indore' },
    { title: 'LIG Colony', address: 'LIG Colony, Indore, Madhya Pradesh' },
    { title: 'Scheme No 54', address: 'Scheme No 54, Vijay Nagar, Indore' },
    { title: 'Geeta Bhawan', address: 'Geeta Bhawan Square, Indore, MP' },
    { title: 'Mahalaxmi Nagar', address: 'Mahalaxmi Nagar, Indore, Madhya Pradesh' },

    // MUMBAI & MAHARASHTRA
    { title: 'Chhatrapati Shivaji Maharaj Airport T2', address: 'Vile Parle East, Mumbai, Maharashtra' },
    { title: 'Bandra Kurla Complex (BKC)', address: 'Bandra East, Mumbai, Maharashtra' },
    { title: 'Bandra Station', address: 'Bandra West, Mumbai, Maharashtra' },
    { title: 'CSMT Station', address: 'Fort, South Mumbai, Maharashtra' },
    { title: 'Andheri Lokhandwala', address: 'Andheri West, Mumbai, Maharashtra' },
    { title: 'Pune Station', address: 'Pune Railway Station, Maharashtra' },
    { title: 'Viman Nagar', address: 'Viman Nagar, Pune, Maharashtra' },

    // DELHI NCR
    { title: 'Indira Gandhi International Airport (T3)', address: 'New Delhi, Delhi' },
    { title: 'Connaught Place (CP)', address: 'Inner Circle, New Delhi' },
    { title: 'Cyber City', address: 'DLF Phase 2, Gurugram, Haryana' },
    { title: 'Sector 62 Noida', address: 'Noida, Uttar Pradesh' },
    { title: 'New Delhi Railway Station', address: 'Paharganj, New Delhi' },

    // BENGALURU & TELANGANA
    { title: 'Kempegowda International Airport', address: 'Devanahalli, Bengaluru, Karnataka' },
    { title: 'Indiranagar 100ft Road', address: 'Indiranagar, Bengaluru, Karnataka' },
    { title: 'Koramangala 5th Block', address: 'Koramangala, Bengaluru, Karnataka' },
    { title: 'Whitefield ITPB', address: 'Whitefield, Bengaluru, Karnataka' },
    { title: 'HITECH City', address: 'Madhapur, Hyderabad, Telangana' },
    { title: 'Rajiv Gandhi International Airport', address: 'Shamshabad, Hyderabad, Telangana' },
  ];

  const zoneBounds = useMemo(() => getBoundsFromPaths(zonePaths), [zonePaths]);

  useEffect(() => {
    let active = true;

    const loadZoneData = async () => {
      if (!serviceLocationId) {
        setZones([]);
        setZonePaths([]);
        setServiceStores([]);
        return;
      }

      try {
        const [zonesResponse, storesResponse] = await Promise.all([
          api.get('/admin/zones'),
          api.get('/users/service-stores'),
        ]);
        if (!active) {
          return;
        }

        const matchingZones = unwrapResults(zonesResponse)
          .filter((zone) => isZoneActive(zone) && String(getZoneServiceLocationId(zone)) === String(serviceLocationId));
        const matchingPaths = matchingZones
          .map(normalizeZonePath)
          .filter((path) => path.length >= 3);
        const matchingStores = unwrapResults(storesResponse).filter((store) => {
          if (store?.active === false || String(store?.status || '').toLowerCase() === 'inactive') {
            return false;
          }

          return String(store?.service_location_id) === String(serviceLocationId);
        });

        setZones(matchingZones);
        setZonePaths(matchingPaths);
        setServiceStores(matchingStores);
      } catch {
        if (active) {
          setZones([]);
          setZonePaths([]);
          setServiceStores([]);
        }
      }
    };

    loadZoneData();

    return () => {
      active = false;
    };
  }, [serviceLocationId]);

  useEffect(() => {
    if (!isLoaded || !window.google?.maps?.places?.AutocompleteService) {
      return;
    }

    autocompleteServiceRef.current = autocompleteServiceRef.current || new window.google.maps.places.AutocompleteService();
    autocompleteSessionTokenRef.current = autocompleteSessionTokenRef.current
      || new window.google.maps.places.AutocompleteSessionToken();
  }, [isLoaded]);

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

  const resolveCoords = async (label, fallback = DEFAULT_COORDS) => {
    if (!label || !String(label).trim()) {
      return fallback;
    }

    const knownCoords = LOCATION_COORDS[label];
    if (knownCoords) {
      return knownCoords;
    }

    if (!window.google?.maps?.Geocoder) {
      return fallback;
    }

    const geocoder = getGeocoder();
    if (!geocoder) {
      return fallback;
    }

    return new Promise((resolve) => {
      geocoder.geocode({ address: String(label).trim() }, (results, status) => {
        if (status === 'OK' && results?.[0]?.geometry?.location) {
          const location = results[0].geometry.location;
          resolve([location.lng(), location.lat()]);
          return;
        }

        resolve(fallback);
      });
    });
  };

  const resolvePlaceSelection = async (result) => {
    if (Array.isArray(result?.coords) && result.coords.length === 2) {
      return {
        title: result.title,
        address: result.address || result.title,
        coords: result.coords,
      };
    }

    const geocoder = getGeocoder();

    if (result?.placeId && geocoder) {
      return new Promise((resolve) => {
        geocoder.geocode({ placeId: result.placeId }, (results, geocodeStatus) => {
          const geocodedPlace = results?.[0];
          const geocodedLocation = geocodedPlace?.geometry?.location;

          if (geocodeStatus === 'OK' && geocodedLocation) {
            resolve({
              title: result.title || geocodedPlace.formatted_address,
              address: geocodedPlace.formatted_address || result.address || result.title || '',
              coords: [geocodedLocation.lng(), geocodedLocation.lat()],
            });
            return;
          }

          resolve({
            title: result?.title || '',
            address: result?.address || result?.title || '',
            coords: DEFAULT_COORDS,
          });
        });
      });
    }

    if (!geocoder) {
      return {
        title: result?.title || '',
        address: result?.address || result?.title || '',
        coords: await resolveCoords(result?.address || result?.title || ''),
      };
    }

    const coords = await resolveCoords(result?.address || result?.title || '');
    return {
      title: result?.title || '',
      address: result?.address || result?.title || '',
      coords,
    };
  };

  const validateZoneSelection = (coords) => {
    if (!Array.isArray(coords) || coords.length !== 2) {
      return false;
    }

    const [lng, lat] = coords;
    const point = { lat: Number(lat), lng: Number(lng) };

    return isPointInAnyZone(point, zonePaths);
  };

  const getQuery = () => {
    if (activeInput === 'pickup') return pickup;
    if (activeInput === 'drop') return drop;
    if (typeof activeInput === 'number') return stops[activeInput] || '';
    return '';
  };

  const query = getQuery();
  const currentZone = useMemo(() => {
    if (!Array.isArray(pickupCoords) || pickupCoords.length !== 2 || !zones.length) {
      return null;
    }

    const [lng, lat] = pickupCoords;
    const point = { lat: Number(lat), lng: Number(lng) };

    return zones.find((zone) => {
      const zonePath = normalizeZonePath(zone);
      return zonePath.length >= 3 && isPointInPolygon(point, zonePath);
    }) || null;
  }, [pickupCoords, zones]);

  const popularSuggestions = useMemo(() => {
    const currentZoneId = String(getZoneId(currentZone));
    const zoneStores = currentZoneId
      ? serviceStores.filter((store) => String(getStoreZoneId(store)) === currentZoneId)
      : [];

    const sortByPickupDistance = (items = []) => {
      if (!Array.isArray(pickupCoords) || pickupCoords.length !== 2) {
        return items;
      }

      return [...items]
        .map((item) => ({
          ...item,
          distanceKm: Array.isArray(item.coords)
            ? calculateDistanceKm(pickupCoords, item.coords)
            : Number.POSITIVE_INFINITY,
        }))
        .sort((first, second) => first.distanceKm - second.distanceKm);
    };

    if (zoneStores.length) {
      const storesWithCoords = zoneStores.map((store) => ({
        title: store.name || store.address || 'Service Store',
        address: store.address || currentZone?.name || 'Service Store',
        coords:
          Number.isFinite(Number(store.longitude)) && Number.isFinite(Number(store.latitude))
            ? [Number(store.longitude), Number(store.latitude)]
            : null,
      }));

      const nearbyStores = sortByPickupDistance(storesWithCoords)
        .filter((store) => !Number.isFinite(store.distanceKm) || store.distanceKm <= NEARBY_SUGGESTION_RADIUS_KM);

      return (nearbyStores.length ? nearbyStores : sortByPickupDistance(storesWithCoords)).slice(0, 6);
    }

    const localNearby = sortByPickupDistance(
      allResults.map((result) => ({
        ...result,
        coords: getCoords(result.title, null),
      })),
    );
    const withinRadius = localNearby.filter((result) => result.distanceKm <= NEARBY_SUGGESTION_RADIUS_KM);

    return (withinRadius.length ? withinRadius : localNearby).slice(0, 6);
  }, [allResults, currentZone, pickupCoords, serviceStores]);

  const localSearchResults = useMemo(
    () => {
      if (query.trim().length >= 1) {
        const matchingResults = allResults
          .filter(
            (result) =>
              result.title.toLowerCase().includes(query.toLowerCase())
              || result.address.toLowerCase().includes(query.toLowerCase()),
          )
          .map((result) => ({
            ...result,
            coords: getCoords(result.title, null),
          }))
          .map((result) => ({
            ...result,
            distanceKm: Array.isArray(result.coords)
              ? calculateDistanceKm(pickupCoords, result.coords)
              : Number.POSITIVE_INFINITY,
          }))
          .sort((first, second) => first.distanceKm - second.distanceKm);

        const nearbyMatches = matchingResults.filter((result) => result.distanceKm <= NEARBY_SUGGESTION_RADIUS_KM);
        return (nearbyMatches.length ? nearbyMatches : matchingResults).slice(0, 6);
      }

      return popularSuggestions;
    },
    [allResults, pickupCoords, popularSuggestions, query],
  );

  useEffect(() => {
    if (!query.trim() || query.trim().length < 1) {
      setRemoteResults([]);
      setIsSearchingLocations(false);
      return;
    }

    const pickupBiasKey = Array.isArray(pickupCoords) && pickupCoords.length === 2
      ? pickupCoords.map((coord) => Number(coord).toFixed(4)).join(',')
      : '';
    const normalizedQuery = `${query.trim().toLowerCase()}|${pickupBiasKey}`;
    const cached = searchCacheRef.current.get(normalizedQuery);
    if (cached) {
      setRemoteResults(cached);
      setIsSearchingLocations(false);
      return;
    }

    const requestId = latestSearchRef.current + 1;
    latestSearchRef.current = requestId;
    setIsSearchingLocations(true);

    const timeoutId = window.setTimeout(async () => {
      let finalResults = [];

      // Primary Attempt: Google Autocomplete Service (Safely wrapped against legacy API errors)
      if (HAS_VALID_GOOGLE_MAPS_KEY && autocompleteServiceRef.current) {
        try {
          const request = {
            input: query.trim(),
            componentRestrictions: { country: 'in' },
            sessionToken: getAutocompleteSessionToken(),
          };

          if (zoneBounds) {
            request.bounds = zoneBounds;
          }

          if (Array.isArray(pickupCoords) && pickupCoords.length === 2 && window.google?.maps?.Circle) {
            request.location = new window.google.maps.LatLng(Number(pickupCoords[1]), Number(pickupCoords[0]));
            request.radius = NEARBY_SUGGESTION_RADIUS_KM * 1000;
            request.locationBias = new window.google.maps.Circle({
              center: { lat: Number(pickupCoords[1]), lng: Number(pickupCoords[0]) },
              radius: NEARBY_SUGGESTION_RADIUS_KM * 1000,
            });
          }

          const autoResults = await new Promise((resolve) => {
            try {
              autocompleteServiceRef.current.getPlacePredictions(request, (predictions = [], status) => {
                if (status === 'OK' && Array.isArray(predictions) && predictions.length > 0) {
                  resolve(predictions.slice(0, 15).map((p) => ({
                    title: p.structured_formatting?.main_text || p.description,
                    address: p.structured_formatting?.secondary_text || p.description,
                    placeId: p.place_id,
                  })));
                } else {
                  resolve([]);
                }
              });
            } catch {
              resolve([]);
            }
          });

          if (Array.isArray(autoResults) && autoResults.length > 0) {
            finalResults = autoResults;
          }
        } catch {
          // Autocomplete API throws legacy exception
        }
      }

      // Secondary Attempt: Google Geocoder Fallback (Works on standard JS API key)
      if (finalResults.length === 0 && window.google?.maps?.Geocoder) {
        const geocoder = getGeocoder();
        if (geocoder) {
          try {
            const geoResults = await new Promise((resolve) => {
              try {
                geocoder.geocode({ address: `${query.trim()}, India` }, (results = [], status) => {
                  if (status === 'OK' && Array.isArray(results) && results.length > 0) {
                    resolve(results.slice(0, 10).map((res) => ({
                      title: res.address_components?.[0]?.long_name || res.formatted_address.split(',')[0],
                      address: res.formatted_address,
                      placeId: res.place_id,
                      coords: [res.geometry.location.lng(), res.geometry.location.lat()],
                    })));
                  } else {
                    resolve([]);
                  }
                });
              } catch {
                resolve([]);
              }
            });
            if (Array.isArray(geoResults) && geoResults.length > 0) {
              finalResults = geoResults;
            }
          } catch {
            // Geocoder exception catch
          }
        }
      }

      // Tertiary Attempt: Free Nominatim OpenStreetMap Real-Time Search API
      if (finalResults.length === 0) {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query.trim())}&countrycodes=in&limit=10`);
          if (res.ok) {
            const json = await res.json();
            if (Array.isArray(json) && json.length > 0) {
              finalResults = json.map((item) => ({
                title: item.display_name.split(',')[0] || item.display_name,
                address: item.display_name,
                coords: [Number(item.lon), Number(item.lat)],
              }));
            }
          }
        } catch {
          // Nominatim fetch failed
        }
      }

      if (latestSearchRef.current === requestId) {
        if (finalResults.length > 0) {
          searchCacheRef.current.set(normalizedQuery, finalResults);
        }
        setRemoteResults(finalResults);
        setIsSearchingLocations(false);
      }
    }, 200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pickupCoords, query, zoneBounds]);

  const searchResults = useMemo(() => {
    const merged = [...remoteResults, ...localSearchResults];
    const seen = new Set();

    return merged.filter((result) => {
      const key = `${String(result.title || '').trim().toLowerCase()}|${String(result.address || '').trim().toLowerCase()}`;
      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }, [localSearchResults, remoteResults]);

  const showMapToast = () => {
    // Reset map center to pickup or current location before opening
    const startCoord = Array.isArray(pickupCoords) && pickupCoords.length === 2
      ? { lat: pickupCoords[1], lng: pickupCoords[0] }
      : INDIA_CENTER;

    setMapCenter(startCoord);
    lastCenterRef.current = startCoord;
    setShowMapPicker(true);
  };

  const handleMapIdle = () => {
    if (!mapInstanceRef.current || !window.google) return;
    const center = mapInstanceRef.current.getCenter();
    const lat = center.lat();
    const lng = center.lng();

    // Only update and geocode if the center has actually changed significantly
    const dist = Math.abs(lat - lastCenterRef.current.lat) + Math.abs(lng - lastCenterRef.current.lng);
    if (dist < 0.00001) {
      setIsDragging(false);
      return;
    }

    lastCenterRef.current = { lat, lng };
    setIsDragging(false);

    // Reverse Geocode
    setIsGeocoding(true);
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      setIsGeocoding(false);
      if (status === 'OK' && results[0]) {
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
          mapInstanceRef.current.setZoom(17);
        }
      },
      () => {
        setIsLocating(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleConfirmNavigate = async (optionalDrop, optionalDropCoords = null) => {
    const finalDrop = optionalDrop || drop;
    const finalPickup = pickup || 'Pipaliyahana, Indore';

    if (!finalDrop || finalDrop.trim().length === 0) return;

    const resolvedPickupCoords = pickupCoords || await resolveCoords(finalPickup);
    const resolvedDropCoords = optionalDropCoords || dropCoords || await resolveCoords(finalDrop);

    if (!validateZoneSelection(resolvedPickupCoords) || !validateZoneSelection(resolvedDropCoords)) {
      window.alert('Please choose pickup and drop locations inside the active service zone.');
      return;
    }

    saveLocation({
      address: finalPickup,
      lat: resolvedPickupCoords[1],
      lon: resolvedPickupCoords[0],
    });

    navigate(`${routePrefix}/ride/select-vehicle`, {
      state: {
        pickup: finalPickup,
        drop: finalDrop,
        stops: stops.filter(s => s.trim().length > 0),
        pickupCoords: resolvedPickupCoords,
        dropCoords: resolvedDropCoords,
        service_location_id: serviceLocationId,
        transport_type: requestedTransportType,
        transportType: requestedTransportType,
        serviceType: isDeliveryFlow ? 'parcel' : 'ride',
      },
    });
  };

  const handleConfirmMapLocation = () => {
    const finalAddress = pickedAddress;
    const selectedCoords = [lastCenterRef.current.lng, lastCenterRef.current.lat];

    if (!validateZoneSelection(selectedCoords)) {
      window.alert('Please pin a location inside the active service zone.');
      return;
    }

    if (activeInput === 'pickup') {
      setPickup(finalAddress);
      setPickupCoords(selectedCoords);
      saveLocation({
        address: finalAddress,
        lat: selectedCoords[1],
        lon: selectedCoords[0],
      });
      setActiveInput('drop');
    } else if (activeInput === 'drop') {
      setDrop(finalAddress);
      setDropCoords(selectedCoords);
      // Auto-navigate if it's the destination
      handleConfirmNavigate(finalAddress, selectedCoords);
    } else if (typeof activeInput === 'number') {
      updateStop(activeInput, finalAddress);
    }
    setShowMapPicker(false);
  };

  const handleUseCurrentLocationResult = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const { latitude, longitude } = pos.coords;
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results, status) => {
          if (status === 'OK' && results[0]) {
            const addr = results[0].formatted_address;
            const coords = [longitude, latitude];
            if (activeInput === 'drop') {
              setDrop(addr);
              setDropCoords(coords);
              handleConfirmNavigate(addr, coords);
            } else {
              handleSelectResult(addr, coords);
            }
          } else {
            const raw = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            const coords = [longitude, latitude];
            if (activeInput === 'drop') {
              setDrop(raw);
              setDropCoords(coords);
              handleConfirmNavigate(raw, coords);
            } else {
              handleSelectResult(raw, coords);
            }
          }
        });
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true }
    );
  };


  // Add a new empty stop
  const addStop = () => {
    setStops(prev => [...prev, '']);
    setActiveInput(stops.length); // focus the new stop
  };

  // Remove a stop by index
  const removeStop = (idx) => {
    setStops(prev => prev.filter((_, i) => i !== idx));
    setActiveInput('drop');
  };

  // Update a stop value
  const updateStop = (idx, val) => {
    setStops(prev => prev.map((s, i) => i === idx ? val : s));
  };

  // When a suggestion is tapped
  const handleSelectResult = async (result, selectedCoords = null) => {
    const normalizedResult = typeof result === 'string'
      ? { title: result, address: result, coords: selectedCoords }
      : result;
    const resolvedSelection = await resolvePlaceSelection(normalizedResult);
    const finalTitle = resolvedSelection.title || resolvedSelection.address;
    const resolvedCoords = selectedCoords || resolvedSelection.coords;

    if (!validateZoneSelection(resolvedCoords)) {
      window.alert('That location is outside your active service zone. Please choose a point inside the zone.');
      return;
    }

    resetAutocompleteSessionToken();

    if (activeInput === 'pickup') {
      setPickup(finalTitle);
      setPickupCoords(resolvedCoords);
      saveLocation({
        address: finalTitle,
        lat: resolvedCoords[1],
        lon: resolvedCoords[0],
      });
      setActiveInput('drop');
    } else if (activeInput === 'drop') {
      setDrop(finalTitle);
      setDropCoords(resolvedCoords);
      handleConfirmNavigate(finalTitle, resolvedCoords);
    } else if (typeof activeInput === 'number') {
      updateStop(activeInput, finalTitle);
      // Move to next stop or drop
      if (activeInput < stops.length - 1) {
        setActiveInput(activeInput + 1);
      } else {
        setActiveInput('drop');
      }
    }
  };

  return (
    <div className="min-h-screen bg-white max-w-lg mx-auto font-sans relative overflow-hidden pb-6">
      <AnimatePresence>
        {showMapPicker && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            className="fixed inset-0 z-[100] bg-white flex flex-col max-w-lg mx-auto"
          >
            {/* Map Header */}
            <div className="absolute top-0 left-0 right-0 z-20 px-5 pt-10 pb-4 bg-gradient-to-b from-white via-white/80 to-transparent">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowMapPicker(false)}
                  className="w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center border border-slate-100 active:scale-95 transition-all"
                >
                  <ArrowLeft size={20} className="text-slate-900" strokeWidth={2.5} />
                </button>
                <div className="flex-1 bg-white rounded-2xl shadow-lg border border-slate-100 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Select Point</p>
                  <p className="text-[14px] font-semibold text-slate-900 truncate leading-tight">
                    {isGeocoding ? 'Locating...' : pickedAddress}
                  </p>
                </div>
              </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 relative bg-slate-200">
              {!HAS_VALID_GOOGLE_MAPS_KEY ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 px-6 text-center">
                  <div className="rounded-3xl bg-white px-8 py-10 shadow-xl border border-slate-100">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <X size={32} className="text-rose-400" />
                    </div>
                    <p className="text-[16px] font-bold text-slate-900">Config Error</p>
                    <p className="mt-2 text-[13px] font-medium text-slate-500">
                      Google Maps API Key is missing.
                    </p>
                  </div>
                </div>
              ) : loadError ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 px-6 text-center">
                  <div className="rounded-3xl bg-white px-8 py-10 shadow-xl border border-slate-100">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle size={32} className="text-rose-400" />
                    </div>
                    <p className="text-[16px] font-bold text-slate-900">Load Failed</p>
                    <p className="mt-2 text-[13px] font-medium text-slate-500">
                      Map could not be loaded. Please check your browser console or network.
                    </p>
                  </div>
                </div>
              ) : isLoaded ? (
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={mapCenter}
                  zoom={16}
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
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-slate-50">
                  <div className="relative">
                    <LoaderCircle size={44} className="animate-spin text-slate-300" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <MapIcon size={18} className="text-slate-200" />
                    </div>
                  </div>
                  <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-slate-400 animate-pulse">Initializing Maps</p>
                </div>
              )}

              {/* Central Pin - Uber Style */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[100%] pointer-events-none z-10">
                <div className="relative">
                  <motion.div
                    animate={isDragging || isGeocoding ? { y: -12 } : { y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="flex flex-col items-center"
                  >
                    <div className="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center shadow-2xl rotate-45 border-2 border-white">
                      <div className="-rotate-45">
                        <MapIcon size={18} className="text-white fill-white/20" />
                      </div>
                    </div>
                    {/* Stick */}
                    <div className="w-1 h-5 bg-slate-900 -mt-2 shadow-2xl" />
                  </motion.div>
                  {/* Shadow Dot */}
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-1 bg-black/30 rounded-full blur-sm" />
                </div>
              </div>

              {/* Current Location FAB */}
              <button
                onClick={handleUseCurrentLocation}
                disabled={isLocating}
                className="absolute bottom-6 right-5 w-12 h-12 bg-white rounded-2xl shadow-xl flex items-center justify-center border border-slate-100 active:scale-90 transition-all z-20"
              >
                {isLocating ? (
                  <LoaderCircle size={20} className="animate-spin text-slate-400" />
                ) : (
                  <Navigation size={20} className="text-slate-900 fill-slate-900/10" />
                )}
              </button>
            </div>

            {/* Confirm Actions */}
            <div className="px-5 pt-4 pb-10 bg-white border-t border-slate-50 space-y-4">
              <div className="flex items-center gap-3 py-1 px-1">
                <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                  <MapPin size={20} className="text-slate-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-[15px] font-bold text-slate-900 leading-none">Confirm Spot</h4>
                  <p className="text-[12px] font-medium text-slate-400 mt-1 line-clamp-1">{pickedAddress}</p>
                </div>
              </div>
              <button
                onClick={handleConfirmMapLocation}
                disabled={isGeocoding}
                className="w-full bg-slate-900 py-4 rounded-3xl text-white font-bold text-[15px] shadow-xl shadow-slate-200 flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <Check size={18} strokeWidth={3} />
                Confirm Location
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-30">
        <div className="bg-white/70 backdrop-blur-md border-b border-white/70 shadow-[0_10px_20px_rgba(15,23,42,0.05)]">
          <div className="px-5 py-4 flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 -ml-2 active:scale-95 transition-all rounded-full">
              <ArrowLeft size={22} className="text-slate-900" strokeWidth={3} />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{isDeliveryFlow ? 'Parcel' : 'Ride'}</p>
              <h1 className="mt-0.5 text-[20px] font-bold text-slate-900 tracking-tight leading-none truncate">{isDeliveryFlow ? 'Pickup & drop' : 'Where to?'}</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Input Card */}
      <div className="relative z-10 px-5 pt-4">
        <div className="bg-white/80 backdrop-blur-md rounded-[22px] p-4 shadow-[0_18px_44px_rgba(15,23,42,0.08)] border border-white/80">
          <div className="space-y-3">

            {/* Pickup Row */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <div className="w-5 h-5 rounded-full border-2 border-emerald-700 bg-white/70 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-700" />
                </div>
              </div>
              <div
                className={`flex-1 flex items-center bg-white/70 border border-white/80 rounded-xl px-3 py-2.5 transition-all ${activeInput === 'pickup' ? 'ring-2 ring-emerald-200' : ''}`}
                onClick={() => setActiveInput('pickup')}
              >
                <input
                  type="text"
                  value={pickup}
                  onChange={(e) => setPickup(sanitizeLocationInput(e.target.value))}
                  onFocus={() => setActiveInput('pickup')}
                  placeholder="Your pickup location"
                  className="w-full bg-transparent border-none text-[15px] font-medium text-slate-900 focus:outline-none placeholder:text-slate-300"
                />
                {pickup.length > 0 && (
                  <button onClick={() => setPickup('')} className="ml-2 shrink-0">
                    <X size={16} className="text-slate-300 hover:text-slate-600 transition-colors" />
                  </button>
                )}
              </div>
            </div>

            {/* Dotted connector */}
            <div className="ml-[9px] h-2 w-[1.5px] border-l-[1.5px] border-dotted border-slate-300/70" />

            {/* Dynamic Stops */}
            <AnimatePresence>
              {stops.map((stop, idx) => (
                <motion.div
                  key={`stop-${idx}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                      <div className="w-5 h-5 rounded-full border-2 border-indigo-500 bg-white/70 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      </div>
                    </div>
                    <div
                      className={`flex-1 flex items-center rounded-xl px-3 py-2.5 transition-all ${stop.trim().length > 0
                          ? 'bg-white/90 border border-indigo-200 shadow-[0_10px_24px_rgba(99,102,241,0.10)]'
                          : 'bg-indigo-50/70 border border-indigo-100/70'
                        } ${activeInput === idx ? 'ring-2 ring-indigo-200' : ''}`}
                      onClick={() => setActiveInput(idx)}
                    >
                      <input
                        type="text"
                        value={stop}
                        autoFocus={activeInput === idx}
                        placeholder={`Stop ${idx + 1} location...`}
                        onFocus={() => setActiveInput(idx)}
                        onChange={(e) => updateStop(idx, sanitizeLocationInput(e.target.value))}
                        className={`w-full bg-transparent border-none text-[15px] font-medium text-slate-900 focus:outline-none ${stop.trim().length > 0 ? 'placeholder:text-slate-300' : 'placeholder:text-indigo-300'
                          }`}
                      />
                      {stop.length > 0 && (
                        <button onClick={() => updateStop(idx, '')} className="ml-2 shrink-0">
                          <X size={16} className="text-indigo-300 hover:text-indigo-600 transition-colors" />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => removeStop(idx)}
                      className="w-7 h-7 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0 active:scale-95 transition-all"
                    >
                      <Minus size={14} className="text-rose-500" strokeWidth={3} />
                    </button>
                  </div>
                  {/* Connector after each stop */}
                  <div className="ml-[9px] mt-3 h-2 w-[1.5px] border-l-[1.5px] border-dotted border-slate-300/70" />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Drop Row */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <div className="w-5 h-5 rounded-full border-2 border-orange-600 bg-white/70 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-600" />
                </div>
              </div>
              <div
                className={`flex-1 flex items-center bg-white/70 border border-white/80 rounded-xl px-3 py-2.5 transition-all ${activeInput === 'drop' ? 'ring-2 ring-orange-200' : ''}`}
                onClick={() => setActiveInput('drop')}
              >
                <input
                  type="text"
                  value={drop}
                  autoFocus={activeInput === 'drop'}
                  placeholder="Enter drop location..."
                  onFocus={() => setActiveInput('drop')}
                  onChange={(e) => setDrop(sanitizeLocationInput(e.target.value))}
                  className="w-full bg-transparent border-none text-[15px] font-medium text-slate-900 focus:outline-none placeholder:text-slate-300"
                />
                {drop.length > 0 && (
                  <button onClick={() => setDrop('')} className="ml-2 shrink-0">
                    <X size={16} className="text-slate-300 hover:text-slate-600 transition-colors" />
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>



      {/* Stop count chips */}
      {stops.length > 0 && (
        <div className="relative z-10 px-5 mb-2">
          <div className="flex gap-2 flex-wrap">
            {stops.map((s, idx) => (
              <div key={idx} className="flex items-center gap-1.5 bg-white/75 backdrop-blur-md border border-white/80 rounded-full px-3 py-1 shadow-sm">
                <div className="w-2 h-2 rounded-full bg-indigo-400" />
                <span className="text-[12px] font-bold text-slate-700 truncate max-w-[110px]">
                  {s.trim() || `Stop ${idx + 1}`}
                </span>
                <button onClick={() => removeStop(idx)}>
                  <X size={11} className="text-slate-400 hover:text-slate-700" strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Results */}
      <div className="relative z-10 px-5 mb-4">
        <h2 className="text-[14px] font-bold text-slate-400 mb-3 ml-1 uppercase tracking-widest">
          {query.trim().length > 0 ? 'Search Results' : currentZone?.name ? `${currentZone.name} Suggestions` : 'Popular Locations'}
        </h2>

        {searchResults.length > 0 ? (
          <div className="bg-white/75 backdrop-blur-md rounded-2xl border border-white/80 overflow-hidden shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
            {/* Quick Go to Current Location */}
            <motion.button
              whileTap={{ scale: 0.99 }}
              onClick={handleUseCurrentLocationResult}
              className="w-full text-left flex items-center gap-3 px-4 py-3.5 border-b border-white/70 bg-emerald-50/30 hover:bg-emerald-50/50 transition-colors group"
            >
              <div className="w-10 h-10 rounded-2xl bg-white border border-emerald-100 shadow-sm flex items-center justify-center shrink-0">
                {isLocating ? (
                  <LoaderCircle size={18} className="animate-spin text-emerald-500" />
                ) : (
                  <Navigation size={18} className="text-emerald-500 fill-emerald-50" />
                )}
              </div>
              <div className="flex-1">
                <h4 className="text-[15px] font-bold text-slate-900 leading-tight group-hover:text-emerald-600 transition-colors">Use Current Location</h4>
                <p className="text-[12px] text-slate-400 font-medium mt-0.5">Perfect for accurate pickup</p>
              </div>
              <ChevronRight size={16} className="text-slate-300" />
            </motion.button>

            {searchResults.map((result, idx) => (
              <motion.button
                key={idx}
                type="button"
                whileTap={{ scale: 0.99 }}
                onClick={() => handleSelectResult(result)}
                className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-white/70 last:border-none hover:bg-white/60 transition-colors"
              >
                <div className="mt-0.5 w-10 h-10 rounded-2xl bg-white/70 border border-white/80 shadow-sm flex items-center justify-center shrink-0 text-slate-500">
                  <MapPin size={18} strokeWidth={2.6} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-[15px] font-semibold text-slate-900 leading-tight">{result.title}</h4>
                  <p className="text-[13px] text-slate-500 font-medium mt-1 line-clamp-1">{result.address}</p>
                </div>
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-3xl bg-white/80 border border-white/80 shadow-sm flex items-center justify-center mx-auto text-slate-400 text-[22px] font-bold">
              —
            </div>
            <p className="mt-3 text-[15px] font-semibold text-slate-600">
              No results for <span className="text-slate-900">"{query}"</span>
            </p>
            <p className="text-[13px] font-medium text-slate-400 mt-1">Try a different search term</p>
          </div>
        )}
        {query.trim().length >= 1 && (
          <div className="mt-3 px-1">
            <p className="text-[11px] font-bold text-slate-400">
              {isSearchingLocations
                ? 'Fetching live Google Places suggestions...'
                : 'Powered by real-time Google Places Autocomplete Engine.'}
            </p>
          </div>
        )}
        {!query.trim().length && currentZone?.name && (
          <div className="mt-3 px-1">
            <p className="text-[11px] font-bold text-slate-400">
              Popular suggestions are pulled from the admin-created stores in the <span className="text-slate-600">{currentZone.name}</span> zone.
            </p>
          </div>
        )}
      </div>

      {/* Persistent Confirm Button */}
      <AnimatePresence>
        {pickup && drop && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-6 left-5 right-5 z-40"
          >
            <button
              onClick={() => handleConfirmNavigate()}
              className="w-full bg-[#f8e001] py-4 rounded-3xl text-slate-900 font-bold text-[16px] shadow-[0_8px_30px_rgba(248,224,1,0.3)] flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            >
              {isDeliveryFlow ? 'See parcel vehicles' : 'Confirm & Proceed'}
              <ChevronRight size={18} strokeWidth={3} className="opacity-60" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SelectLocation;
