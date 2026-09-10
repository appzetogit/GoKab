import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, Clock, Map, User } from 'lucide-react';
import { useSettings, normalizeAssetUrl } from '../../../shared/context/SettingsContext';
import busIcon from '../../../assets/3d images/AutoCab/bus.png';

const isEnabledFlag = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalized);
};

const BottomNavbar = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { settings, modules, loading, hasBootstrapSettings } = useSettings();
  const showBusService = isEnabledFlag(settings.transportRide?.enable_bus_service);
  const busModule = (modules || []).find(m => m.service_type === 'bus' || m.name.toLowerCase() === 'bus');
  const dynamicBusIcon = busModule?.mobile_menu_icon ? normalizeAssetUrl(busModule.mobile_menu_icon) : busIcon;
  const showNavSkeleton = loading && !hasBootstrapSettings;

  const navItems = [
    { icon: Home, label: 'Ride', path: '/taxi/user' },
    { icon: Clock, label: 'Rides', path: '/taxi/user/activity' },
    ...(showBusService ? [{ imageIcon: dynamicBusIcon, label: 'Bus', path: '/taxi/user/bus' }] : []),
    { icon: Map, label: 'Support', path: '/taxi/user/support' },
    { icon: User, label: 'Profile', path: '/taxi/user/profile' },
  ];

  if (showNavSkeleton) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-[100] mx-auto w-full max-w-lg px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2 pointer-events-none">
        <div className="flex items-center justify-around overflow-visible rounded-[32px] border border-white/40 bg-white/85 px-2 py-2 shadow-[0_20px_40px_rgba(0,0,0,0.12)] backdrop-blur-2xl pointer-events-auto relative">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex flex-1 flex-col items-center justify-center py-1.5">
              <div className="h-[21px] w-[21px] animate-pulse rounded-full bg-slate-200" />
              <div className="mt-2 h-2.5 w-10 animate-pulse rounded-full bg-slate-200" />
            </div>
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[100] mx-auto w-full max-w-lg px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-2 pointer-events-none">
      <div className="flex items-center justify-around overflow-visible rounded-[32px] border border-white/40 bg-white/85 px-2 py-2 shadow-[0_20px_40px_rgba(0,0,0,0.12)] backdrop-blur-2xl pointer-events-auto relative">
        {navItems.map(({ icon: Icon, imageIcon, label, path }) => {
          const isActive =
            path === '/taxi/user'
              ? pathname === path
              : pathname === path || pathname.startsWith(`${path}/`);

          return (
            <button
              key={label}
              type="button"
              onClick={() => navigate(path)}
              className="flex-1 flex flex-col items-center justify-center py-1.5 relative z-10 outline-none tap-highlight-transparent group"
            >
              <div className="relative flex flex-col items-center">
                {/* Active Sliding Background Pill */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      layoutId="active-pill"
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 32,
                        mass: 1
                      }}
                      className="absolute -inset-y-1 -inset-x-3 bg-[linear-gradient(135deg,#6FBF7A_0%,#4da65a_100%)] rounded-[14px] shadow-[0_6px_14px_rgba(111,191,122,0.28)]"
                    />
                  )}
                </AnimatePresence>

                {/* Icon Container with Transition */}
                <motion.div
                  animate={{
                    scale: isActive ? 1.15 : 1,
                    y: isActive ? -1 : 0
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 30
                  }}
                  className="relative z-20"
                >
                  {imageIcon ? (
                    <img
                      src={imageIcon}
                      alt=""
                      className={`h-[21px] w-[21px] object-contain transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-80'}`}
                      draggable={false}
                    />
                  ) : (
                    <Icon
                      size={21}
                      strokeWidth={isActive ? 2.5 : 2}
                      className={`transition-colors duration-300 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-[#6FBF7A]'}`}
                    />
                  )}
                </motion.div>

                {/* Label with Transition */}
                <motion.span
                  animate={{
                    opacity: isActive ? 1 : 0.5,
                    y: isActive ? 2 : 1,
                    scale: isActive ? 1 : 0.95
                  }}
                  transition={{
                    duration: 0.2
                  }}
                  className={`relative z-20 text-[10px] font-bold uppercase tracking-[0.18em] font-sans mt-1 transition-colors duration-300 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-[#6FBF7A]'
                    }`}
                >
                  {label}
                </motion.span>

                {/* Subtle Bottom Glow for Active Tab */}
                {isActive && (
                  <motion.div
                    layoutId="active-glow"
                    transition={{
                      type: 'spring',
                      stiffness: 400,
                      damping: 32
                    }}
                    className="absolute -bottom-2 w-4 h-1 bg-white/25 rounded-full blur-[2px]"
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNavbar;
