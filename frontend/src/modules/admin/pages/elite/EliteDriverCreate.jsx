import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gem, Loader2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};
const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

const inputClass =
  'w-full bg-white border border-slate-200 rounded-lg py-3 px-4 text-[14px] text-slate-700 focus:border-indigo-500 outline-none';

const Field = ({ label, hint, children }) => (
  <label className="space-y-1.5 block">
    <span className="text-[13px] font-bold text-slate-700 block">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-slate-400 block">{hint}</span>}
  </label>
);

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  password: '',
  password_confirmation: '',
  service_location_id: '',
  plan: 'lower',
  plan_days: '30',
  vehicle_type_id: '',
  vehicle_make: '',
  vehicle_model: '',
  vehicle_number: '',
  vehicle_color: '',
};

const EliteDriverCreate = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [cities, setCities] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [citiesRes, vehiclesRes] = await Promise.all([
          api.get('/admin/driver-network/cities'),
          api.get('/admin/types/vehicle-types/list?transport_type=taxi').catch(() => null),
        ]);
        setCities(unwrap(citiesRes).results || []);
        const raw = unwrap(vehiclesRes);
        const list = raw.results || raw.data?.results || (Array.isArray(raw) ? raw : []);
        setVehicles(list.map((v) => ({ id: v._id || v.id, name: v.name })).filter((v) => v.id));
      } catch (err) {
        toast.error(errorText(err, 'Failed to load cities'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));
  const city = useMemo(() => cities.find((c) => c.id === form.service_location_id) || null, [cities, form.service_location_id]);
  // Elite is offered only when the chosen city still has a free slot.
  const eliteOpen = Boolean(city && city.left > 0);

  const pickCity = (id) => {
    const next = cities.find((c) => c.id === id);
    setForm((prev) => ({
      ...prev,
      service_location_id: id,
      plan: prev.plan === 'prime' && !(next && next.left > 0) ? 'lower' : prev.plan,
    }));
  };

  const plans = [
    { key: 'lower', label: 'Basic', note: 'Free plan' },
    { key: 'middle', label: 'Pro', note: 'Paid plan, given by admin' },
    ...(eliteOpen ? [{ key: 'prime', label: 'Elite', note: `${city.left} slot${city.left === 1 ? '' : 's'} left in ${city.name}` }] : []),
  ];

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return toast.error('Enter the name');
    if (!/^\d{10}$/.test(form.phone.trim())) return toast.error('Enter a 10 digit mobile number');
    if (form.password.length < 6) return toast.error('Password must be at least 6 characters');
    if (form.password !== form.password_confirmation) return toast.error('Passwords do not match');
    if (!form.service_location_id) return toast.error('Pick the city');

    try {
      setSaving(true);
      const body = { ...form, phone: form.phone.trim() };
      if (form.plan === 'lower') delete body.plan_days;
      await api.post('/admin/driver-network/elite-drivers', body);
      toast.success('Driver created');
      navigate('/admin/elite/drivers');
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === 'ELITE_SLOTS_FULL') {
        toast.error('The last Elite slot was just taken. Choose Pro or Basic.');
        const res = await api.get('/admin/driver-network/cities').catch(() => null);
        if (res) setCities(unwrap(res).results || []);
        set('plan', 'middle');
      } else {
        toast.error(errorText(err, 'Failed to create driver'));
      }
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
      <form onSubmit={submit} className="max-w-[1000px] mx-auto p-4 md:p-8 space-y-8 pb-32">
        <div className="flex items-center gap-3">
          <UserPlus className="text-indigo-600" />
          <div>
            <h1 className="text-xl font-black text-slate-900">Add Driver with Plan</h1>
            <p className="text-xs text-slate-500">
              The driver logs in on the driver app with this mobile number and an OTP. Elite shows only when the city has a free slot.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <h2 className="text-sm font-black text-slate-800">Driver</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label="Name *">
              <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" />
            </Field>
            <Field label="Mobile number *" hint="10 digits. This is the login number.">
              <input
                className={inputClass}
                inputMode="numeric"
                maxLength={10}
                value={form.phone}
                onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))}
                placeholder="10 digit mobile number"
              />
            </Field>
            <Field label="Email">
              <input className={inputClass} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@gmail.com" />
            </Field>
            <span />
            <Field label="Password *" hint="Kept on the admin record. The app uses OTP.">
              <input className={inputClass} type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Minimum 6 characters" />
            </Field>
            <Field label="Confirm password *">
              <input
                className={inputClass}
                type="password"
                value={form.password_confirmation}
                onChange={(e) => set('password_confirmation', e.target.value)}
                placeholder="Re-enter password"
              />
            </Field>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <h2 className="text-sm font-black text-slate-800">City and plan</h2>
          <Field label="City *" hint="Elite slots are counted per city, so pick the city first.">
            <select className={inputClass} value={form.service_location_id} onChange={(e) => pickCity(e.target.value)}>
              <option value="">Select city</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (Elite: {c.left} of {c.limit} left)
                </option>
              ))}
            </select>
          </Field>

          {form.service_location_id && (
            <div className="space-y-3">
              <span className="text-[13px] font-bold text-slate-700 block">Plan</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {plans.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => set('plan', p.key)}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      form.plan === p.key ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-black text-slate-800">
                      {p.key === 'prime' && <Gem size={14} className="text-indigo-600" />}
                      {p.label}
                    </span>
                    <span className="text-[11px] text-slate-500">{p.note}</span>
                  </button>
                ))}
              </div>
              {!eliteOpen && (
                <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No Elite slot is left in {city?.name}. Only Pro and Basic can be given. To add an Elite driver here, raise this city's limit or remove a slot in Elite Slots.
                </p>
              )}
              {form.plan !== 'lower' && (
                <Field label="Plan valid for (days)">
                  <input
                    className={`${inputClass} max-w-[200px]`}
                    type="number"
                    min="1"
                    value={form.plan_days}
                    onChange={(e) => set('plan_days', e.target.value)}
                  />
                </Field>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <h2 className="text-sm font-black text-slate-800">Vehicle (optional)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field label="Vehicle type">
              <select className={inputClass} value={form.vehicle_type_id} onChange={(e) => set('vehicle_type_id', e.target.value)}>
                <option value="">Select</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Plate number">
              <input className={inputClass} value={form.vehicle_number} onChange={(e) => set('vehicle_number', e.target.value.toUpperCase())} placeholder="DL1RT1234" />
            </Field>
            <Field label="Brand / Make">
              <input className={inputClass} value={form.vehicle_make} onChange={(e) => set('vehicle_make', e.target.value)} placeholder="e.g. Maruti Suzuki" />
            </Field>
            <Field label="Model">
              <input className={inputClass} value={form.vehicle_model} onChange={(e) => set('vehicle_model', e.target.value)} placeholder="Swift, Bolt" />
            </Field>
            <Field label="Colour">
              <input className={inputClass} value={form.vehicle_color} onChange={(e) => set('vehicle_color', e.target.value)} placeholder="White, Black" />
            </Field>
          </div>
          <p className="text-[11px] text-slate-400">KYC documents can be added later from the driver's details page.</p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          Create driver
        </button>
      </form>
    </div>
  );
};

export default EliteDriverCreate;
