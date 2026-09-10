import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Search, Wallet } from 'lucide-react';
import { DEFAULT_LOCATION_LABEL, getSavedLocationLabel, LOCATION_UPDATED_EVENT } from '../services/locationStore';

const fallingCoins = [
  { id: 1, left: '24%', delay: 0 },
  { id: 2, left: '50%', delay: 0.65 },
  { id: 3, left: '72%', delay: 1.2 },
];

import { useSettings } from '../../../shared/context/SettingsContext';

const HeaderGreeting = () => {
  const navigate = useNavigate();
  const { settings, loading, hasBootstrapSettings } = useSettings();
  const appLogo = settings.general?.logo || settings.customization?.logo || settings.general?.favicon || '';
  const appName = settings.general?.app_name || 'App';
  const [locationLabel, setLocationLabel] = useState(getSavedLocationLabel);
  const showBrandingSkeleton = loading && !hasBootstrapSettings && !appLogo;

  useEffect(() => {
    const syncLocationLabel = () => {
      setLocationLabel(getSavedLocationLabel());
    };

    syncLocationLabel();
    window.addEventListener('storage', syncLocationLabel);
    window.addEventListener(LOCATION_UPDATED_EVENT, syncLocationLabel);

    return () => {
      window.removeEventListener('storage', syncLocationLabel);
      window.removeEventListener(LOCATION_UPDATED_EVENT, syncLocationLabel);
    };
  }, []);

  return (
    <div className="px-5 pt-3 space-y-4">
      {/* Search destination bar at the top */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05, ease: 'easeOut' }}
        className="space-y-2.5"
      >
        <motion.button
          type="button"
          whileTap={{ scale: 0.99 }}
          onClick={() => navigate('/ride/select-location')}
          className="flex w-full items-center gap-2.5 rounded-2xl border border-[#E8F3E9] bg-white px-4 py-3.5 text-left shadow-[0_4px_20px_rgba(47,95,67,0.06)] transition-shadow hover:shadow-[0_6px_24px_rgba(47,95,67,0.10)] hover:border-[#CFE8C9]"
        >
          <Search size={16} className="text-slate-400" strokeWidth={2.5} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-slate-400">
            Where are you going?
          </span>
          <span className="text-[9px] font-black uppercase tracking-[0.22em] text-white bg-[#2F5F43] px-2.5 py-1 rounded-full">Go</span>
        </motion.button>
      </motion.div>

      {/* Location and Wallet Row below */}
      <div className="flex items-center justify-between gap-3 bg-white/80 backdrop-blur-md rounded-2xl p-2 border border-[#E8F3E9]">
        <motion.button
          type="button"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.03, ease: 'easeOut' }}
          whileTap={{ scale: 0.99 }}
          onClick={() => navigate('/ride/select-location')}
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-transparent px-2 py-1 text-left transition-opacity active:opacity-80"
        >
          <MapPin size={16} className="text-[#6FBF7A] transition-colors group-hover:text-[#2F5F43] shrink-0" strokeWidth={2.5} />

          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-400">Location</p>
            <p className="truncate text-[11px] font-bold tracking-tight text-slate-900">{locationLabel}</p>
          </div>
        </motion.button>

        <button
          onClick={() => navigate('/wallet')}
          className="relative w-9 h-9 overflow-hidden rounded-full border border-white/80 bg-white/95 flex items-center justify-center shadow-[0_6px_15px_rgba(15,23,42,0.06)] shrink-0 active:scale-95 transition-transform"
        >
          <motion.div
            className="absolute inset-x-1.5 top-0.5 h-2 rounded-full bg-gradient-to-b from-amber-200/50 to-transparent"
            animate={{ opacity: [0.15, 0.35, 0.15] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />

          {fallingCoins.map((coin) => (
            <motion.span
              key={coin.id}
              aria-hidden="true"
              className="absolute top-0.5 block h-1 w-1 rounded-full bg-gradient-to-br from-amber-300 to-yellow-500"
              style={{ left: coin.left }}
              animate={{
                y: [0, 8, 12],
                opacity: [0, 1, 1, 0],
                scale: [0.85, 1, 0.92],
              }}
              transition={{
                duration: 1.8,
                delay: coin.delay,
                repeat: Infinity,
                repeatDelay: 0.8,
                ease: 'easeIn',
              }}
            />
          ))}

          <motion.div
            className="relative z-10"
            animate={{ y: [0, -1, 0], rotate: [0, -2, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Wallet size={16} className="text-gray-900" strokeWidth={2.5} />
          </motion.div>
        </button>
      </div>
    </div>
  );
};

export default HeaderGreeting;
