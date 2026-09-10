import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Calendar, Clock, Plane, ArrowLeft, Home, LoaderCircle, XCircle } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';

const AirportCabConfirm = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = useMemo(() => location.state || {}, [location.state]);
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState('saving');
  const [error, setError] = useState('');
  const requestStartedRef = useRef(false);
  const airportName = state.airport?.name || 'Airport';

  useEffect(() => {
    setMounted(true);

    if (!state.pickup) {
      navigate(`${routePrefix}/cab/airport`, { replace: true });
      return;
    }

    if (requestStartedRef.current) {
      return;
    }
    requestStartedRef.current = true;

    (async () => {
      try {
        await api.post('/rides', {
          pickup: state.pickupCoords,
          drop: state.dropCoords,
          pickupAddress: state.pickup,
          dropAddress: state.dropAddress,
          fare: Number(state.fare || 0),
          vehicleTypeId: state.vehicleTypeId || state.vehicle?.vehicleTypeId || '',
          vehicleTypeIds: state.vehicleTypeId || state.vehicle?.vehicleTypeId ? [state.vehicleTypeId || state.vehicle?.vehicleTypeId] : [],
          vehicleIconType: state.vehicleIconType || state.vehicle?.name || 'car',
          vehicleIconUrl: state.vehicleIconUrl || state.vehicle?.icon || '',
          paymentMethod: 'Cash',
          serviceType: 'ride',
          transport_type: 'taxi',
          bookingMode: 'normal',
          userMaxBidFare: Number(state.fare || 0),
          service_location_id: state.serviceLocationId || '',
          scheduledAt: state.scheduledAt || null,
        });
        setStatus('success');
      } catch (requestError) {
        setStatus('error');
        setError(requestError?.message || 'Could not book this airport cab.');
      }
    })();
  }, [navigate, routePrefix, state]);

  if (!state.pickup) return null;

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F0FDF4_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans pb-32 relative overflow-hidden">
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-emerald-100/60 blur-3xl pointer-events-none" />
      <div className="absolute top-40 left-[-60px] h-40 w-40 rounded-full bg-green-100/40 blur-3xl pointer-events-none" />

      <header className="bg-white/90 backdrop-blur-md px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-white/80 shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(routePrefix || '/')} className="w-9 h-9 rounded-[12px] border border-slate-100 bg-white flex items-center justify-center shadow-sm active:scale-95 transition-all">
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </button>
          <div className="flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-emerald-600">Booking Status</p>
            <h1 className="text-[19px] font-black tracking-tight text-slate-900">
              {status === 'success' ? 'Success' : status === 'error' ? 'Failed' : 'Booking...'}
            </h1>
          </div>
        </div>
      </header>

      <div className="px-5 pt-10 flex flex-col items-center">
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: mounted ? 1 : 0, opacity: mounted ? 1 : 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-[0_8px_24px_rgba(16,185,129,0.2)] ${
            status === 'error' ? 'bg-rose-50' : 'bg-emerald-50'
          }`}
        >
          {status === 'saving' && <LoaderCircle size={48} className="text-emerald-500 animate-spin" strokeWidth={2.5} />}
          {status === 'success' && <CheckCircle2 size={48} className="text-emerald-500" strokeWidth={2.5} />}
          {status === 'error' && <XCircle size={48} className="text-rose-500" strokeWidth={2.5} />}
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-8"
        >
          <h2 className="text-[24px] font-black tracking-tight text-slate-900 leading-tight">
            {status === 'saving' && 'Booking your cab...'}
            {status === 'success' && 'Booking Confirmed!'}
            {status === 'error' && 'Booking Failed'}
          </h2>
          <p className="text-[13px] font-bold text-slate-500 mt-2">
            {status === 'error' ? error : 'Your Airport Cab has been scheduled.'}
          </p>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="w-full bg-white/95 backdrop-blur-md rounded-[20px] shadow-[0_8px_30px_rgba(15,23,42,0.06)] border border-white/80 p-5 space-y-4 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-bl-full pointer-events-none" />

          <div className="flex justify-between items-center pb-4 border-b border-slate-100">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Service</p>
              <h3 className="text-[16px] font-black text-emerald-600 flex items-center gap-1.5">
                <Plane size={16} strokeWidth={2.5} /> Airport Drop
              </h3>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Vehicle</p>
              <h3 className="text-[16px] font-black text-slate-900">{state.vehicle?.name}</h3>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col items-center gap-1 mt-1 shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
              <div className="w-0.5 h-10 bg-slate-200" />
              <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Pickup Address</p>
                <p className="text-[14px] font-bold text-slate-900 leading-snug">{state.pickup}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Destination</p>
                <p className="text-[14px] font-bold text-slate-900 leading-snug tracking-tight">
                  {state.dropAddress || airportName}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-[14px] p-3 flex justify-between items-center mt-2 border border-slate-100/50">
            <div className="flex items-center gap-3">
              <Calendar size={18} className="text-slate-500" />
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</p>
                <p className="text-[13px] font-bold text-slate-900">{state.date}</p>
              </div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="flex items-center gap-3 pr-2">
              <Clock size={18} className="text-slate-500" />
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Time</p>
                <p className="text-[13px] font-bold text-slate-900">{state.time}</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-6 pt-3 bg-gradient-to-t from-[#EEF2F7] via-[#F3F4F6]/95 to-transparent pointer-events-none z-30"
      >
        <div className="pointer-events-auto bg-white rounded-[20px] border border-white shadow-[0_4px_14px_rgba(15,23,42,0.06)] px-5 py-4 flex items-center justify-between mb-3">
          <p className="text-[13px] font-black text-slate-700">Fixed Fare</p>
          <p className="text-[22px] font-black text-slate-900 tracking-tight">Rs {state.fare}</p>
        </div>
        <motion.button
          disabled={status === 'saving'}
          onClick={() => navigate(routePrefix || '/')}
          className="pointer-events-auto w-full bg-emerald-600 hover:bg-emerald-700 py-4 rounded-[18px] text-[15px] font-black text-white shadow-[0_8px_24px_rgba(16,185,129,0.2)] flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60"
        >
          <Home size={16} strokeWidth={2.5} /> Go to Home Dashboard
        </motion.button>
      </motion.div>
    </div>
  );
};

export default AirportCabConfirm;
