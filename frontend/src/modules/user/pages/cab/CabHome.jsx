import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';

import imgShared from '@/assets/images/shared_taxi_card.png';
import imgAirport from '@/assets/images/airport_cab_card.png';
import imgSpiritual from '@/assets/images/spiritual_trips_card.png';
import imgOneWay from '@/assets/images/one_way_card.png';

const services = [
  {
    id: 'shared',
    title: 'Shared Taxi',
    sub: 'Book seats, save money',
    img: imgShared,
    path: '/cab/shared',
  },
  {
    id: 'airport',
    title: 'Airport Cab',
    sub: 'To & from airport',
    img: imgAirport,
    path: '/cab/airport',
  },
  {
    id: 'spiritual',
    title: 'Spiritual Trips',
    sub: 'Temple & pilgrimage tours',
    img: imgSpiritual,
    path: '/cab/spiritual',
  },
  {
    id: 'oneway',
    title: 'One Way',
    sub: 'City to city travel',
    img: imgOneWay,
    path: '/intercity',
  },
];

const CabHome = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';

  return (
    <div className="min-h-screen bg-slate-50 max-w-lg mx-auto font-sans pb-16">
      {/* Header matching screenshot */}
      <header className="bg-white px-5 pt-12 pb-4 sticky top-0 z-20 border-b border-gray-100 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-1 text-[#059669] hover:text-[#047857] active:scale-95 transition-all shrink-0"
        >
          <ArrowLeft size={22} className="stroke-[2.5]" />
        </button>
        <h1 className="text-[20px] font-extrabold text-[#0f172a] tracking-tight">
          Cab Services
        </h1>
      </header>

      {/* Grid of services */}
      <div className="px-4 pt-5 grid grid-cols-2 gap-4">
        {services.map((s, i) => (
          <motion.button
            key={s.id}
            type="button"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.08 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate(`${routePrefix}${s.path}`)}
            className="relative w-full h-[290px] rounded-[24px] overflow-hidden shadow-[0_4px_16px_rgba(15,23,42,0.06)] border border-slate-100 text-left bg-slate-200 group active:scale-98 transition-all"
          >
            {/* Background Cover Image */}
            <img
              src={s.img}
              alt={s.title}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            
            {/* Dark Bottom Gradient Overlay for text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent z-10" />

            {/* Content overlay at bottom */}
            <div className="absolute bottom-5 left-4 right-4 z-20 flex flex-col pointer-events-none">
              <span className="text-[17px] font-extrabold text-white tracking-tight leading-tight">
                {s.title}
              </span>
              <span className="text-[11.5px] text-white/90 font-medium mt-1 leading-snug">
                {s.sub}
              </span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
};

export default CabHome;
