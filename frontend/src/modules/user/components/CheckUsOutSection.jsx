import React from 'react';
import { motion } from 'framer-motion';
import { Camera, PlayCircle, Share2, ArrowRight } from 'lucide-react';
// import checkUsOutImg from '@/assets/check_us_out.jpg';

const CheckUsOutSection = () => {
  return (
    <div className="px-5 pb-10">
      <div className="mb-4 ml-1">
        <h2 className="text-[20px] font-bold text-primary tracking-tight">Check us out</h2>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
          Join our growing community
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative overflow-hidden rounded-[32px] bg-white border border-white/80 shadow-[0_20px_50px_rgba(15,23,42,0.08)] group"
      >
        {/* Main Image Container */}
        <div className="relative h-[220px] overflow-hidden">
          <img
            src={checkUsOutImg}
            alt="Check Us Out"
            className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-slate-900/20 to-transparent" />

          {/* Social Badges */}
          <div className="absolute bottom-4 left-5 flex gap-2">
            <div className="h-8 w-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 text-white hover:bg-white hover:text-slate-900 transition-colors cursor-pointer">
              <Camera size={16} strokeWidth={2.5} />
            </div>
            <div className="h-8 w-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 text-white hover:bg-white hover:text-slate-900 transition-colors cursor-pointer">
              <PlayCircle size={16} strokeWidth={2.5} />
            </div>
            <div className="h-8 w-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/30 text-white hover:bg-white hover:text-slate-900 transition-colors cursor-pointer">
              <Share2 size={16} strokeWidth={2.5} />
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-6">
          <div className="flex items-start justify-between">
            <div className="max-w-[75%]">
              <h3 className="text-[22px] font-bold text-slate-900 leading-tight tracking-tight">
                Experience the ride of your life.
              </h3>
              <p className="mt-2 text-[13px] font-bold text-slate-500 leading-relaxed">
                Follow us for exclusive offers, updates, and more amazing journeys.
              </p>
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="h-12 w-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-lg shadow-slate-900/20"
            >
              <ArrowRight size={20} strokeWidth={3} />
            </motion.button>
          </div>

          {/* Stats/Features */}
          <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Rating</p>
              <p className="mt-1 text-[16px] font-bold text-slate-900">4.8/5.0</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Users</p>
              <p className="mt-1 text-[16px] font-bold text-slate-900">50K+</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Cities</p>
              <p className="mt-1 text-[16px] font-bold text-slate-900">20+</p>
            </div>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-emerald-100/30 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-blue-100/30 blur-3xl pointer-events-none" />
      </motion.div>
    </div>
  );
};

export default CheckUsOutSection;
