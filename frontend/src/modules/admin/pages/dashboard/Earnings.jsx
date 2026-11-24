import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, Download, Loader2, Search, Table2, X } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};
const money = (value) => {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-24" → "24 Nov"; "2026-11" → "Nov 2026". */
const pointLabel = (key) => {
  const [year, month, date] = key.split('-');
  return date ? `${Number(date)} ${MONTHS[month - 1]}` : `${MONTHS[month - 1]} ${year}`;
};
const KIND_LABEL = {
  plan: 'Plan sold', ride: 'Ride commission', lead_contact_fee: 'Lead contact fee', feed_accept_fee: 'Ride accept fee', paid_offer: 'Paid offer', plan_refund: 'Plan refund',
};

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

/** The shape of a period in a card; the number beside it is the value. */
const Spark = ({ values, color }) => {
  const max = Math.max(...values, 0);
  if (values.length < 2 || max <= 0) return null;
  const line = values
    .map((value, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 116 + 2).toFixed(1)},${(30 - (Math.max(0, value) / max) * 26).toFixed(1)}`)
    .join('');
  return (
    <svg viewBox="0 0 120 32" preserveAspectRatio="none" className="w-full h-8 mt-2" aria-hidden="true">
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
};

const Card = ({ label, value, note, tone = 'text-slate-500', spark, color }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-4">
    <span className="text-xs text-slate-500 flex items-center gap-2">
      {color && <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />}
      {label}
    </span>
    <span className="text-2xl font-black text-slate-900 tabular-nums">{value}</span>
    {note && <span className={`block text-[11px] font-bold ${tone}`}>{note}</span>}
    {spark && <Spark values={spark} color={color || '#4f46e5'} />}
  </div>
);

// A fixed order checked for colour-blind readers, round the ring too. Three of the
// five are pale on white, so every slice also has its name and number beside it.
const SLICES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const REST_COLOR = '#94a3b8';
const percent = (value, all) => (all > 0 ? Math.round((Math.max(0, value) / all) * 100) : 0);

/**
 * Rows as slices, largest first; past five the rest are one. With five or fewer
 * things in all, each keeps its colour whatever is filtered.
 */
const toSlices = (rows, order) => {
  const ranked = rows.filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
  const fixed = order.length <= SLICES.length;
  const shown = ranked.length > SLICES.length ? ranked.slice(0, SLICES.length) : ranked;
  const slices = shown.map((row, i) => {
    const place = order.indexOf(row.id);
    return { ...row, color: fixed && place >= 0 ? SLICES[place] : SLICES[i], row };
  });
  const rest = ranked.slice(shown.length);
  if (rest.length) {
    slices.push({ id: 'rest', name: `Other ${rest.length}`, total: rest.reduce((sum, row) => sum + row.total, 0), color: REST_COLOR, row: null });
  }
  return slices;
};

const RING = { size: 200, radius: 78, stroke: 34 };

/** Shares of a whole, with the whole in the middle. The list beside it carries every value. */
const Donut = ({ slices, label, onPick }) => {
  const [over, setOver] = useState('');
  const all = slices.reduce((sum, slice) => sum + slice.total, 0);
  const { size, radius, stroke } = RING;
  const round = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 2 : 0;
  const hovered = slices.find((slice) => slice.id === over);
  let turned = 0;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[220px] mx-auto" role="img" aria-label={`${label}: ${slices.map((slice) => `${slice.name} ${percent(slice.total, all)}%`).join(', ')}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {slices.map((slice) => {
          const length = (slice.total / all) * round;
          const start = turned;
          turned += length;
          return (
            <circle
              key={slice.id || slice.name}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={over === slice.id ? stroke + 6 : stroke}
              strokeDasharray={`${Math.max(0.5, length - gap)} ${round}`}
              strokeDashoffset={-start}
              className={`motion-safe:transition-all ${slice.row && onPick ? 'cursor-pointer' : ''}`}
              onPointerEnter={() => setOver(slice.id)}
              onPointerLeave={() => setOver('')}
              onClick={() => slice.row && onPick?.(slice.row)}
            />
          );
        })}
      </g>
      <text x={size / 2} y={size / 2 - 6} textAnchor="middle" fontSize="12" fill="#475569">{(hovered?.name || 'Total').slice(0, 16)}</text>
      <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize="18" fontWeight="800" fill="#0f172a">{money(hovered ? hovered.total : all)}</text>
      {hovered && <text x={size / 2} y={size / 2 + 31} textAnchor="middle" fontSize="12" fill="#475569">{percent(hovered.total, all)}%</text>}
    </svg>
  );
};

const Change = ({ value }) =>
  value == null ? null : (
    <span className={`text-[11px] font-bold ${value >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{value >= 0 ? '▲' : '▼'} {Math.abs(value)}%</span>
  );

/** Ring and ranking side by side; each ranked row opens what is inside it. */
const Shares = ({ rows, order, label, onPick }) => {
  const slices = toSlices(rows, order);
  const colorOf = new Map(slices.map((slice) => [slice.id, slice.color]));
  const all = slices.reduce((sum, slice) => sum + slice.total, 0);
  const ranked = [...rows].sort((a, b) => b.total - a.total);
  const top = Math.max(ranked[0]?.total || 0, 0);
  return (
    <div className="grid md:grid-cols-[240px_1fr] gap-6 items-start">
      <div>
        <h2 className="text-sm font-black text-slate-900 mb-3 text-center">{label}</h2>
        {all > 0 ? <Donut slices={slices} label={label} onPick={onPick} /> : <p className="text-xs text-slate-500 text-center">Nothing earned yet.</p>}
      </div>
      <ol className="space-y-2">
        {ranked.map((row, i) => (
          <li key={row.id || row.name}>
            <button
              type="button"
              disabled={!row.id}
              onClick={() => onPick(row)}
              className="w-full text-left rounded-xl p-2 enabled:hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600"
            >
              <span className="flex items-baseline justify-between gap-3 mb-1.5">
                <span className="text-sm font-bold text-slate-800 inline-flex items-center gap-2">
                  <span className="w-5 text-slate-400 tabular-nums">{i + 1}</span>
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: colorOf.get(row.id) || REST_COLOR }} />
                  {row.name}
                  <span className="font-medium text-xs text-slate-500">{row.drivers} drivers</span>
                </span>
                <span className="text-sm font-black text-slate-900 tabular-nums whitespace-nowrap">
                  {money(row.total)} <span className="font-bold text-xs text-slate-500">{percent(row.total, all)}%</span> <Change value={row.change_percent} />
                </span>
              </span>
              <span className="block h-4 bg-slate-100 rounded overflow-hidden">
                <span
                  className="block h-full rounded-r motion-safe:transition-all motion-safe:duration-500"
                  style={{ width: `${top > 0 ? (Math.max(0, row.total) / top) * 100 : 0}%`, backgroundColor: colorOf.get(row.id) || REST_COLOR }}
                />
              </span>
              <span className="block mt-1 text-[11px] text-slate-500 tabular-nums">
                {PARTS.filter((part) => row[part.key]).map((part) => `${part.label} ${money(row[part.key])}`).join(' · ') || 'No earnings in this period'}
                {row.refunds ? ` · Refunds −${money(row.refunds)}` : ''}
                {row.free_count > 0 ? ` · ${row.free_count} given free` : ''}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
};

/** Where the money came from: the three parts, before refunds. */
const Sources = ({ summary }) => {
  const slices = PARTS.filter((part) => summary[part.key] > 0).map((part) => ({ id: part.key, name: part.label, total: summary[part.key], color: part.color, row: null }));
  const all = slices.reduce((sum, slice) => sum + slice.total, 0);
  if (!slices.length) return null;
  return (
    <section>
      <h2 className="text-sm font-black text-slate-900 mb-3">Where it came from</h2>
      <div className="grid sm:grid-cols-[200px_1fr] gap-4 items-center">
        <Donut slices={slices} label="Where it came from" />
        <ul className="space-y-2">
          {slices.map((slice) => (
            <li key={slice.id} className="flex items-center gap-2 text-sm text-slate-700 tabular-nums">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: slice.color }} />
              {slice.name} <b className="text-slate-900">{money(slice.total)}</b> {percent(slice.total, all)}%
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

/** Short facts worth reading first, each one taken straight from the numbers below. */
const factsOf = (data) => {
  const facts = [];
  const total = data.summary.total;
  const bestOf = (rows) => [...rows].filter((row) => row.id && row.id !== 'none' && row.total > 0).sort((a, b) => b.total - a.total)[0];
  const plan = bestOf(data.plans);
  if (plan && total > 0) facts.push(`${plan.name} plan brought ${Math.min(100, percent(plan.total, total))}% of earnings`);
  const states = bestOf(data.states);
  if (states && data.states.length > 1 && total > 0) facts.push(`${states.name} leads with ${money(states.total)}`);
  const best = bestOf(data.trend.points);
  if (best && data.trend.points.length > 1) facts.push(`Best ${data.trend.unit}: ${pointLabel(best.id)}, ${money(best.total)}`);
  const owed = data.settlement.wallets.from_drivers;
  if (owed > 0) facts.push(`Drivers owe ${money(owed)} now`);
  return facts;
};

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
                  {row.name} <span className="font-medium text-xs text-slate-500">{row.phone !== undefined ? [row.plan, row.city].filter(Boolean).join(' · ') : `${row.drivers} drivers`}</span>
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
                {row.refunds ? ` · Refunds −${money(row.refunds)}` : ''}
                {row.free_count > 0 ? ` · ${row.free_count} given free` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const CHART = { width: 720, height: 240, left: 56, right: 34, top: 12, bottom: 28 };

/** A round number at or above the largest value, so the axis reads 0, half, full. */
const niceTop = (value) => {
  if (value <= 0) return 100;
  const size = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((step) => step * size).find((step) => step >= value);
};

/** Total per day or month. Pointer and arrow keys read each point; the table view has every number. */
const Trend = ({ points }) => {
  const [at, setAt] = useState(null);
  const { width, height, left, right, top, bottom } = CHART;
  const max = niceTop(Math.max(...points.map((point) => point.total), 0));
  const x = (index) => (points.length === 1 ? (left + width - right) / 2 : left + (index / (points.length - 1)) * (width - left - right));
  const y = (value) => top + (1 - Math.max(0, value) / max) * (height - top - bottom);
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.total).toFixed(1)}`).join('');
  const every = Math.max(1, Math.ceil(points.length / 6));
  const point = at == null ? null : points[Math.min(at, points.length - 1)];
  const index = at == null ? 0 : Math.min(at, points.length - 1);

  const follow = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = (((event.clientX - box.left) / box.width) * width - left) / (width - left - right);
    setAt(Math.min(points.length - 1, Math.max(0, Math.round(share * (points.length - 1)))));
  };
  const onKey = (event) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!by) return;
    event.preventDefault();
    setAt((prev) => Math.min(points.length - 1, Math.max(0, (prev ?? (by > 0 ? -1 : points.length)) + by)));
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto touch-pan-y focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 rounded-lg"
        role="img"
        tabIndex={0}
        aria-label={`Net earned, ${pointLabel(points[0].id)} to ${pointLabel(points[points.length - 1].id)}. Use arrow keys to read each point.`}
        onPointerMove={follow}
        onPointerDown={follow}
        onPointerLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
        onKeyDown={onKey}
      >
        {[0, max / 2, max].map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#64748b">{money(tick)}</text>
          </g>
        ))}
        {points.map((item, i) => (i % every === 0 ? (
          <text key={item.id} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="#64748b">{pointLabel(item.id)}</text>
        ) : null))}
        <path d={line} fill="none" stroke={PARTS[0].color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.length === 1 && <circle cx={x(0)} cy={y(points[0].total)} r="4" fill={PARTS[0].color} />}
        {point && (
          <g>
            <line x1={x(index)} x2={x(index)} y1={top} y2={height - bottom} stroke="#94a3b8" strokeWidth="1" />
            <circle cx={x(index)} cy={y(point.total)} r="5" fill={PARTS[0].color} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      <div
        aria-live="polite"
        className={`absolute top-0 pointer-events-none bg-white border border-slate-200 rounded-xl shadow-md px-3 py-2 text-xs ${point ? '' : 'invisible'}`}
        style={{ left: `${(x(index) / width) * 100}%`, transform: index > points.length / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}
      >
        {point && (
          <>
            <span className="block font-bold text-slate-800">{pointLabel(point.id)}</span>
            <span className="block font-black text-slate-900 tabular-nums">{money(point.total)}</span>
            {PARTS.filter((part) => point[part.key]).map((part) => (
              <span key={part.key} className="flex items-center gap-1.5 text-slate-600 tabular-nums whitespace-nowrap">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: part.color }} /> {part.label} {money(point[part.key])}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

const DriverEntries = ({ driver }) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-black text-slate-900">{driver.name} <span className="font-medium text-slate-500">{driver.phone}</span></h2>
      <Link to={`/admin/drivers/${driver.id}`} className="text-xs font-bold text-indigo-600">Open driver details</Link>
    </div>
    {driver.entries.length === 0 ? (
      <p className="text-sm text-slate-500">Nothing earned from this driver in this period.</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[520px] tabular-nums">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
              <th className="p-3 text-left">Date</th><th className="p-3 text-left">What</th><th className="p-3 text-left">Plan then</th><th className="p-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {driver.entries.map((entry, index) => (
              <tr key={`${entry.at}-${index}`} className="border-b border-slate-100 text-slate-700">
                <td className="p-3">{new Date(entry.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="p-3">{KIND_LABEL[entry.kind] || entry.kind}</td>
                <td className="p-3">{entry.plan || '-'}</td>
                <td className="p-3 text-right font-bold">{money(entry.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    {driver.entries_total > driver.entries.length && (
      <p className="text-[11px] text-slate-500">Newest {driver.entries.length} of {driver.entries_total}. Choose a shorter period to see the rest.</p>
    )}
  </div>
);

/** How rides were paid: one bar, every number written beside it. */
const PaymentSplit = ({ payment }) => {
  const ways = [
    { key: 'cash', label: 'Cash', color: '#4f46e5', ...payment.cash },
    { key: 'online', label: 'Online', color: '#d97706', ...payment.online },
  ];
  const all = ways.reduce((sum, way) => sum + way.rides, 0);
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-black text-slate-900">Cash and online rides</h2>
      {all === 0 ? (
        <p className="text-xs text-slate-500">No rides in this choice.</p>
      ) : (
        <>
          <div className="flex gap-[2px] h-5 rounded overflow-hidden bg-slate-100">
            {ways.filter((way) => way.rides).map((way) => (
              <span key={way.key} title={`${way.label}: ${way.rides} rides`} style={{ width: `${(way.rides / all) * 100}%`, backgroundColor: way.color }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {ways.map((way) => (
              <li key={way.key} className="inline-flex items-center gap-2 text-xs text-slate-600 tabular-nums">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: way.color }} />
                <span><b className="text-slate-800">{way.label} {Math.round((way.rides / all) * 100)}%</b> · {way.rides} rides · Fare {money(way.fare)} · Commission {money(way.commission)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

const Settlement = ({ settlement }) => {
  const { wallets, withdrawals, rows, rows_total: total } = settlement;
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-black text-slate-900">Driver wallets now <span className="font-medium text-xs text-slate-500">not limited by the dates above</span></h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <Card label="Held for drivers" value={money(wallets.to_drivers)} note="Balance in their wallets" />
          <Card label="Drivers owe" value={money(wallets.from_drivers)} note="Wallets below zero" />
          <Card label="On hold" value={money(wallets.on_hold)} note="Kept aside for running rides" />
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-black text-slate-900">Withdrawals asked in this period</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <Card label="Waiting" value={money(withdrawals.pending.amount)} note={`${withdrawals.pending.count} requests`} />
          <Card label="Paid" value={money(withdrawals.completed.amount)} note={`${withdrawals.completed.count} requests`} />
          <Card label="Rejected" value={money(withdrawals.cancelled.amount)} note={`${withdrawals.cancelled.count} requests`} />
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-black text-slate-900">Largest wallet balances</h2>
        {rows.length === 0 ? (
          <p className="text-xs text-slate-500">Every wallet here is at zero.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px] tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                  <th className="p-3 text-left">Driver</th><th className="p-3 text-left">Plan</th><th className="p-3 text-right">Wallet</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 text-slate-700">
                    <td className="p-3">
                      <Link to={`/admin/drivers/${row.id}`} className="font-bold text-slate-800 hover:text-indigo-600">{row.name || 'No name'}</Link>
                      <span className="block text-[11px] text-slate-500">{row.phone}</span>
                    </td>
                    <td className="p-3">{row.plan || '-'}</td>
                    <td className="p-3 text-right font-bold">{row.balance < 0 ? `−${money(-row.balance)} (owes)` : money(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > rows.length && <p className="text-[11px] text-slate-500">Largest {rows.length} of {total}. The Excel file has the totals.</p>}
      </section>
    </div>
  );
};

/** Everything in the current choice as one workbook. */
const saveExcel = async (data) => {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  const sheet = (name, rows) => XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'Nothing in this choice' }]), name);
  const numbers = (row) => ({
    'Plans sold': row.sales_count, 'Plan sales': row.sales, Rides: row.rides, Commission: row.commission, Fees: row.fees, Refunds: row.refunds, Net: row.total,
  });
  const { summary, settlement, payment } = data;
  sheet('Summary', [
    { Item: 'From', Value: data.from }, { Item: 'To', Value: data.to },
    { Item: 'Plan sales', Value: summary.sales }, { Item: 'Commission', Value: summary.commission }, { Item: 'Fees', Value: summary.fees },
    { Item: 'Refunds', Value: summary.refunds }, { Item: 'Net earned', Value: summary.total }, { Item: 'Plans given free', Value: summary.free_count },
    { Item: 'Cash rides', Value: payment.cash.rides }, { Item: 'Online rides', Value: payment.online.rides },
    { Item: 'Held for drivers now', Value: settlement.wallets.to_drivers }, { Item: 'Drivers owe now', Value: settlement.wallets.from_drivers },
    { Item: 'Withdrawals waiting', Value: settlement.withdrawals.pending.amount }, { Item: 'Withdrawals paid', Value: settlement.withdrawals.completed.amount },
    ...(data.test_payments ? [{ Item: 'Note', Value: 'Plan payments are in Razorpay test mode' }] : []),
  ]);
  sheet('Dates', data.trend.points.map((row) => ({ Date: row.id, ...numbers(row) })));
  sheet('Plans', data.plans.map((row) => ({ Plan: row.name, Drivers: row.drivers, 'Given free': row.free_count, ...numbers(row) })));
  sheet('States', data.states.map((row) => ({ State: row.name, Drivers: row.drivers, 'Given free': row.free_count, ...numbers(row) })));
  sheet('Drivers', data.export.drivers.map((row) => ({ Driver: row.name, Phone: row.phone, 'Plan now': row.plan, City: row.city, ...numbers(row) })));
  sheet('Entries', data.export.entries.map((row) => ({
    Date: new Date(row.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), What: KIND_LABEL[row.kind] || row.kind, Driver: row.driver, Phone: row.phone,
    State: row.state, 'Plan then': row.plan, 'Ride paid by': row.payment_method, 'Ride id': row.ride_id, Amount: row.amount,
  })));
  XLSX.writeFile(book, `GoKab-earnings-${data.from}-to-${data.to}.xlsx`);
  return data.export.entries_total - data.export.entries.length;
};

const TABS = [['overview', 'Overview'], ['plans', 'Plan wise'], ['states', 'State wise'], ['drivers', 'Driver wise'], ['settlement', 'Settlement']];
const ROW_HEADING = { overview: 'Date', plans: 'Plan', states: 'State', drivers: 'Driver' };
// Plans sold and drivers are counts of the whole choice; a day or one driver has no driver count.
const COLUMNS_FOR = (tab) => (tab === 'overview' || tab === 'drivers' ? COLUMNS.filter(([key]) => !['drivers', 'free_count'].includes(key)) : COLUMNS);

const COLUMNS = [
  ['drivers', 'Drivers'], ['sales_count', 'Plans sold'], ['free_count', 'Given free'], ['sales', 'Plan sales', true],
  ['rides', 'Rides'], ['commission', 'Commission', true], ['fees', 'Fees', true], ['refunds', 'Refunds', true], ['total', 'Net', true],
];

const Grid = ({ rows, summary, heading, columns, onPick }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm min-w-[780px] tabular-nums">
      <thead>
        <tr className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
          <th className="p-3 text-left">{heading}</th>
          {columns.map(([key, label]) => <th key={key} className="p-3 text-right">{label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id || row.name} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="p-3">
              {onPick ? (
                <button type="button" onClick={() => onPick(row)} className="font-bold text-slate-800 hover:text-indigo-600 text-left">{row.name}</button>
              ) : (
                <span className="font-bold text-slate-800">{pointLabel(row.id)}</span>
              )}
              {row.phone !== undefined && <span className="block text-[11px] text-slate-500">{[row.phone, row.plan, row.city].filter(Boolean).join(' · ')}</span>}
            </td>
            {columns.map(([key, , isMoney]) => <td key={key} className="p-3 text-right text-slate-700">{isMoney ? money(row[key]) : row[key]}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-black text-slate-900">
          <td className="p-3">Total</td>
          {columns.map(([key, , isMoney]) => <td key={key} className="p-3 text-right">{isMoney ? money(summary[key]) : summary[key]}</td>)}
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
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');

  const custom = DAY_PATTERN.test(params.get('from') || '') && DAY_PATTERN.test(params.get('to') || '');
  const period = custom ? 'custom' : PERIODS.some(([key]) => key === params.get('period')) ? params.get('period') : 'month';
  const [from, to] = custom ? [params.get('from'), params.get('to')] : PERIODS.find(([key]) => key === period)[2]();
  const state = params.get('state') || '';
  const cityId = params.get('cityId') || '';
  const planId = params.get('planId') || '';
  const driverId = params.get('driverId') || '';
  const search = params.get('search') || '';
  const page = params.get('page') || '';
  const tab = TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'overview';
  const view = params.get('view') === 'table' ? 'table' : 'graph';

  const change = (patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        // Any other choice starts the driver list again.
        if (!('page' in patch)) next.delete('page');
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
    if (driverId) query.driverId = driverId;
    if (search) query.search = search;
    if (page) query.page = page;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get('/admin/driver-network/earnings', { params: query })
        .then((res) => {
          if (!live) return;
          setData(unwrap(res));
          setError('');
        })
        .catch((err) => live && setError(err?.response?.data?.message || err?.message || 'Failed to load earnings'))
        .finally(() => live && setLoading(false));
    }, search ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [from, to, state, cityId, planId, driverId, search, page]);

  const exportExcel = async () => {
    const query = { from, to, export: 'true' };
    for (const [key, value] of Object.entries({ state, cityId, planId, driverId })) if (value) query[key] = value;
    setSaving(true);
    setSaveNote('');
    try {
      const left = await saveExcel(unwrap(await api.get('/admin/driver-network/earnings', { params: query })));
      setSaveNote(left > 0 ? `${left} older entries did not fit. Choose a shorter period for them.` : '');
    } catch (err) {
      setSaveNote(err?.response?.data?.message || err?.message || 'Could not make the Excel file');
    } finally {
      setSaving(false);
    }
  };

  const options = data?.options || { plans: [], states: [], cities: [] };
  const cities = options.cities.filter((city) => !state || city.state === (state === 'none' ? '' : state));
  const chips = [
    state && ['State', state === 'none' ? 'State not set' : state, { state: '', cityId: '' }],
    cityId && ['City', options.cities.find((city) => city.id === cityId)?.name || 'City', { cityId: '' }],
    planId && ['Plan', options.plans.find((plan) => plan.id === planId)?.name || 'Plan', { planId: '' }],
    driverId && ['Driver', data?.driver?.name || 'Driver', { driverId: '' }],
  ].filter(Boolean);

  const summary = data?.summary;
  const points = data?.trend?.points || [];
  const rows = { overview: points, plans: data?.plans, states: data?.states, drivers: data?.drivers?.results }[tab] || [];
  const meta = data?.drivers?.pagination || { page: 1, totalPages: 1, total: 0 };
  // One step in each click: plan → state → drivers → that driver's entries.
  const pick = (row) => {
    if (!row.id) return;
    if (tab === 'plans') change({ planId: row.id, tab: state ? 'drivers' : 'states' });
    else if (tab === 'states') change({ state: row.id, cityId: '', tab: planId ? 'drivers' : 'plans' });
    else if (tab === 'drivers') change({ driverId: row.id });
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
          <div className="flex items-center gap-4">
            <Link to="/admin/earnings/rides" className="text-xs font-bold text-indigo-600">Ride by ride list</Link>
            <button type="button" disabled={saving || !data} onClick={exportExcel} className="inline-flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Excel
            </button>
          </div>
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
              <button type="button" onClick={() => change({ state: '', cityId: '', planId: '', driverId: '', search: '' })} className="text-xs font-bold text-slate-500">Clear all</button>
            </div>
          )}
        </div>

        {saveNote && <p role="status" className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">{saveNote}</p>}
        {error && <p className="text-sm font-bold text-rose-600 bg-rose-50 rounded-xl p-4">{error}</p>}

        {summary && !error && (
          <>
            {data.test_payments && (
              <p className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
                Plan payments are in Razorpay test mode, so plan sales are not real money.
              </p>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card label="Net earned" spark={points.map((point) => point.total)} value={money(summary.total)} note={changeNote} tone={summary.change_percent == null ? 'text-slate-400' : summary.change_percent >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
              <Card label="Plan sales" color={PARTS[0].color} spark={points.map((point) => point.sales)} value={money(summary.sales)} note={`${summary.sales_count} sold, ${summary.free_count} given free`} />
              <Card label="Ride commission" color={PARTS[1].color} spark={points.map((point) => point.commission)} value={money(summary.commission)} note={`${summary.rides} rides`} />
              <Card label="Fees" color={PARTS[2].color} spark={points.map((point) => point.fees)} value={money(summary.fees)} note="Leads, ride accept, paid offers" />
            </div>

            {factsOf(data).length > 0 && (
              <ul aria-label="Highlights" className="flex flex-wrap gap-2">
                {factsOf(data).map((fact) => (
                  <li key={fact} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-slate-700 tabular-nums">{fact}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-600 tabular-nums">
              Net earned = Plan sales {money(summary.sales)} + Commission {money(summary.commission)} + Fees {money(summary.fees)} − Refunds {money(summary.refunds)} = <b className="text-slate-900">{money(summary.total)}</b>
            </p>

            <div className="bg-white rounded-2xl border border-slate-200 p-4 md:p-6 space-y-5">
              <div className="flex flex-wrap justify-between gap-3">
                <div role="tablist" aria-label="Break down by" className="flex flex-wrap gap-2">
                  {TABS.map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => change({ tab: key === 'overview' ? '' : key })} className={toggle(tab === key)}>{label}</button>
                  ))}
                </div>
                <div className={`flex gap-2 ${tab === 'settlement' ? 'hidden' : ''}`}>
                  <button type="button" aria-pressed={view === 'graph'} onClick={() => change({ view: '' })} className={toggle(view === 'graph')}><BarChart3 size={14} /> Graph</button>
                  <button type="button" aria-pressed={view === 'table'} onClick={() => change({ view: 'table' })} className={toggle(view === 'table')}><Table2 size={14} /> Table</button>
                </div>
              </div>
              {tab === 'drivers' && !driverId && (
                <label className="relative block max-w-sm">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input aria-label="Search drivers" value={search} onChange={(event) => change({ search: event.target.value })} placeholder="Driver name or phone" className="w-full border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm" />
                </label>
              )}
              {tab === 'settlement' ? (
                <Settlement settlement={data.settlement} />
              ) : tab === 'drivers' && driverId ? (
                data.driver?.id === driverId ? <DriverEntries driver={data.driver} /> : <Loader2 size={18} className="animate-spin text-indigo-600" />
              ) : rows.length === 0 || (tab === 'overview' && view === 'graph' && !points.some((point) => point.total)) ? (
                <p className="p-8 text-center text-sm text-slate-500">No earnings for this choice.</p>
              ) : view === 'table' ? (
                <Grid rows={rows} summary={summary} heading={ROW_HEADING[tab]} columns={COLUMNS_FOR(tab)} onPick={tab === 'overview' ? null : pick} />
              ) : tab === 'overview' ? (
                <>
                  <Trend key={`${from}${to}`} points={points} />
                  <div className="grid lg:grid-cols-2 gap-8 items-start">
                    <Sources summary={summary} />
                    <PaymentSplit payment={data.payment} />
                  </div>
                </>
              ) : tab === 'drivers' ? (
                <Bars rows={rows.slice(0, 10)} onPick={pick} />
              ) : (
                <Shares
                  rows={rows}
                  order={tab === 'plans' ? options.plans.map((plan) => plan.id) : [...options.states, 'none']}
                  label={tab === 'plans' ? 'Share by plan' : 'Share by state'}
                  onPick={pick}
                />
              )}
              {tab === 'drivers' && !driverId && view === 'graph' && rows.length > 10 && <p className="text-[11px] text-slate-500">Top 10 here. The table lists every driver.</p>}
              {tab === 'drivers' && !driverId && view === 'table' && (search || meta.totalPages > 1) && (
                <p className="text-[11px] text-slate-500">Total is for every driver in this choice, not only the rows shown.</p>
              )}
              {tab === 'drivers' && !driverId && view === 'table' && meta.totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 text-sm">
                  <button type="button" disabled={meta.page <= 1 || loading} onClick={() => change({ page: String(meta.page - 1) })} className="font-bold text-indigo-600 disabled:opacity-30">Previous</button>
                  <span className="text-slate-500">Page {meta.page} of {meta.totalPages} ({meta.total})</span>
                  <button type="button" disabled={meta.page >= meta.totalPages || loading} onClick={() => change({ page: String(meta.page + 1) })} className="font-bold text-indigo-600 disabled:opacity-30">Next</button>
                </div>
              )}
              <p className="text-[11px] text-slate-400">
                Net = after refunds. State is the driver&apos;s city today. Commission goes to the plan the driver was on when the ride ended. Click a row to look inside it.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Earnings;
