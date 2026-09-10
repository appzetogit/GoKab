import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Clock3, ShieldCheck, Sparkles } from 'lucide-react';

const rotatingCards = [
  {
    icon: Clock3,
    iconClass: 'text-orange-600',
    title: 'In a hurry?',
    description: 'Auto for shorter wait times.',
    actionClass: 'bg-orange-50 text-orange-500',
    path: '/taxi/user/ride/select-location',
    images: [
      { src: '/2_AutoRickshaw.png', alt: 'Auto' },
      { src: '/1_Bike.png', alt: 'Bike' },
    ],
  },
  {
    icon: ShieldCheck,
    iconClass: 'text-blue-600',
    title: 'Need more space?',
    description: 'Cab for luggage or comfort.',
    actionClass: 'bg-blue-50 text-blue-500',
    path: '/taxi/user/ride/select-location',
    images: [
      { src: '/4_Taxi.png', alt: 'Taxi' },
      { src: '/white_sedan_banner_car.png', alt: 'Sedan' },
    ],
  },
];

const ImageCarousel = ({ images, className }) => {
  const activeImage = images?.[0];

  if (!activeImage) return null;

  return (
    <div className={className}>
      <img src={activeImage.src} alt={activeImage.alt} className="w-full object-contain drop-shadow-xl" />
    </div>
  );
};

const PromoCard = ({ icon: Icon, iconClass, title, description, actionClass, path, images, onNavigate }) => (
  <motion.div
    whileTap={{ scale: 0.98 }}
    onClick={() => onNavigate(path)}
    className="relative min-h-[140px] overflow-hidden rounded-2xl border border-[#E8F3E9] bg-white p-3.5 shadow-[0_4px_20px_rgba(47,95,67,0.08)] hover:shadow-[0_8px_28px_rgba(47,95,67,0.12)] transition-shadow"
  >
    <div className={`flex items-center gap-2 ${iconClass}`}>
      <Icon size={11} strokeWidth={2.5} />
    </div>
    <h3 className="mt-2.5 text-[17px] font-bold leading-snug tracking-tight text-gray-900">{title}</h3>
    <p className="mt-1 max-w-[132px] text-[10px] font-bold leading-snug text-gray-500">{description}</p>
    <div className={`mt-3 inline-flex h-8 w-8 items-center justify-center rounded-full ${actionClass}`}>
      <ArrowRight size={15} strokeWidth={2.5} />
    </div>
    <ImageCarousel images={images} className="absolute bottom-1 right-1 w-[74px] opacity-95 pointer-events-none" />
  </motion.div>
);

const PromoBanners = () => {
  const navigate = useNavigate();

  return (
    <div className="px-5 space-y-4">
      <div className="mb-1 ml-1">
        <h2 className="text-[19.5px] font-extrabold text-[#2F5F43] tracking-tight">Recommended for you</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {rotatingCards.map((card, index) => (
          <PromoCard key={`${String(card.title || '').trim() || 'promo'}-${index}`} {...card} onNavigate={navigate} />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-2xl border border-[#2F5F43]/20 bg-gradient-to-br from-[#2F5F43] to-[#1a3d2a] p-4 shadow-[0_18px_44px_rgba(47,95,67,0.20)]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(240px_160px_at_20%_25%,rgba(111,191,122,0.20),transparent_60%)]" aria-hidden="true" />
        <div className="absolute inset-0 bg-[radial-gradient(260px_180px_at_85%_85%,rgba(242,211,79,0.15),transparent_62%)]" aria-hidden="true" />

        <div className="relative z-10 flex min-h-[168px] items-end justify-between gap-4">
          <div className="max-w-[62%]">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/85">
              <Sparkles size={12} strokeWidth={2.5} className="text-cyan-200" />
              Savings
            </div>

            <h3 className="mt-3 text-[20px] font-bold leading-tight tracking-tight text-white">
              Better savings on your next ride.
            </h3>
            <p className="mt-1.5 text-[11px] font-bold leading-relaxed text-white/70">Book quickly and save more.</p>

            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate('/taxi/user/ride/select-location')}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-bold text-slate-900 shadow-lg shadow-black/15"
            >
              Ride Now
              <ArrowRight size={14} strokeWidth={3} />
            </motion.button>
          </div>

          <div className="pointer-events-none w-[140px] shrink-0 opacity-95">
            <img src="/ride_now_banner.png" alt="Promo" className="w-full drop-shadow-2xl" />
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default PromoBanners;
