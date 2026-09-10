import React, { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../admin/utils/googleMaps';

const MAP_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: false,
  clickableIcons: false,
  streetViewControl: false,
  fullscreenControl: false,
  mapTypeControl: false,
  gestureHandling: 'greedy',
};

const INDORE_CENTER = { lat: 22.7187, lng: 75.8553 };

const HomeMapSection = () => {
  const [coords, setCoords] = useState(null);
  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        (err) => {
          console.warn('Geolocation failed or permission denied, using Indore default center:', err);
          setCoords(INDORE_CENTER);
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
      );
    } else {
      setCoords(INDORE_CENTER);
    }
  }, []);

  const defaultCenter = coords || INDORE_CENTER;

  const getMarkerIcon = () => {
    if (window.google?.maps?.SymbolPath) {
      return {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: '#6FBF7A',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      };
    }
    return undefined;
  };

  return (
    <div className="mx-5 mb-4">
      <div
        style={{
          width: '100%',
          height: '190px',
          borderRadius: '20px',
          boxShadow: '0 4px 20px -2px rgba(47, 95, 67, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.04)',
        }}
        className="overflow-hidden border border-[#E8F3E9] bg-white relative"
      >
        {!HAS_VALID_GOOGLE_MAPS_KEY ? (
          <div className="flex h-full w-full items-center justify-center p-4 text-center">
            <p className="text-[11px] font-semibold text-slate-500">Google Maps key missing</p>
          </div>
        ) : loadError ? (
          <div className="flex h-full w-full items-center justify-center p-4 text-center">
            <p className="text-[11px] font-semibold text-slate-500">Failed to load map</p>
          </div>
        ) : !isLoaded ? (
          <div className="flex h-full w-full items-center justify-center">
            <LoaderCircle size={20} className="animate-spin text-slate-400" />
          </div>
        ) : (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={defaultCenter}
            zoom={15}
            options={MAP_OPTIONS}
          >
            {coords && (
              <MarkerF 
                position={coords}
                icon={getMarkerIcon()}
              />
            )}
          </GoogleMap>
        )}
      </div>
    </div>
  );
};

export default HomeMapSection;
