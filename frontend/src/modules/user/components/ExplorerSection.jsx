import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import indiaGateImg from '@/assets/india_gate_real.png';
import jaipurImg from '@/assets/jaipur.avif';
import tajMahalImg from '@/assets/taj mahal.jpeg';

const ExplorerSection = () => {
  const navigate = useNavigate();
  const cities = [
    {
      title: 'Airport Indore',
      image: '/Gemini_Generated_Image_ob17d1ob17d1ob17.png',
      label: '10 min',
      code: 'IDR',
      drop: 'Devi Ahilya Bai Holkar Airport, Indore',
    },
    {
      title: 'Indore Junction',
      image: '/train_station_illustration.png',
      label: '5 min',
      code: 'JCT',
      drop: 'Indore Junction Railway Station, Indore',
    },
    {
      title: 'Rajwada',
      image: '/Gemini_Generated_Image_17lko817lko817lk.png',
      label: '15 min',
      code: 'RAJ',
      drop: 'Rajwada Palace, Indore',
    },
  ];

  const indiaCities = [
    {
      title: 'Taj Mahal',
      image: tajMahalImg,
      label: 'Agra',
      code: 'AGR',
      drop: 'Taj Mahal, Agra',
    },
    {
      title: 'Hawa Mahal',
      image: jaipurImg,
      label: 'Jaipur',
      code: 'JAI',
      drop: 'Hawa Mahal, Jaipur',
    },
    {
      title: 'India Gate',
      image: indiaGateImg,
      label: 'New Delhi',
      code: 'DEL',
      drop: 'India Gate, New Delhi',
    },
  ];

  const handleExploreDestination = (city) => {
    navigate('/taxi/user/ride/select-location', {
      state: {
        drop: city.drop || city.title,
      },
    });
  };

  return (
    <div className="px-5 pb-8 flex flex-col gap-10">
      {/* Explore Indore Section */}
      

      {/* Explore India Section */}
      <div>
        <div className="mb-3 ml-1">
          <h2 className="text-[19px] font-bold text-primary tracking-tight">Explore India</h2>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Top tourist destinations across the country
          </p>
        </div>

        <div className="flex gap-4 overflow-x-auto no-scrollbar scroll-smooth pb-5 px-1">
          {indiaCities.map((city, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleExploreDestination(city)}
              className="flex-shrink-0 w-[214px] group text-left transition-all active:scale-[0.98] cursor-pointer"
            >
              <div className="rounded-[20px] bg-white/92 border border-white/80 shadow-[0_18px_40px_rgba(15,23,42,0.07)] overflow-hidden h-[136px] transition-all relative">
                <img
                  src={city.image}
                  alt={city.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/20 to-transparent"></div>
                <div className="absolute top-4 right-4 bg-white/92 backdrop-blur-md px-2.5 py-1 rounded-full shadow-sm border border-white/60 z-10">
                  <p className="text-[9px] font-bold text-primary tracking-widest uppercase">{city.code}</p>
                </div>
              </div>
              <div className="mt-3 px-2">
                <h4 className="text-[15px] font-bold text-slate-900 leading-tight tracking-tight flex items-center justify-between">
                  {city.title}
                  <div className="w-7 h-7 rounded-full bg-slate-50 flex items-center justify-center text-slate-400">
                    <ArrowRight size={14} strokeWidth={2.5} />
                  </div>
                </h4>
                <p className="text-[11px] text-gray-400 font-bold mt-1 tracking-tight">
                  Located in {city.label}
                </p>
              </div>
            </button>
          ))}
          
          <button
            type="button"
            onClick={() => handleExploreDestination(indiaCities[0])}
            className="flex-shrink-0 w-[128px] flex flex-col justify-center items-center gap-2 bg-white/75 border border-white/80 rounded-[18px] active:scale-95 transition-all text-slate-500 font-bold h-[136px] self-start shadow-[0_14px_32px_rgba(15,23,42,0.05)]"
          >
            <div className="w-10 h-10 rounded-full bg-slate-50 border border-white/80 shadow-sm flex items-center justify-center">
              <ArrowRight size={18} strokeWidth={2.5} className="text-slate-300" />
            </div>
            <span className="text-[11px] uppercase tracking-[0.14em]">View All</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExplorerSection;
