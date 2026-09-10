import React from 'react';
import { motion } from 'framer-motion';
import heroImg from '@/assets/landing/hero.png';
import { useSettings } from '../../../shared/context/SettingsContext';

import mobilityBanner from '@/assets/images/mobility-banner-cartoony.png';

const AuthLayout = ({ children, title, subtitle }) => {
  const { settings } = useSettings();
  const appName = settings.general?.app_name || 'GoKab';
  const appLogo = settings.general?.logo || settings.customization?.logo || settings.general?.favicon || '';

  return (
    <div className="min-h-[100dvh] w-full bg-[#F8F9FB] flex flex-col lg:h-screen lg:flex-row font-display selection:bg-black selection:text-white overflow-x-hidden lg:overflow-hidden">
      {/* Left side (Desktop Only) */}
      <div className="hidden lg:flex lg:w-[55%] h-full relative overflow-hidden bg-black">
        {/* Background Image with Overlay */}
        <div className="absolute inset-0">
          <img 
            src={heroImg} 
            alt="Premium Mobility" 
            className="w-full h-full object-cover opacity-60 scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-black via-black/40 to-transparent"></div>
        </div>

        <div className="relative z-10 w-full h-full flex flex-col justify-between p-16">
          <div className="flex items-center gap-3">
            {appLogo ? (
              <img
                src={appLogo}
                alt={`${appName} logo`}
                className="h-11 w-11 rounded-xl object-cover bg-white/95 p-1 shadow-lg shadow-black/20"
              />
            ) : (
              <div className="w-11 h-11 bg-white rounded-xl flex items-center justify-center shadow-lg shadow-black/20">
                <div className="w-5 h-5 bg-black rounded-md"></div>
              </div>
            )}
            <span className="text-2xl font-black tracking-tighter text-white uppercase">{appName}</span>
          </div>
          
          <div className="max-w-xl">
            <motion.div 
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 1, ease: "easeOut" }}
            >
              <h2 className="text-7xl font-black text-white leading-[1.1] mb-6 tracking-tight uppercase">
                Move with <br/><span className="bg-gradient-to-r from-yellow-400 via-orange-500 to-magenta-500 bg-clip-text text-transparent">Safety & Style.</span>
              </h2>
              <p className="text-white/70 text-2xl font-medium mb-12 leading-relaxed">
                Experience the next generation of urban mobility with {appName}. Reliable, fast, and always at your service.
              </p>
              
              <div className="flex gap-4">
                <div className="px-6 py-3 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20">
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Global Coverage</p>
                  <p className="text-white font-bold">15,000+ Cities</p>
                </div>
                <div className="px-6 py-3 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20">
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Safe Rides</p>
                  <p className="text-white font-bold">Verified Drivers</p>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="flex items-center gap-8 text-white/40 text-[11px] font-bold uppercase tracking-[0.2em]">
            <span>© {appName} 2026</span>
            <span>•</span>
            <a href="/terms" className="hover:text-white transition-colors">Terms</a>
            <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
          </div>
        </div>
      </div>

      {/* Right side (Mobile-first login card) */}
      <div className="flex-1 min-h-[100dvh] lg:h-full flex flex-col items-center justify-start lg:justify-center px-4 py-6 sm:px-6 sm:py-8 relative w-full bg-white lg:bg-[#F8F9FB] overflow-x-hidden overflow-y-auto">
        {/* Subtle Background Banner */}
        <div className="absolute inset-0 z-0 flex items-center justify-center opacity-[0.08] pointer-events-none overflow-hidden">
          <motion.img 
            animate={{ 
              scale: [1, 1.2, 1],
              rotate: [0, 5, 0]
            }}
            transition={{ 
              duration: 25, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
            src={mobilityBanner} 
            className="w-full max-w-2xl h-auto object-contain"
          />
        </div>

        {/* Vibrant Multi-color Background Blobs */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-yellow-300/30 to-orange-500/30 rounded-full blur-[100px] -z-10"></div>
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-gradient-to-tr from-blue-400/20 to-magenta-600/20 rounded-full blur-[100px] -z-10"></div>

        {/* Mobile Header (Visible only on small screens) */}
        <div className="lg:hidden w-full flex flex-col items-center text-center mb-6 z-20 shrink-0">
            {appLogo ? (
              <motion.img
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                src={appLogo}
                alt={`${appName} logo`}
                className="h-16 w-16 rounded-2xl object-cover bg-white p-1.5 mb-4 shadow-2xl shadow-black/10 border border-gray-50"
              />
            ) : (
              <div className="w-14 h-14 bg-gradient-to-br from-yellow-400 via-orange-500 to-magenta-500 rounded-2xl flex items-center justify-center mb-3 shadow-xl">
                <div className="w-7 h-7 bg-white rounded-lg"></div>
              </div>
            )}
            <h2 className="text-2xl font-black tracking-tighter text-black uppercase mb-1">{appName}</h2>
            <div className="w-8 h-1.5 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full"></div>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-[28px] sm:rounded-[40px] p-5 sm:p-8 md:p-12 shadow-[0_24px_60px_rgba(0,0,0,0.06)] sm:shadow-[0_40px_100px_rgba(0,0,0,0.06)] border border-gray-100/70 z-10 relative"
        >
          {title && (
            <div className="mb-6 sm:mb-8 text-center">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-gray-900 leading-tight tracking-tighter uppercase mb-3 sm:mb-4">
                {title}
              </h1>
              {subtitle && (
                <p className="text-gray-500 text-sm md:text-base font-medium leading-relaxed max-w-[280px] mx-auto">
                  {subtitle}
                </p>
              )}
            </div>
          )}
          <div className="relative z-10">
            {children}
          </div>
        </motion.div>
        
        {/* Helper footer link */}
        <div className="mt-6 sm:mt-8 text-center w-full max-w-md z-20 shrink-0">
            <p className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em]">
              Need assistance? <a href="/support" className="text-black hover:text-orange-500 transition-colors ml-1">Contact Support</a>
            </p>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
