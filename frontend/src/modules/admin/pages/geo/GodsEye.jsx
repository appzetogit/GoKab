import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { GoogleMap, MarkerF, InfoWindow } from '@react-google-maps/api';
import { 
  ChevronRight, 
  Map as MapIcon, 
  RefreshCw, 
  Filter,
  ArrowLeft,
  Activity,
  User,
  Car,
  Clock,
  Navigation,
  Search,
  Radio,
  Eye,
  Zap,
  Phone,
  ShieldCheck
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppGoogleMapsLoader, HAS_VALID_GOOGLE_MAPS_KEY } from '../../utils/googleMaps';
import { adminService } from '../../services/adminService';
import CarIcon from '@/assets/icons/car.png';
import BikeIcon from '@/assets/icons/bike.png';
import AutoIcon from '@/assets/icons/auto.png';

const INDIA_CENTER = { lat: 22.7196, lng: 75.8577 };
const MAP_CONTAINER_STYLE = { width: '100%', height: '520px' };

const mapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: true,
  fullscreenControl: true,
  styles: [
    { elementType: 'geometry', stylers: [{ color: '#f9fafb' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e5e7eb' }] }
  ]
};

const getMapIconForVehicle = (iconType = '') => {
  const value = String(iconType || '').trim().toLowerCase();
  let url = CarIcon;
  if (value.includes('bike')) url = BikeIcon;
  if (value.includes('auto')) url = AutoIcon;

  if (window.google && window.google.maps) {
    return {
      url,
      scaledSize: new window.google.maps.Size(28, 28),
      origin: new window.google.maps.Point(0, 0),
      anchor: new window.google.maps.Point(14, 14),
    };
  }
  return url;
};

const GodsEye = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [driverMode, setDriverMode] = useState('all'); // 'all', 'online', 'on_ride', 'offline'
  const [vehicleType, setVehicleType] = useState('all');
  const [refreshInterval, setRefreshInterval] = useState(15); // seconds
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [mapRef, setMapRef] = useState(null);

  // REAL DATA STATES
  const [markers, setMarkers] = useState([]);
  const [summary, setSummary] = useState({
    totalDrivers: 0,
    onlineDrivers: 0,
    onRideDrivers: 0,
    offlineDrivers: 0,
    pendingRequests: 0,
  });

  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  // FETCH REAL DYNAMIC FLEET DATA FROM BACKEND MONGODB DATABASE
  const fetchGodsEyeFleet = async () => {
    setLoading(true);
    try {
      const res = await adminService.getGodsEyeFleet({ driverMode, vehicleType });
      const data = res?.data || res || {};
      setMarkers(data.markers || []);
      setSummary(data.summary || { totalDrivers: 0, onlineDrivers: 0, onRideDrivers: 0, offlineDrivers: 0, pendingRequests: 0 });
    } catch (err) {
      console.error('Failed to fetch Gods Eye Fleet:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGodsEyeFleet();
  }, [driverMode, vehicleType]);

  // Auto Refresh Interval
  useEffect(() => {
    if (refreshInterval > 0) {
      const interval = setInterval(fetchGodsEyeFleet, refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [refreshInterval, driverMode, vehicleType]);

  const onMapLoad = useCallback((map) => {
    setMapRef(map);
  }, []);

  const inputClass = "w-full border border-gray-200 rounded-2xl px-4 py-3 text-xs font-bold text-gray-800 bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 outline-none transition";
  const labelClass = "block text-[11px] font-black uppercase tracking-wider text-gray-400 mb-1.5";

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 md:p-6 lg:p-8 font-sans space-y-6">
      
      {/* 1. Header Block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-8 rounded-3xl shadow-xl border border-slate-800">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-xs font-black uppercase tracking-wider mb-2">
            <Radio size={14} className="animate-pulse" /> Live Fleet Radar Tracking
          </div>
          <h1 className="text-3xl font-black">God's Eye Fleet View</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-xl font-medium">
            Real-time aerial GPS radar monitoring active drivers, online duty statuses, and pending passenger ride requests.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
             onClick={() => navigate('/admin/dashboard')}
             className="flex items-center gap-2 px-5 py-3 text-xs font-black text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-2xl transition shadow-md"
          >
            <ArrowLeft size={16} /> Back to Dashboard
          </button>
        </div>
      </div>

      {/* 2. FLEET RADAR FILTERS BAR */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
            <Filter size={16} /> Live Radar Filters & Auto Refresh Controls
          </h3>
          <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
            <span>Auto Refresh:</span>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="h-8 border border-gray-200 rounded-xl px-2 text-xs font-black text-indigo-600 bg-gray-50 outline-none"
            >
              <option value={5}>Every 5s</option>
              <option value={15}>Every 15s</option>
              <option value={30}>Every 30s</option>
              <option value={0}>Manual Only</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* DRIVER DUTY MODE FILTER */}
          <div>
            <label className={labelClass}>Duty Status Filter</label>
            <select
              value={driverMode}
              onChange={(e) => setDriverMode(e.target.value)}
              className={inputClass}
            >
              <option value="all">All Fleet (Online + On Ride + Offline)</option>
              <option value="online">Online Drivers (Available for Dispatch)</option>
              <option value="on_ride">On Ride Drivers (Active Trip)</option>
              <option value="offline">Offline Drivers</option>
            </select>
          </div>

          {/* VEHICLE TYPE FILTER */}
          <div>
            <label className={labelClass}>Vehicle Type Filter</label>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              className={inputClass}
            >
              <option value="all">All Vehicle Types (Cars + Bikes + Autos)</option>
              <option value="car">Cars & Taxis Only</option>
              <option value="bike">Bikes & Motorcycles Only</option>
              <option value="auto">Autos & Rickshaws Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. MAP CANVAS CARD */}
      <div className="bg-white rounded-3xl border border-gray-100 p-3 shadow-sm overflow-hidden relative">
        <div className="rounded-2xl overflow-hidden relative">
          {loadError ? (
            <div className="h-[520px] flex items-center justify-center bg-gray-50 text-rose-500 font-semibold">Map Error</div>
          ) : HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
            <GoogleMap
              mapContainerStyle={MAP_CONTAINER_STYLE}
              center={INDIA_CENTER}
              zoom={11}
              options={mapOptions}
              onLoad={onMapLoad}
            >
              {markers.map((marker) => (
                <MarkerF
                  key={marker.id}
                  position={marker.pos}
                  icon={marker.type === 'driver' ? getMapIconForVehicle(marker.vehicleType) : undefined}
                  onClick={() => setSelectedMarker(marker)}
                />
              ))}

              {selectedMarker && (
                <InfoWindow
                  position={selectedMarker.pos}
                  onCloseClick={() => setSelectedMarker(null)}
                >
                  <div className="p-3 max-w-xs font-sans space-y-2">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="font-black text-xs text-gray-900">{selectedMarker.name || selectedMarker.userName}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${selectedMarker.isOnRide ? 'bg-amber-100 text-amber-800' : selectedMarker.isOnline ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'}`}>
                        {selectedMarker.status}
                      </span>
                    </div>

                    {selectedMarker.type === 'driver' ? (
                      <div className="text-xs space-y-1 text-gray-600">
                        <div><strong>Phone:</strong> {selectedMarker.phone}</div>
                        <div><strong>Vehicle:</strong> {selectedMarker.vehicleType} ({selectedMarker.vehicleNumber})</div>
                        <div><strong>Account Type:</strong> <span className="uppercase font-bold text-indigo-600">{selectedMarker.accountType}</span></div>
                      </div>
                    ) : (
                      <div className="text-xs space-y-1 text-gray-600">
                        <div><strong>Passenger:</strong> {selectedMarker.userName} ({selectedMarker.userPhone})</div>
                        <div><strong>Pickup:</strong> {selectedMarker.pickupAddress}</div>
                        <div><strong>Ride Status:</strong> <span className="uppercase font-bold text-amber-600">{selectedMarker.status}</span></div>
                      </div>
                    )}
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          ) : (
            <div className="h-[520px] flex flex-col items-center justify-center bg-gray-50 gap-4">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm text-indigo-600"><MapIcon size={32} /></div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Map API Key Required</p>
            </div>
          )}

          {/* Refresh Badge */}
          <div className="absolute top-6 right-6 flex items-center gap-2">
            <button
              onClick={fetchGodsEyeFleet}
              className="p-3 bg-white hover:bg-gray-50 rounded-2xl shadow-xl flex items-center justify-center text-gray-600 hover:text-indigo-600 transition border border-gray-100"
              title="Refresh Fleet Radar"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* 4. REAL-TIME FLEET METRICS STRIP */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-3xl border border-gray-100 p-5 flex items-center gap-4 shadow-sm">
          <div className="w-11 h-11 bg-indigo-50 flex items-center justify-center rounded-2xl text-indigo-600">
            <Car size={22} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">Total Registered</p>
            <p className="text-lg font-black text-gray-900">{summary.totalDrivers}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 p-5 flex items-center gap-4 shadow-sm">
          <div className="w-11 h-11 bg-emerald-50 flex items-center justify-center rounded-2xl text-emerald-600">
            <Radio size={22} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">Online Available</p>
            <p className="text-lg font-black text-emerald-600">{summary.onlineDrivers}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 p-5 flex items-center gap-4 shadow-sm">
          <div className="w-11 h-11 bg-amber-50 flex items-center justify-center rounded-2xl text-amber-600">
            <Activity size={22} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">On Active Ride</p>
            <p className="text-lg font-black text-amber-600">{summary.onRideDrivers}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 p-5 flex items-center gap-4 shadow-sm">
          <div className="w-11 h-11 bg-slate-50 flex items-center justify-center rounded-2xl text-slate-500">
            <Clock size={22} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">Offline Fleet</p>
            <p className="text-lg font-black text-slate-700">{summary.offlineDrivers}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-gray-100 p-5 flex items-center gap-4 shadow-sm">
          <div className="w-11 h-11 bg-teal-50 flex items-center justify-center rounded-2xl text-teal-600">
            <Zap size={22} />
          </div>
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-0.5">Pending Ride Requests</p>
            <p className="text-lg font-black text-teal-600">{summary.pendingRequests}</p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default GodsEye;
