import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Calendar, 
  Clock, 
  User, 
  Car, 
  Plus, 
  Minus, 
  Users, 
  Luggage as LuggageIcon, 
  Briefcase, 
  MapPin, 
  Globe, 
  Heart,
  ChevronRight,
  Loader
} from 'lucide-react';
import api from '../../../shared/api/axiosInstance';

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

const RideBookingForm = () => {
  const navigate = useNavigate();
  
  // Trip Type State
  const [tripType, setTripType] = useState('ONE_WAY'); // ONE_WAY | ROUND_TRIP
  
  // Location States
  const [pickup, setPickup] = useState('');
  const [pickupCoords, setPickupCoords] = useState(null);
  const [drop, setDrop] = useState('');
  const [dropCoords, setDropCoords] = useState(null);
  
  // Suggestions UI
  const [activeInput, setActiveInput] = useState(null); // 'pickup' | 'drop'
  
  // Trip Date & Time States
  const [dateType, setDateType] = useState('today'); // today | tomorrow | custom
  const [customDate, setCustomDate] = useState('');
  const [pickupTime, setPickupTime] = useState('');
  
  // Vehicles & Preferences lists (fetched from backend)
  const [vehicles, setVehicles] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [preferencesList, setPreferencesList] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Selection States
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [preferredLanguages, setPreferredLanguages] = useState([]);
  const [driverPreferences, setDriverPreferences] = useState([]);
  
  // Ride Options States
  const [passengers, setPassengers] = useState(1);
  const [luggage, setLuggage] = useState(false);
  const [pooling, setPooling] = useState(false);

  // Suggestions search logic
  const pickupSuggestions = useMemo(() => {
    if (!pickup.trim()) return Object.keys(LOCATION_COORDS);
    return Object.keys(LOCATION_COORDS).filter(name => 
      name.toLowerCase().includes(pickup.toLowerCase())
    );
  }, [pickup]);

  const dropSuggestions = useMemo(() => {
    if (!drop.trim()) return Object.keys(LOCATION_COORDS);
    return Object.keys(LOCATION_COORDS).filter(name => 
      name.toLowerCase().includes(drop.toLowerCase())
    );
  }, [drop]);

  useEffect(() => {
    const fetchFormConfiguration = async () => {
      try {
        setLoading(true);
        // Fetch active vehicle types
        const vehicleResponse = await api.get('/vehicle-types/active');
        const vehicleData = vehicleResponse?.data || [];
        setVehicles(vehicleData);
        if (vehicleData.length > 0) {
          setSelectedVehicle(vehicleData[0]);
        }

        // Fetch languages and preferences from backend DB
        const prefResponse = await api.get('/preferences');
        setLanguages(prefResponse?.data?.languages || ['English', 'Hindi', 'Punjabi', 'Gujarati']);
        setPreferencesList(prefResponse?.data?.driverPreferences || []);
      } catch (error) {
        console.error('Failed to load booking form config:', error);
      } finally {
        setLoading(false);
      }
    };
    
    // Set default pickup date and time
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];
    const formattedTime = today.toTimeString().slice(0, 5);
    setCustomDate(formattedDate);
    setPickupTime(formattedTime);
    
    fetchFormConfiguration();
  }, []);

  const handleSelectLanguage = (lang) => {
    setPreferredLanguages(prev => 
      prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
    );
  };

  const handleSelectPreference = (prefKey) => {
    setDriverPreferences(prev => 
      prev.includes(prefKey) ? prev.filter(p => p !== prefKey) : [...prev, prefKey]
    );
  };

  const calculateEstimatedDistance = () => {
    if (!pickupCoords || !dropCoords) return 5000;
    const [lon1, lat1] = pickupCoords;
    const [lon2, lat2] = dropCoords;
    const R = 6371e3; // meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c); // distance in meters
  };

  const handleBook = () => {
    if (!pickup || !pickupCoords) {
      alert('Please select a pickup location');
      return;
    }
    if (!drop || !dropCoords) {
      alert('Please select a destination');
      return;
    }
    if (!selectedVehicle) {
      alert('Please choose a vehicle type');
      return;
    }

    const resolvedDate = dateType === 'today' 
      ? new Date().toISOString().split('T')[0] 
      : dateType === 'tomorrow' 
        ? new Date(Date.now() + 86400000).toISOString().split('T')[0]
        : customDate;

    const distanceMeters = calculateEstimatedDistance();
    const durationMinutes = Math.round((distanceMeters / 1000) * 2.5); // Approx 2.5 min/km
    
    // Rs 50 base fare + Rs 15 per KM
    const distanceKm = distanceMeters / 1000;
    const calculatedFare = Math.max(50, Math.round(50 + distanceKm * 15));

    const bookingPayload = {
      pickup: pickupCoords,
      drop: dropCoords,
      pickupCoords,
      dropCoords,
      pickup: pickup,
      drop: drop,
      fare: calculatedFare,
      baseFare: calculatedFare,
      estimatedDistanceMeters: distanceMeters,
      estimatedDurationMinutes: durationMinutes,
      vehicleTypeId: selectedVehicle._id,
      vehicle: selectedVehicle,
      paymentMethod: 'Cash',
      serviceType: 'ride',
      transport_type: 'taxi',
      bookingMode: 'normal',
      bookingPreferences: {
        tripType,
        pickupDate: resolvedDate,
        pickupTime,
        passengers,
        luggage,
        pooling,
        preferredLanguages,
        driverPreferences
      }
    };

    // Navigate directly to standard searching screen with payload state
    const routePrefix = window.location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
    navigate(`${routePrefix}/ride/searching`, { state: bookingPayload });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-10">
        <Loader className="animate-spin text-[#6FBF7A]" size={24} />
      </div>
    );
  }

  return (
    <div className="px-5 py-5 space-y-5 bg-white rounded-[24px] border border-[#E8F3E9] shadow-[0_4px_24px_rgba(47,95,67,0.06)]">
      {/* 1. Trip Type Toggle */}
      <div className="flex bg-[#F5FBF6] p-1 rounded-full border border-[#E8F3E9]">
        <button
          type="button"
          onClick={() => setTripType('ONE_WAY')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-xs font-semibold transition-all ${
            tripType === 'ONE_WAY' 
              ? 'bg-[#2F5F43] text-white shadow-sm' 
              : 'text-[#2F5F43]/60 hover:text-[#2F5F43]'
          }`}
        >
          <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${tripType === 'ONE_WAY' ? 'border-white' : 'border-[#2F5F43]/40'}`}>
            {tripType === 'ONE_WAY' && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
          </span>
          One Way
        </button>
        <button
          type="button"
          onClick={() => setTripType('ROUND_TRIP')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full text-xs font-semibold transition-all ${
            tripType === 'ROUND_TRIP' 
              ? 'bg-[#2F5F43] text-white shadow-sm' 
              : 'text-[#2F5F43]/60 hover:text-[#2F5F43]'
          }`}
        >
          <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${tripType === 'ROUND_TRIP' ? 'border-white' : 'border-[#2F5F43]/40'}`}>
            {tripType === 'ROUND_TRIP' && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
          </span>
          Round Trip
        </button>
      </div>

      {/* 2. From & To Fields */}
      <div className="relative flex items-center justify-between gap-2 py-2 border-b border-[#E8F3E9]">
        <div className="flex-1 min-w-0">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">FROM</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <MapPin size={15} className="text-[#6FBF7A] shrink-0" />
            <input
              type="text"
              value={pickup}
              placeholder="Indore"
              onChange={(e) => {
                setPickup(e.target.value);
                setActiveInput('pickup');
              }}
              onFocus={() => setActiveInput('pickup')}
              className="w-full bg-transparent border-none text-[13px] font-semibold text-slate-700 outline-none"
            />
          </div>
          {activeInput === 'pickup' && (
            <div className="absolute left-0 right-0 top-[52px] bg-white border border-[#E8F3E9] rounded-2xl shadow-[0_8px_32px_rgba(47,95,67,0.12)] z-50 max-h-52 overflow-y-auto mt-1">
              {pickupSuggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setPickup(name);
                    setPickupCoords(LOCATION_COORDS[name]);
                    setActiveInput(null);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-[#F5FBF6] text-xs font-semibold text-slate-700 border-b border-[#F0F9F1] last:border-none"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button 
          type="button" 
          onClick={() => {
            const temp = pickup;
            setPickup(drop);
            setDrop(temp);
            const tempCoords = pickupCoords;
            setPickupCoords(dropCoords);
            setDropCoords(tempCoords);
          }}
          className="w-8 h-8 rounded-full border border-[#E8F3E9] bg-white flex items-center justify-center shadow-sm shrink-0 active:scale-95 transition-transform"
        >
          <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M16 3L21 8L16 13" />
            <path d="M21 8H3" />
            <path d="M8 21L3 16L8 11" />
            <path d="M3 16H21" />
          </svg>
        </button>

        <div className="flex-1 min-w-0 text-right">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">TO</span>
          <div className="flex items-center justify-end gap-1.5 mt-0.5">
            <input
              type="text"
              value={drop}
              placeholder="Enter city"
              onChange={(e) => {
                setDrop(e.target.value);
                setActiveInput('drop');
              }}
              onFocus={() => setActiveInput('drop')}
              className="w-full bg-transparent border-none text-[13px] font-semibold text-slate-700 text-right outline-none"
            />
            <MapPin size={15} className="text-slate-400 shrink-0" />
          </div>
          {activeInput === 'drop' && (
            <div className="absolute left-0 right-0 top-[52px] bg-white border border-[#E8F3E9] rounded-2xl shadow-[0_8px_32px_rgba(47,95,67,0.12)] z-50 max-h-52 overflow-y-auto mt-1">
              {dropSuggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setDrop(name);
                    setDropCoords(LOCATION_COORDS[name]);
                    setActiveInput(null);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-[#F5FBF6] text-xs font-semibold text-slate-700 border-b border-[#F0F9F1] last:border-none"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Date & Time Selection (Triggered directly by clicking the Date/Time info) */}
      <div className="flex items-center justify-between py-3 border-b border-[#E8F3E9] bg-white">
        <div className="relative cursor-pointer flex-1 min-w-0">
          <input
            type="date"
            value={customDate}
            onChange={(e) => {
              setCustomDate(e.target.value);
              setDateType('custom');
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div className="hover:opacity-85 transition-opacity">
            <span className="text-[9px] font-extrabold text-[#2F5F43]/50 uppercase tracking-[0.2em] block leading-none mb-1">TRIP DATE</span>
            <span className="text-[13px] font-bold text-[#2F5F43] flex items-center gap-1.5 leading-none">
              {dateType === 'today' ? 'Today' : dateType === 'tomorrow' ? 'Tomorrow' : customDate ? new Date(customDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Select Date'}
              {pickupTime ? `, ${pickupTime}` : ''}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 z-20 relative">
          <button
            type="button"
            onClick={() => setDateType('today')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
              dateType === 'today' 
                ? 'bg-[#2F5F43] border-[#2F5F43] text-white shadow-sm' 
                : 'bg-white border-[#E8F3E9] text-slate-500 hover:text-[#2F5F43]'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setDateType('tomorrow')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
              dateType === 'tomorrow' 
                ? 'bg-[#2F5F43] border-[#2F5F43] text-white shadow-sm' 
                : 'bg-white border-[#E8F3E9] text-slate-500 hover:text-[#2F5F43]'
            }`}
          >
            Tomorrow
          </button>
          <div className="relative flex items-center gap-1 bg-[#F5FBF6] border border-[#E8F3E9] px-2.5 py-1.5 rounded-full">
            <Clock size={12} className="text-[#6FBF7A]" />
            <input
              type="time"
              value={pickupTime}
              onChange={(e) => setPickupTime(e.target.value)}
              className="bg-transparent border-none text-[11px] font-semibold text-slate-700 outline-none w-[64px]"
            />
          </div>
        </div>
      </div>

      {/* 4. Filters */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 tracking-wider">
          <span>FILTERS</span>
          <span className="font-normal text-[10px] text-slate-300">(Optional)</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
          <svg className="w-4 h-4 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
          
          <div className="relative shrink-0">
            <select
              onChange={(e) => {
                if (e.target.value) handleSelectLanguage(e.target.value);
              }}
              className="appearance-none bg-white border border-[#E8F3E9] px-3.5 py-1.5 pr-7 rounded-full text-xs font-semibold text-slate-500 outline-none"
            >
              <option value="">Languages</option>
              {languages.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>

          <div className="relative shrink-0">
            <select
              onChange={(e) => {
                if (e.target.value) handleSelectPreference(e.target.value);
              }}
              className="appearance-none bg-white border border-[#E8F3E9] px-3.5 py-1.5 pr-7 rounded-full text-xs font-semibold text-slate-500 outline-none"
            >
              <option value="">Special Preferences</option>
              {preferencesList.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPooling(!pooling)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border shrink-0 transition-all ${
              pooling ? 'bg-[#EFF8F0] border-[#6FBF7A] text-[#2F5F43]' : 'bg-white border-[#E8F3E9] text-slate-500'
            }`}
          >
            Allow Pooling
          </button>
        </div>
      </div>

      {/* 5. Horizontal Cars List (Exactly one row, scrollable as requested) */}
      <div className="py-1">
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar py-1">
          {vehicles.map((v) => {
            const isSelected = selectedVehicle?._id === v._id;
            return (
              <button
                key={v._id}
                type="button"
                onClick={() => setSelectedVehicle(v)}
                className={`flex-shrink-0 w-24 p-2 rounded-2xl border text-center flex flex-col items-center justify-center transition-all ${
                  isSelected
                    ? 'border-[#2F5F43] bg-[#EFF8F0]/30 shadow-sm ring-1 ring-[#2F5F43]'
                    : 'border-slate-100 bg-white hover:border-[#E8F3E9]'
                }`}
              >
                <div className="h-10 w-full flex items-center justify-center overflow-hidden">
                  <img src={v.image} alt={v.name} className="h-full object-contain" />
                </div>
                <h4 className="text-[11.5px] font-bold text-slate-700 truncate w-full mt-1.5 leading-tight">{v.name}</h4>
                <p className="text-[9.5px] text-slate-400 font-semibold mt-0.5 leading-none">{v.capacity} seats</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 6. Explore Button (Matched styling of screenshot) */}
      <button
        type="button"
        onClick={handleBook}
        className="w-full bg-[#2F5F43] hover:bg-[#1a3d2a] text-white py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-[0_12px_24px_rgba(47,95,67,0.15)] active:scale-[0.98] transition-all"
      >
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.8">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>Explore</span>
      </button>

      {/* Verified banner */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-400">
        <span className="text-[#F2D34F]">⚡</span>
        <span>100% verified drivers</span>
      </div>
    </div>
  );
};

export default RideBookingForm;
