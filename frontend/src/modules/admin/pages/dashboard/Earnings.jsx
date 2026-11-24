import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, Loader2, Table2, X } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};
const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const PARTS = [
  { key: 'sales', label: 'Plan sales', color: '#4f46e5' },
  { key: 'commission', label: 'Commission', color: '#d97706' },
  { key: 'fees', label: 'Fees', color: '#0d9488' },
];

/** Today in India as YYYY-MM-DD, moved by whole days. */
const day = (offset = 0) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const monthStart = (back = 0) => {
  const [year, month] = day().split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 - back, 1)).toISOString().slice(0, 10);
};
const dayBefore = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400e3).toISOString().slice(0, 10);
const PERIODS = [
  ['today', 'Today', () => [day(), day()]],
  ['7d', '7 days', () => [day(-6), day()]],
  ['month', 'This month', () => [monthStart(), day()]],
  ['last', 'Last month', () => [monthStart(1), dayBefore(monthStart())]],
  ['year', 'This year', () => [`${day().slice(0, 4)}-01-01`, day()]],
];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const Card = ({ label, value, note, tone = 'text-slate-500' }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-4">
    <span className="text-xs text-slate-500 block">{label}</span>
    <span className="text-2xl font-black text-slate-900 tabular-nums">{value}</span>
    {note && <span className={`block text-[11px] font-bold ${tone}`}>{note}</span>}
  </div>
);

/** One stacked bar per row. Every value is written out too, so no colour has to be read alone. */
const Bars = ({ rows, onPick }) => {
  const max = Math.max(...rows.map((row) => PARTS.reduce((sum, part) => sum + Math.max(0, row[part.key]), 0)), 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-4">
        {PARTS.map((part) => (
          <span key={part.key} className="inline-flex items-center gap-2 text-xs text-slate-600">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: part.color }} />
            {part.label}
          </span>
        ))}
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id || row.name}>
            <button
              type="button"
              onClick={() => onPick(row)}
              className="w-full text-left rounded-xl p-2 -mx-2 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600"
            >
              <span className="flex items-baseline justify-between gap-3 mb-1.5">
                <span className="text-sm font-bold text-slate-800">
                  {row.name} <span className="font-medium text-xs text-slate-500">{row.drivers} drivers</span>
                </span>
                <span className="text-sm font-black text-slate-900 tabular-nums">{money(row.total)}</span>
              </span>
              <span className="flex gap-[2px] h-5 bg-slate-100 rounded overflow-hidden">
                {PARTS.filter((part) => row[part.key] > 0).map((part) => (
                  <span
                    key={part.key}
                    title={`${part.label}: ${money(row[part.key])}`}
                    style={{ width: `${max > 0 ? (row[part.key] / max) * 100 : 0}%`, backgroundColor: part.color }}
                  />
                ))}
              </span>
              <span className="block mt-1 text-[11px] text-slate-500 tabular-nums">
                {PARTS.filter((part) => row[part.key]).map((part) => `${part.label} ${money(row[part.key])}`).join(' · ') || 'No earnings in this period'}
                {row.free_count > 0 ? ` · ${row.free_count} given free` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const COLUMNS = [
  ['drivers', 'Drivers'], ['sales_count', 'Plans sold'], ['free_count', 'Given free'], ['sales', 'Plan sales', true],
  ['rides', 'Rides'], ['commission', 'Commission', true], ['fees', 'Fees', true], ['total', 'Total', true],
];

const Grid = ({ rows, summary, heading, onPick }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm min-w-[780px] tabular-nums">
      <thead>
        <tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
          <th className="p-3 text-left">{heading}</th>
          {COLUMNS.map(([key, label]) => <th key={key} className="p-3 text-right">{label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id || row.name} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="p-3">
              <button type="button" onClick={() => onPick(row)} className="font-bold text-slate-800 hover:text-indigo-600">{row.name}</button>
            </td>
            {COLUMNS.map(([key, , isMoney]) => <td key={key} className="p-3 text-right text-slate-700">{isMoney ? money(row[key]) : row[key]}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-black text-slate-900">
          <td className="p-3">Total</td>
          {COLUMNS.map(([key, , isMoney]) => <td key={key} className="p-3 text-right">{isMoney ? money(summary[key]) : summary[key]}</td>)}
        </tr>
      </tfoot>
    </table>
  </div>
);

const Earnings = () => {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const custom = DAY_PATTERN.test(params.get('from') || '') && DAY_PATTERN.test(params.get('to') || '');
  const period = custom ? 'custom' : PERIODS.some(([key]) => key === params.get('period')) ? params.get('period') : 'month';
  const [from, to] = custom ? [params.get('from'), params.get('to')] : PERIODS.find(([key]) => key === period)[2]();
  const state = params.get('state') || '';
  const cityId = params.get('cityId') || '';
  const planId = params.get('planId') || '';
  const tab = params.get('tab') === 'states' ? 'states' : 'plans';
  const view = params.get('view') === 'table' ? 'table' : 'graph';

  const change = (patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    let live = true;
    const query = { from, to };
    if (state) query.state = state;
    if (cityId) query.cityId = cityId;
    if (planId) query.planId = planId;
    setLoading(true);
    api
      .get('/admin/driver-network/earnings', { params: query })
      .then((res) => {
        if (!live) return;
        setData(unwrap(res));
        setError('');
      })
      .catch((err) => live && setError(err?.response?.data?.message || err?.message || 'Failed to load earnings'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [from, to, state, cityId, planId]);

  const options = data?.options || { plans: [], states: [], cities: [] };
  const cities = options.cities.filter((city) => !state || city.state === (state === 'none' ? '' : state));
  const chips = [
    state && ['State', state === 'none' ? 'State not set' : state, { state: '', cityId: '' }],
    cityId && ['City', options.cities.find((city) => city.id === cityId)?.name || 'City', { cityId: '' }],
    planId && ['Plan', options.plans.find((plan) => plan.id === planId)?.name || 'Plan', { planId: '' }],
  ].filter(Boolean);

  const summary = data?.summary;
  const rows = (tab === 'plans' ? data?.plans : data?.states) || [];
  // Plan → its states; state → its plans.
  const pick = (row) => {
    if (tab === 'plans') {
      if (row.id) change({ planId: row.id, tab: 'states' });
    } else {
      change({ state: row.id, cityId: '', tab: '' });
    }
  };
  const changeNote =
    summary?.change_percent == null
      ? 'Nothing earned in the period before'
      : `${summary.change_percent >= 0 ? '▲' : '▼'} ${Math.abs(summary.change_percent)}% than the period before`;
  const toggle = (active) => `px-4 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-2 ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`;

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      <div className="max-w-[1200px] mx-auto p-4 md:p-8 space-y-5 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-slate-900">Earnings</h1>
            <p className="text-xs text-slate-500">What the company earned: plans sold, ride commission and fees.</p>
          </div>
          <Link to="/admin/earnings/rides" className="text-xs font-bold text-indigo-600">Ride by ride list</Link>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            {PERIODS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={period === key} onClick={() => change({ period: key === 'month' ? '' : key, from: '', to: '' })} className={toggle(period === key)}>
                {label}
              </button>
            ))}
            <label className="text-xs text-slate-500 inline-flex items-center gap-2">
              From
              <input type="date" value={from} max={to} onChange={(event) => event.target.value && change({ from: event.target.value, to: event.target.value > to ? event.target.value : to, period: '' })} className="border border-slate-200 rounded-lg py-1.5 px-2" />
            </label>
            <label className="text-xs text-slate-500 inline-flex items-center gap-2">
              To
              <input type="date" value={to} min={from} max={day()} onChange={(event) => event.target.value && change({ from, to: event.target.value, period: '' })} className="border border-slate-200 rounded-lg py-1.5 px-2" />
            </label>
            {loading && <Loader2 size={16} className="animate-spin text-indigo-600" />}
          </div>
          <div className="flex flex-wrap gap-3">
            <select aria-label="State" value={state} onChange={(event) => change({ state: event.target.value, cityId: '' })} className="border border-slate-200 rounded-lg py-2 px-3 text-sm">
              <option value="">All states</option>
              {options.states.map((item) => <option key={item} value={item}>{item}</option>)}
              <option value="none">State not set</option>
            </select>
            <select aria-label="City" value={cityId} onChange={(event) => change({ cityId: event.target.value })} className="border border-slate-200 rounded-lg py-2 px-3 text-sm">
              <option value="">All cities</option>
              {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
            <select aria-label="Plan" value={planId} onChange={(event) => change({ planId: event.target.value })} className="border border-slate-200 rounded-lg py-2 px-3 text-sm">
              <option value="">All plans</option>
              {options.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map(([kind, label, patch]) => (
                <button key={kind} type="button" aria-label={`Remove ${kind} filter`} onClick={() => change(patch)} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold">
                  {kind}: {label} <X size={12} />
                </button>
              ))}
              <button type="button" onClick={() => change({ state: '', cityId: '', planId: '' })} className="text-xs font-bold text-slate-500">Clear all</button>
            </div>
          )}
        </div>

        {error && <p className="text-sm font-bold text-rose-600 bg-rose-50 rounded-xl p-4">{error}</p>}

        {summary && !error && (
          <>
            {data.test_payments && (
              <p className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                Plan payments are in Razorpay test mode, so plan sales are not real money.
              </p>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card label="Total earned" value={money(summary.total)} note={changeNote} tone={summary.change_percent == null ? 'text-slate-400' : summary.change_percent >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
              <Card label="Plan sales" value={money(summary.sales)} note={`${summary.sales_count} sold, ${summary.free_count} given free`} />
              <Card label="Ride commission" value={money(summary.commission)} note={`${summary.rides} rides`} />
              <Card label="Fees" value={money(summary.fees)} note="Leads, ride accept, paid offers" />
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-6 space-y-5">
              <div className="flex flex-wrap justify-between gap-3">
                <div role="tablist" aria-label="Break down by" className="flex gap-2">
                  {[['plans', 'Plan wise'], ['states', 'State wise']].map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => change({ tab: key === 'plans' ? '' : key })} className={toggle(tab === key)}>{label}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button type="button" aria-pressed={view === 'graph'} onClick={() => change({ view: '' })} className={toggle(view === 'graph')}><BarChart3 size={14} /> Graph</button>
                  <button type="button" aria-pressed={view === 'table'} onClick={() => change({ view: 'table' })} className={toggle(view === 'table')}><Table2 size={14} /> Table</button>
                </div>
              </div>
              {rows.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">No earnings for this choice.</p>
              ) : view === 'graph' ? (
                <Bars rows={rows} onPick={pick} />
              ) : (
                <Grid rows={rows} summary={summary} heading={tab === 'plans' ? 'Plan' : 'State'} onPick={pick} />
              )}
              <p className="text-[11px] text-slate-400">
                State is the driver&apos;s city today. Commission goes to the plan the driver was on when the ride ended. Click a row to look inside it.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Earnings;
