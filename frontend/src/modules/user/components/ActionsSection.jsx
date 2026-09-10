import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const ActionCard = ({ title, description, image, surfaceClass, titleClass, buttonClass, buttonText, path }) => {
  const navigate = useNavigate();

  return (
    <div
      className={`group relative flex min-h-[176px] flex-1 flex-col overflow-hidden rounded-2xl border border-white/80 p-4 shadow-[0_14px_34px_rgba(2,6,23,0.10)] transition-transform duration-200 hover:-translate-y-0.5 focus-within:-translate-y-0.5 ${surfaceClass}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(120px_90px_at_12%_20%,rgba(255,255,255,0.85),transparent_65%)]" aria-hidden="true" />

        <div className="relative z-10 flex flex-1 flex-col">
        <div className="max-w-[160px]">
          <h3 className={`text-[18px] font-bold leading-none tracking-tight ${titleClass}`}>{title}</h3>
          <p className="mt-2 text-[12px] font-semibold leading-snug text-slate-600">{description}</p>
        </div>

        <div className="mt-auto pt-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate(path);
            }}
            className="relative inline-flex items-center rounded-full px-3.5 py-2 text-[11px] font-bold whitespace-nowrap text-white shadow-[0_12px_26px_rgba(2,6,23,0.16)] backdrop-blur-md bg-white/10 border border-white/35 overflow-hidden transition-all active:scale-95"
          >
            <span aria-hidden="true" className={`absolute inset-0 ${buttonClass} opacity-40`} />
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.45),rgba(255,255,255,0))] opacity-70"
            />
            <span className="relative z-10 inline-flex items-center gap-2">
              {buttonText}
              <ArrowRight size={13} strokeWidth={3} className="translate-y-[0.5px]" />
            </span>
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-12 right-2 w-[82px] opacity-95 transition-transform duration-300 group-hover:scale-[1.03]">
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="w-full h-auto object-contain drop-shadow-[0_22px_38px_rgba(2,6,23,0.18)]"
        />
      </div>
    </div>
  );
};

const ActionsSection = () => {
  return (
    <div className="px-5">
      <div className="mb-3 ml-1">
        <h2 className="text-[19.5px] font-extrabold text-primary tracking-tight">What do you need today?</h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ActionCard
          title="Ride"
          description="Bike, auto, and cab rides."
          image="/1_Bike.png"
          surfaceClass="bg-gradient-to-br from-orange-50/80 via-white/80 to-orange-100/60"
          titleClass="text-slate-900"
          buttonClass="bg-orange-500"
          buttonText="Book Now"
          path="/ride/select-location"
        />

        <ActionCard
          title="Delivery"
          description="Send parcels across the city."
          image="/5_Parcel.png"
          surfaceClass="bg-gradient-to-br from-indigo-50/80 via-white/80 to-indigo-100/60"
          titleClass="text-slate-900"
          buttonClass="bg-indigo-500"
          buttonText="Send Now"
          path="/parcel/type"
        />
      </div>
    </div>
  );
};

export default ActionsSection;
