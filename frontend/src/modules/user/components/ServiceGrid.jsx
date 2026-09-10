import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useSettings, normalizeAssetUrl } from '../../../shared/context/SettingsContext';
import toast from 'react-hot-toast';

const ServiceTile = ({ icon, label, description, path, navState, accentClass, loading }) => {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex w-full min-h-[112px] items-center justify-center">
        <div className="flex h-[100px] w-[90%] animate-pulse flex-col items-center justify-center gap-2 rounded-[16px] border border-white/20 bg-white/65 px-1 py-1.5">
        <div className="h-[72px] w-[72px] rounded-[16px] bg-gray-200" />
          <div className="h-3 w-12 rounded-full bg-gray-200" />
        </div>
      </div>
    );
  }

    <motion.button
      type="button"
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => path && navigate(path, navState ? { state: navState } : undefined)}
      className="flex h-full min-h-[112px] w-full items-center justify-center transition-all"
    >
      <div className="flex h-[108px] w-[92%] flex-col items-center justify-center gap-1.5 px-1 py-1 rounded-[18px] border border-transparent hover:border-[#E8F3E9] hover:shadow-[0_6px_20px_rgba(47,95,67,0.08)] transition-all duration-200">
        <div className={`flex h-[82px] w-[82px] items-center justify-center rounded-[18px] overflow-hidden ${accentClass || 'bg-gray-50'}`}>
          <img src={icon} alt={label} className="h-[70px] w-[70px] object-contain scale-[1.12] mix-blend-multiply drop-shadow-sm" />
        </div>

        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="min-h-[24px] text-[10.5px] font-semibold leading-tight tracking-tight text-[#2F5F43] line-clamp-2 uppercase">
            {label}
          </span>
          <span className="sr-only">{description}</span>
        </div>
      </div>
    </motion.button>
};

const ServiceGrid = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  const getServiceKey = (service, index) => {
    const label = String(service?.label || '').trim();
    const path = String(service?.path || '').trim();
    return label || path ? `${label || 'service'}-${path || index}` : `service-${index}`;
  };

  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';

  const getNavigationConfig = (module) => {
    if (module.transport_type === 'delivery') {
      return {
        path: `${routePrefix}/parcel/details`,
        navState: {
          serviceType: 'parcel',
          transport_type: 'delivery',
          transportType: 'delivery',
          deliveryScope: 'city',
        },
      };
    }

    if (module.service_type === 'rental') return { path: `${routePrefix}/rental` };
    if (module.service_type === 'outstation') return { path: `${routePrefix}/cab` };
    if (module.service_type === 'bus' || module.name.toLowerCase().includes('bus')) {
      return { path: `${routePrefix}/bus` };
    }
    if (module.service_type === 'pooling' || module.name.toLowerCase().includes('pooling')) {
      return { path: `${routePrefix}/pooling` };
    }

    if (module.service_type === 'airport' || module.name.toLowerCase().includes('airport')) {
      return { path: `${routePrefix}/cab/airport` };
    }
    
    if (module.name.toLowerCase().includes('cab') || module.name.toLowerCase().includes('taxi')) {
      return { path: `${routePrefix}/cab` };
    }
    return { path: `${routePrefix}/ride/select-location` };
  };

  const getAccent = (index) => {
    const accnets = [
      'bg-[linear-gradient(135deg,#EFF8F0_0%,#D4EDD7_100%)]', // GoKab mint green
      'bg-[linear-gradient(135deg,#FFF9E6_0%,#FEF3C7_100%)]', // GoKab soft gold
      'bg-[linear-gradient(135deg,#E8F4FD_0%,#CDEAFB_100%)]', // Soft sky blue
      'bg-[linear-gradient(135deg,#F0FDF4_0%,#DCFCE7_100%)]', // Fresh mint
      'bg-[linear-gradient(135deg,#FCF4E8_0%,#FDE9C4_100%)]', // Warm peach
      'bg-[linear-gradient(135deg,#F0F9FF_0%,#E0F2FE_100%)]', // Cool sky
    ];
    return accnets[index % accnets.length];
  };

  const { modules, loading: settingsLoading } = useSettings();

  useEffect(() => {
    if (settingsLoading) return;
    
    // Only show active modules
    const activeModules = (modules || []).filter(m => m.active);
    
    const mapped = activeModules.map((m, idx) => ({
      ...getNavigationConfig(m),
      icon: normalizeAssetUrl(m.mobile_menu_icon),
      label: m.name,
      description: m.short_description,
      accentClass: getAccent(idx)
    }));
    
    setServices(mapped);
    setLoading(false);
  }, [modules, settingsLoading]);

  const optionCount = loading ? '...' : services.length;
  const optionLabel = services.length === 1 ? 'option' : 'options';

  return (
    <div className="px-5">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="py-1"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-slate-400">Services</p>
            <h2 className="mt-1 text-[18px] font-bold tracking-tight text-[#2F5F43]">Choose your ride</h2>
            <p className="mt-0.5 text-[11px] font-medium text-slate-400">Tap to start quickly.</p>
          </div>
        </div>

        <div className="mt-4 grid auto-rows-fr grid-cols-3 gap-3 md:grid-cols-4">
          {loading ? (
             [...Array(4)].map((_, i) => <ServiceTile key={i} loading />)
          ) : (
            services.map((service, index) => (
              <ServiceTile key={getServiceKey(service, index)} {...service} />
            ))
          )}
        </div>
      </motion.section>
    </div>
  );
};

export default ServiceGrid;
