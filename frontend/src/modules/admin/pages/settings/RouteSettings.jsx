import React, { useEffect, useState } from 'react';
import { Loader2, Route, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const FIELDS = [
  { name: 'default_corridor_km', label: 'Default corridor width (km)', hint: 'Used when a driver does not pick a width for a new route (default 10).' },
  { name: 'max_corridor_km', label: 'Maximum corridor width (km)', hint: 'Widest corridor a driver may set on a route (default 25).' },
  { name: 'max_route_km', label: 'Maximum route length (km)', hint: 'Longer routes are refused. 0 = no limit.' },
  { name: 'route_switches_per_day', label: 'Mode / route changes per day', hint: 'How often a driver may switch between All Locations and a route in a day. 0 = no limit.' },
  { name: 'all_locations_radius_km', label: 'All Locations radius (km)', hint: 'In All Locations mode a driver is offered rides this far from the pickup, plus rides in their own city.' },
];

const RouteSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/admin/driver-network/settings');
        setSettings(res.data?.settings || res.settings || {});
      } catch (err) {
        console.error(err);
        toast.error('Failed to load route settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      const body = Object.fromEntries(FIELDS.map((f) => [f.name, settings[f.name]]));
      await api.patch('/admin/driver-network/settings', body);
      toast.success('Route settings saved');
    } catch (err) {
      console.error(err);
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      <div className="max-w-[1200px] mx-auto p-4 md:p-8 space-y-8 pb-32">
        <div className="flex items-center gap-3">
          <Route className="text-indigo-600" />
          <div>
            <h1 className="text-xl font-black text-slate-900">Driver Routes</h1>
            <p className="text-xs text-slate-500">
              Limits for Route mode. How many routes a driver gets is set per plan (Subscription plans) or per driver.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
            {FIELDS.map((f) => (
              <div key={f.name} className="space-y-1.5">
                <label className="text-[13px] font-bold text-slate-700 block">{f.label}</label>
                <input
                  type="number"
                  min="0"
                  value={settings[f.name] ?? ''}
                  onChange={(e) => setSettings((prev) => ({ ...prev, [f.name]: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg py-3 px-4 text-[14px] text-slate-700 focus:border-indigo-500 outline-none"
                />
                <p className="text-[11px] text-slate-400">{f.hint}</p>
              </div>
            ))}
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save route settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default RouteSettings;
