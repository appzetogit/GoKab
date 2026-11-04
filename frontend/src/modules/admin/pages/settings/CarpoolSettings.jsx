import React, { useEffect, useState } from 'react';
import { Loader2, Save, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const FIELDS = [
  { name: 'carpool_seat_fare_percent', label: 'Seat fare, % of the whole cab fare', hint: 'A rider who shares pays this share of the full fare (default 65).' },
  { name: 'carpool_match_radius_km', label: 'Pickup match radius (km)', hint: 'Riders are matched only if their pickups are this close.' },
  { name: 'carpool_time_window_minutes', label: 'Pickup time window (± minutes)', hint: 'Riders are matched only if their pickup times are this close.' },
  { name: 'carpool_join_cutoff_minutes', label: 'No new rider before pickup (minutes)', hint: 'A scheduled carpool takes no new rider this long before pickup.' },
  { name: 'carpool_add_rider_timeout_minutes', label: 'Driver answer time for a new rider (minutes)', hint: 'If the driver does not answer, the rider goes on their own.' },
  { name: 'carpool_solo_commission_percent', label: 'Commission kept when only one rider (%)', hint: '0 = no commission when the driver ends up with a single rider.' },
];

const STATUS_STYLE = {
  searching: 'bg-amber-100 text-amber-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-rose-100 text-rose-700',
};

const Toggle = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
    <span className="text-[13px] font-bold text-slate-700">{label}</span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked ? '1' : '0')}
      className="h-5 w-5 accent-indigo-600"
    />
  </label>
);

const CarpoolSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});
  const [groups, setGroups] = useState([]);

  const load = async () => {
    try {
      setLoading(true);
      const [settingsRes, groupsRes] = await Promise.all([
        api.get('/admin/general-settings/transport-ride'),
        api.get('/admin/carpool/groups'),
      ]);
      setSettings(settingsRes.data?.settings || settingsRes.settings || {});
      setGroups(groupsRes.data?.groups || groupsRes.groups || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load carpool settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const set = (name, value) => setSettings((prev) => ({ ...prev, [name]: value }));

  const save = async () => {
    try {
      setSaving(true);
      await api.patch('/admin/general-settings/transport-ride', { settings });
      toast.success('Carpool settings saved');
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

  const on = (name) => String(settings[name] ?? '1') === '1';

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      <div className="max-w-[1200px] mx-auto p-4 md:p-8 space-y-8 pb-32">
        <div className="flex items-center gap-3">
          <Users className="text-indigo-600" />
          <div>
            <h1 className="text-xl font-black text-slate-900">Carpool (Airport / Railway)</h1>
            <p className="text-xs text-slate-500">Riders going to the same airport or station can share one cab.</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Toggle label="Carpool for Airport rides" checked={on('carpool_enabled_airport')} onChange={(v) => set('carpool_enabled_airport', v)} />
            <Toggle label="Carpool for Railway rides" checked={on('carpool_enabled_railway')} onChange={(v) => set('carpool_enabled_railway', v)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
            {FIELDS.map((f) => (
              <div key={f.name} className="space-y-1.5">
                <label className="text-[13px] font-bold text-slate-700 block">{f.label}</label>
                <input
                  type="number"
                  min="0"
                  value={settings[f.name] ?? ''}
                  onChange={(e) => set(f.name, e.target.value)}
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
            Save carpool settings
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-sm font-black text-slate-800">Carpool groups ({groups.length})</h2>
            <button onClick={load} className="text-xs font-bold text-indigo-600 hover:underline">Refresh</button>
          </div>
          {groups.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No carpool groups yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Station</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Seats</th>
                    <th className="px-6 py-3">Driver</th>
                    <th className="px-6 py-3">Riders</th>
                    <th className="px-6 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-t border-slate-100 align-top">
                      <td className="px-6 py-3 font-semibold text-slate-700">
                        {g.stationName || '-'}
                        <div className="text-[11px] font-normal text-slate-400 capitalize">{g.kind}</div>
                      </td>
                      <td className="px-6 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLE[g.status] || ''}`}>{g.status}</span>
                      </td>
                      <td className="px-6 py-3">{g.seatsUsed}/{g.seatsTotal}</td>
                      <td className="px-6 py-3">{g.driver ? `${g.driver.name} ${g.driver.phone}` : '-'}</td>
                      <td className="px-6 py-3 space-y-1">
                        {g.riders.map((r) => (
                          <div key={r.rideId} className="text-[12px] text-slate-600">
                            {r.name} · {r.passengers} seat{r.passengers === 1 ? '' : 's'} · ₹{r.fare} · {r.status}
                          </div>
                        ))}
                      </td>
                      <td className="px-6 py-3 text-slate-500">{new Date(g.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CarpoolSettings;
