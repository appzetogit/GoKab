import React, { useEffect, useState } from 'react';
import { Layers, Loader2, Plus, Save, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';
import { adminService } from '../../services/adminService.js';

const KINDS = [
  ['default', 'All rides'],
  ['city', 'City rides only'],
  ['outstation', 'Outstation rides only'],
];

const MODES = [
  ['off', 'Off', 'Rides are sent as before: Elite, then Pro, then Basic.'],
  ['shadow', 'Test', 'Rides are sent as before. The server log shows whom these steps would have asked.'],
  ['on', 'On', 'New customer rides are sent by these steps.'],
];

const RequestSteps = () => {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('off');
  const [savedMode, setSavedMode] = useState('off');
  const [steps, setSteps] = useState({});
  const [radius, setRadius] = useState('');
  const [plans, setPlans] = useState([]);
  const [kind, setKind] = useState('default');

  useEffect(() => {
    (async () => {
      try {
        const [settingsRes, plansRes] = await Promise.all([
          api.get('/admin/driver-network/settings'),
          adminService.getSubscriptionPlans(),
        ]);
        const settings = settingsRes.data?.settings || settingsRes.settings || {};
        setMode(settings.request_steps_mode || 'off');
        setSavedMode(settings.request_steps_mode || 'off');
        setSteps(settings.request_steps || {});
        setRadius(settings.all_locations_radius_km ?? '');
        const list = plansRes?.data?.results || plansRes?.results || [];
        setPlans(Array.isArray(list) ? list : []);
      } catch (err) {
        console.error(err);
        setFailed(true);
        toast.error('Failed to load request steps');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current = steps[kind] || [];
  const setCurrent = (list) => setSteps((prev) => ({ ...prev, [kind]: list }));
  const change = (index, patch) => setCurrent(current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const move = (index, by) => {
    const list = [...current];
    [list[index], list[index + by]] = [list[index + by], list[index]];
    setCurrent(list);
  };
  const togglePlan = (index, id) => {
    const ids = current[index].plan_ids || [];
    change(index, { plan_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  };

  // A chosen plan stays listed even when it is off, so it can be unticked.
  const chosen = new Set(current.flatMap((step) => step.plan_ids || []));
  const shownPlans = plans.filter((plan) => plan.is_active !== false || chosen.has(plan._id));
  const missing = current.length ? shownPlans.filter((plan) => !chosen.has(plan._id)) : [];

  const save = async () => {
    if (mode === 'on' && savedMode !== 'on' && !window.confirm('Send all new customer rides by these steps from now on?')) return;
    try {
      setSaving(true);
      const body = Object.fromEntries(
        KINDS.map(([key]) => [
          key,
          (steps[key] || []).map((step) => ({ ...step, minutes: Number(step.minutes), radius_km: Number(step.radius_km) || null })),
        ]),
      );
      await api.patch('/admin/driver-network/settings', { request_steps_mode: mode, request_steps: body });
      setSavedMode(mode);
      toast.success('Request steps saved');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.message || err?.message || 'Failed to save');
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
  // Saving over settings that never loaded would wipe them.
  if (failed) return <div className="p-8 text-sm text-slate-600">Could not load request steps. Reload the page to try again.</div>;

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      <div className="max-w-[1200px] mx-auto p-4 md:p-8 space-y-6 pb-32">
        <div className="flex items-center gap-3">
          <Layers className="text-indigo-600" />
          <div>
            <h1 className="text-xl font-black text-slate-900">Request Steps</h1>
            <p className="text-xs text-slate-500">
              Which plans get a customer ride first, and for how long. A plan keeps the ride open to it until somebody takes it or the search ends.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          {MODES.map(([value, label, hint]) => (
            <label key={value} className={`flex gap-3 p-4 rounded-xl border cursor-pointer ${mode === value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>
              <input type="radio" name="mode" checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
              <span>
                <span className="text-sm font-bold text-slate-800 block">{label}</span>
                <span className="text-[11px] text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-6 space-y-5">
          <div className="flex flex-wrap gap-2">
            {KINDS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setKind(key)}
                className={`px-4 py-2 rounded-lg text-xs font-bold ${kind === key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                {label} ({(steps[key] || []).length})
              </button>
            ))}
          </div>
          {kind !== 'default' && (
            <p className="text-xs text-slate-500">Leave empty to use the steps from &quot;All rides&quot;.</p>
          )}

          {current.map((step, index) => (
            <div key={index} className="border border-slate-200 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-slate-800">Step {index + 1}</span>
                <div className="flex gap-1">
                  <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} className="p-2 disabled:opacity-30"><ArrowUp size={16} /></button>
                  <button type="button" aria-label="Move down" disabled={index === current.length - 1} onClick={() => move(index, 1)} className="p-2 disabled:opacity-30"><ArrowDown size={16} /></button>
                  <button type="button" aria-label="Remove step" onClick={() => setCurrent(current.filter((_, i) => i !== index))} className="p-2 text-rose-600"><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {shownPlans.map((plan) => (
                  <label key={plan._id} className="flex items-center gap-2 text-xs font-bold text-slate-700 bg-slate-50 px-3 py-2 rounded-lg cursor-pointer">
                    <input type="checkbox" checked={(step.plan_ids || []).includes(plan._id)} onChange={() => togglePlan(index, plan._id)} />
                    {plan.name}{plan.is_default ? ' (default)' : ''}{plan.is_active === false ? ' (off)' : ''}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="text-xs font-bold text-slate-700">
                  Minutes
                  <input type="number" min="0.5" step="0.5" value={step.minutes ?? ''} onChange={(e) => change(index, { minutes: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg py-2 px-3" />
                </label>
                <label className="text-xs font-bold text-slate-700">
                  Radius (km)
                  <input type="number" min="0" value={step.radius_km ?? ''} placeholder={`Empty = All Locations radius (${radius || 'search radius'})`} onChange={(e) => change(index, { radius_km: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-lg py-2 px-3" />
                </label>
              </div>
            </div>
          ))}

          <button type="button" onClick={() => setCurrent([...current, { plan_ids: [], minutes: 2, radius_km: null }])} className="inline-flex items-center gap-2 text-sm font-bold text-indigo-600">
            <Plus size={16} /> Add step
          </button>

          {missing.length > 0 && (
            <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              In no step, so these drivers will get no customer rides here: {missing.map((plan) => plan.name).join(', ')}
            </p>
          )}
          <ul className="text-[11px] text-slate-500 list-disc pl-4 space-y-1">
            <li>A step with no driver to ask, or where everyone says no, passes to the next step at once.</li>
            <li>The last step must include the default plan.</li>
            <li>Route mode drivers are asked for rides on their route, at any distance.</li>
          </ul>
        </div>

        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save request steps
        </button>
      </div>
    </div>
  );
};

export default RequestSteps;
