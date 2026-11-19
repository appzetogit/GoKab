import React, { useCallback, useEffect, useState } from 'react';
import { Gem, Loader2, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};
const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

const Card = ({ title, hint, children }) => (
  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
    <div className="px-6 py-4 border-b border-slate-100">
      <h2 className="text-sm font-black text-slate-800">{title}</h2>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
    {children}
  </div>
);

const EliteSlots = () => {
  const [loading, setLoading] = useState(true);
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultLimit, setDefaultLimit] = useState('');
  const [reserveMinutes, setReserveMinutes] = useState('');
  const [cities, setCities] = useState([]);
  const [edits, setEdits] = useState({});
  const [savingCity, setSavingCity] = useState('');
  const [slots, setSlots] = useState([]);

  const load = useCallback(async () => {
    try {
      const [settingsRes, citiesRes, slotsRes] = await Promise.all([
        api.get('/admin/driver-network/settings'),
        api.get('/admin/driver-network/cities'),
        api.get('/admin/driver-network/prime-slots'),
      ]);
      const settings = unwrap(settingsRes).settings || {};
      setDefaultLimit(String(settings.prime_per_city ?? 5));
      setReserveMinutes(String(settings.prime_slot_reservation_minutes ?? 15));
      setCities(unwrap(citiesRes).results || []);
      setSlots(unwrap(slotsRes).results || []);
      setEdits({});
    } catch (err) {
      console.error(err);
      toast.error(errorText(err, 'Failed to load Elite slots'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveDefaults = async () => {
    const limit = Number(defaultLimit);
    const minutes = Number(reserveMinutes);
    if (!Number.isInteger(limit) || limit < 0) return toast.error('Default limit must be 0 or more');
    if (!Number.isFinite(minutes) || minutes < 1) return toast.error('Reservation time must be at least 1 minute');
    try {
      setSavingDefault(true);
      await api.patch('/admin/driver-network/settings', {
        prime_per_city: limit,
        prime_slot_reservation_minutes: minutes,
      });
      toast.success('Defaults saved');
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to save'));
    } finally {
      setSavingDefault(false);
    }
  };

  const saveCity = async (city) => {
    const raw = edits[city.id];
    const value = raw === undefined ? city.own_limit : raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 0)) return toast.error('Enter 0 or more, or leave blank');
    try {
      setSavingCity(city.id);
      await api.patch(`/admin/driver-network/cities/${city.id}/prime-limit`, { prime_limit: value });
      toast.success(`${city.name}: saved`);
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to save'));
    } finally {
      setSavingCity('');
    }
  };

  const revoke = async (slot) => {
    if (!window.confirm(`Take the Elite slot from ${slot.driver.name}? They go back to the Basic plan.`)) return;
    try {
      await api.delete(`/admin/driver-network/prime-slots/${slot.id}`);
      toast.success('Slot removed');
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to remove'));
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
          <Gem className="text-indigo-600" />
          <div>
            <h1 className="text-xl font-black text-slate-900">Elite Slots</h1>
            <p className="text-xs text-slate-500">How many Elite drivers each city can have, and who holds a slot now.</p>
          </div>
        </div>

        <Card title="Default for every city" hint="A city without its own number below uses this.">
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <label className="space-y-1.5 block">
              <span className="text-[13px] font-bold text-slate-700">Elite drivers per city</span>
              <input
                type="number"
                min="0"
                value={defaultLimit}
                onChange={(e) => setDefaultLimit(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg py-3 px-4 text-[14px] text-slate-700 focus:border-indigo-500 outline-none"
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-[13px] font-bold text-slate-700">Slot held while a driver pays (minutes)</span>
              <input
                type="number"
                min="1"
                value={reserveMinutes}
                onChange={(e) => setReserveMinutes(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg py-3 px-4 text-[14px] text-slate-700 focus:border-indigo-500 outline-none"
              />
              <span className="text-[11px] text-slate-400 block">If the payment is not done in this time, the slot is freed.</span>
            </label>
          </div>
          <div className="px-6 pb-6">
            <button
              onClick={saveDefaults}
              disabled={savingDefault}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {savingDefault ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save defaults
            </button>
          </div>
        </Card>

        <Card title={`Cities (${cities.length})`} hint="Leave the box blank to use the default. A city cannot be set below the slots already taken.">
          {cities.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No cities yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-6 py-3">City</th>
                    <th className="px-6 py-3">Limit now</th>
                    <th className="px-6 py-3">Taken</th>
                    <th className="px-6 py-3">Left</th>
                    <th className="px-6 py-3">This city's own limit</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {cities.map((city) => {
                    const value = edits[city.id] ?? (city.own_limit === null ? '' : String(city.own_limit));
                    return (
                      <tr key={city.id} className="border-t border-slate-100">
                        <td className="px-6 py-3 font-bold text-slate-800">{city.name}</td>
                        <td className="px-6 py-3">
                          {city.limit}
                          {city.own_limit === null && <span className="ml-1 text-[11px] text-slate-400">(default)</span>}
                        </td>
                        <td className="px-6 py-3">{city.used}</td>
                        <td className="px-6 py-3">{city.left}</td>
                        <td className="px-6 py-3">
                          <input
                            type="number"
                            min="0"
                            placeholder="default"
                            value={value}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [city.id]: e.target.value }))}
                            className="w-28 bg-white border border-slate-200 rounded-lg py-2 px-3 text-[13px] focus:border-indigo-500 outline-none"
                          />
                        </td>
                        <td className="px-6 py-3 text-right">
                          <button
                            onClick={() => saveCity(city)}
                            disabled={savingCity === city.id || edits[city.id] === undefined}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
                          >
                            {savingCity === city.id ? 'Saving...' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Slots in use (${slots.length})`} hint="Removing a slot takes the Elite plan from that driver.">
          {slots.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">No Elite slots are taken.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-6 py-3">City</th>
                    <th className="px-6 py-3">Slot</th>
                    <th className="px-6 py-3">Driver</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Since</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {slots.map((slot) => (
                    <tr key={slot.id} className="border-t border-slate-100">
                      <td className="px-6 py-3 font-bold text-slate-800">{slot.city}</td>
                      <td className="px-6 py-3">#{slot.slot_no}</td>
                      <td className="px-6 py-3">
                        {slot.driver.name}
                        {slot.driver.phone && <span className="ml-2 text-xs text-slate-400">{slot.driver.phone}</span>}
                      </td>
                      <td className="px-6 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            slot.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {slot.status === 'active' ? 'Active' : 'Paying'}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-slate-500">{slot.since ? new Date(slot.since).toLocaleDateString() : ''}</td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() => revoke(slot)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default EliteSlots;
