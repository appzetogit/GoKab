import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileCheck2,
  IndianRupee,
  LifeBuoy,
  ShieldAlert,
  Trash2,
  UserCheck,
  Wallet,
} from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};

// One row per thing that waits for the admin. `tone` decides the colour when the count is above 0.
const ITEMS = [
  { key: 'active_sos', label: 'Active SOS alerts', hint: 'Call the person now', path: '/admin/safety', icon: ShieldAlert, tone: 'red' },
  { key: 'pending_drivers', label: 'Drivers waiting for approval', hint: 'Check documents and approve', path: '/admin/drivers/pending', icon: UserCheck, tone: 'amber' },
  { key: 'pending_withdrawals', label: 'Withdrawal requests', hint: 'Drivers asking for their money', path: '/admin/drivers/wallet/withdrawals', icon: IndianRupee, tone: 'amber' },
  { key: 'negative_wallets', label: 'Drivers with negative balance', hint: 'They owe the company', path: '/admin/drivers/wallet/negative', icon: Wallet, tone: 'amber' },
  { key: 'open_tickets', label: 'Open support tickets', hint: 'Reply and close them', path: '/admin/support/tickets', icon: LifeBuoy, tone: 'amber' },
  { key: 'pending_vehicles', label: 'Vehicles waiting for approval', hint: 'Fleet vehicles', path: '/admin/fleet/manage', icon: FileCheck2, tone: 'amber' },
  { key: 'commercial_waiting', label: 'Commercial permits to verify', hint: 'Needed for Elite and Pro', path: '/admin/elite/commercial', icon: BadgeCheck, tone: 'blue' },
  { key: 'plans_expiring', label: 'Plans ending in 7 days', hint: 'Extend or let them end', path: '/admin/elite/drivers', icon: Clock, tone: 'blue' },
  { key: 'delete_requests', label: 'Account delete requests', hint: 'Riders and drivers', path: '/admin/users/delete-requests', icon: Trash2, tone: 'slate' },
];

const TONES = {
  red: 'border-red-200 bg-red-50 text-red-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

const SETUP = [
  { key: 'cities', label: 'Add your city', path: '/admin/pricing/service-location' },
  { key: 'vehicle_types', label: 'Add vehicle types', path: '/admin/pricing/vehicle-type' },
  { key: 'set_prices', label: 'Set the fares (Set Price)', path: '/admin/pricing/set-price' },
  { key: 'documents', label: 'Choose the driver documents', path: '/admin/drivers/documents' },
];

/**
 * "What needs you today" for the top of the dashboard. Read-only: it only counts and links.
 * It hides itself if the numbers cannot be loaded, so the dashboard never breaks because of it.
 */
const AttentionPanel = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = unwrap(await api.get('/admin/insights/attention'));
        if (alive) setData(res?.data || res);
      } catch {
        if (alive) setData(null);
      }
    };
    load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!data?.attention) return null;

  const attention = data.attention;
  const setup = data.setup || {};
  const waiting = ITEMS.filter((item) => Number(attention[item.key] || 0) > 0);
  const missingSetup = SETUP.filter((step) => Number(setup[step.key] || 0) === 0);

  return (
    <section className="space-y-4">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-5 md:p-7 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          {waiting.length ? (
            <AlertTriangle size={18} className="text-amber-500" />
          ) : (
            <CheckCircle2 size={18} className="text-emerald-500" />
          )}
          <h3 className="text-lg font-black text-slate-900 tracking-tight">
            {waiting.length ? 'Needs your attention today' : 'All clear: nothing is waiting for you'}
          </h3>
        </div>

        {waiting.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {waiting.map(({ key, label, hint, path, icon: Icon, tone }) => (
              <button
                key={key}
                type="button"
                onClick={() => navigate(path)}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:shadow-md hover:-translate-y-0.5 ${TONES[tone]}`}
              >
                <Icon size={20} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-black leading-tight">{label}</p>
                  <p className="text-[11px] opacity-80 truncate">{hint}</p>
                </div>
                <span className="text-2xl font-black tabular-nums">{attention[key]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {missingSetup.length > 0 && (
        <div className="rounded-[2rem] border border-indigo-200 bg-indigo-50/60 p-5 md:p-7">
          <h3 className="text-base font-black text-indigo-900 tracking-tight mb-1">First-time setup</h3>
          <p className="text-[12px] text-indigo-800/80 mb-3">
            A few things are still empty. Do them in this order so rides and fares work.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SETUP.map((step, index) => {
              const done = Number(setup[step.key] || 0) > 0;
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => navigate(step.path)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-[13px] font-bold ${
                    done
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-indigo-200 bg-white text-indigo-900 hover:bg-indigo-50'
                  }`}
                >
                  {done ? <CheckCircle2 size={18} className="text-emerald-500" /> : <CircleDashed size={18} className="text-indigo-400" />}
                  <span>
                    {index + 1}. {step.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export default AttentionPanel;
