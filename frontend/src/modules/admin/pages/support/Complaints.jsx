import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Plus, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};
const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;
const when = (value) =>
  value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

const TABS = [['user_on_driver', 'Rider on driver'], ['driver_on_user', 'Driver on rider']];
const STATUS = {
  new: ['New', 'bg-rose-50 text-rose-700'],
  reviewing: ['Looking into it', 'bg-amber-50 text-amber-800'],
  resolved: ['Resolved', 'bg-emerald-50 text-emerald-700'],
};
const Badge = ({ status }) => <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap ${STATUS[status]?.[1] || ''}`}>{STATUS[status]?.[0] || status}</span>;

const ownerLine = (owner) => {
  if (!owner || owner.kind === 'self') return 'Own boss';
  return [owner.name, owner.org, owner.plan].filter(Boolean).join(' · ');
};

const Field = ({ label, children }) => (
  <div className="text-xs">
    <span className="block text-slate-400">{label}</span>
    <span className="font-bold text-slate-800 break-words">{children || '-'}</span>
  </div>
);

const Panel = ({ item, onClose, onSaved }) => {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState(item.status);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    const body = {};
    if (status !== item.status) body.status = status;
    if (note.trim()) body.note = note.trim();
    if (!Object.keys(body).length) return;
    try {
      setSaving(true);
      onSaved(unwrap(await api.patch(`/admin/complaints/${encodeURIComponent(item.id)}`, body)));
      setNote('');
      toast.success('Saved');
    } catch (err) {
      toast.error(errorText(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const onDriver = item.direction === 'user_on_driver';
  const { owner } = item;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Complaint" className="w-full max-w-xl h-full bg-white overflow-y-auto p-5 space-y-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              {item.safety && <ShieldAlert size={18} className="text-rose-600" aria-label="Safety" />} {item.reason}
            </h2>
            <p className="text-xs text-slate-500">{when(item.createdAt)} · {onDriver ? 'Rider reported the driver' : 'Driver reported the rider'}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>

        {item.message && <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-4 whitespace-pre-wrap break-words">{item.message}</p>}

        <section className="space-y-2">
          <h3 className="text-sm font-black text-slate-900">Driver {onDriver && <span className="font-medium text-xs text-rose-700">reported {item.counts?.person || 1} time(s)</span>}</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">{item.driver.name}</Field>
            <Field label="Phone">{item.driver.phone}</Field>
            <Field label="Vehicle">{item.driver.vehicle}</Field>
            <Field label="Plan">{item.driver.plan}</Field>
          </div>
          <Link to={`/admin/drivers/${item.driver.id}`} className="text-xs font-bold text-indigo-600">Open driver details</Link>
        </section>

        <section className="space-y-2 bg-indigo-50/60 rounded-xl p-4">
          <h3 className="text-sm font-black text-slate-900">
            Owner of the driver {onDriver && item.counts?.owner > 1 && <span className="font-medium text-xs text-rose-700">{item.counts.owner} complaints in this owner&apos;s team</span>}
          </h3>
          {owner.kind === 'self' ? (
            <p className="text-xs text-slate-600">This driver works for themselves{owner.org ? ` (${owner.org})` : ''}.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={owner.kind === 'lead' ? 'Team lead' : 'Company owner'}>{owner.name}</Field>
                <Field label="Phone">{owner.phone}</Field>
                <Field label="Organisation">{owner.org}</Field>
                <Field label="Plan">{owner.plan}</Field>
              </div>
              {owner.driver_id && <Link to={`/admin/drivers/${owner.driver_id}`} className="text-xs font-bold text-indigo-600">Open owner details</Link>}
            </>
          )}
          {item.ride_by && <p className="text-xs text-slate-600">Ride was given by <b>{item.ride_by.name}</b> {item.ride_by.phone}</p>}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-black text-slate-900">Rider {!onDriver && <span className="font-medium text-xs text-rose-700">reported {item.counts?.person || 1} time(s)</span>}</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">{item.user.name}</Field>
            <Field label="Phone">{item.user.phone}</Field>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-black text-slate-900">Ride</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pickup">{item.ride.pickup}</Field>
            <Field label="Drop">{item.ride.drop}</Field>
            <Field label="Time">{when(item.ride.at)}</Field>
            <Field label="Fare">₹{Number(item.ride.fare || 0).toLocaleString('en-IN')}</Field>
            <Field label="Status when reported">{item.ride.status}</Field>
            <Field label="Ride id">{item.ride_id}</Field>
          </div>
        </section>

        <section className="space-y-3 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-black text-slate-900">What we did</h3>
          {item.notes.length === 0 && <p className="text-xs text-slate-400">Nothing yet.</p>}
          <ul className="space-y-2">
            {item.notes.map((entry, index) => (
              <li key={index} className="text-xs bg-slate-50 rounded-lg p-3">
                <span className="text-slate-500">{entry.admin} · {when(entry.at)}</span>
                {entry.status && <span className="ml-2"><Badge status={entry.status} /></span>}
                {entry.text && <p className="text-slate-800 mt-1 whitespace-pre-wrap break-words">{entry.text}</p>}
              </li>
            ))}
          </ul>
          <label className="block text-xs text-slate-500">
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 block w-full border border-slate-200 rounded-lg py-2 px-3 text-sm text-slate-800">
              {Object.entries(STATUS).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-500">
            Note for the team (the rider and driver never see it)
            <textarea value={note} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} className="mt-1 block w-full border border-slate-200 rounded-lg py-2 px-3 text-sm text-slate-800" />
          </label>
          <button type="button" onClick={save} disabled={saving || (status === item.status && !note.trim())} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </section>
      </aside>
    </div>
  );
};

const ReasonsEditor = ({ reasons, onClose, onSaved }) => {
  const [lists, setLists] = useState(reasons);
  const [saving, setSaving] = useState(false);
  const change = (side, index, patch) => setLists((prev) => ({ ...prev, [side]: prev[side].map((item, i) => (i === index ? { ...item, ...patch } : item)) }));

  const save = async () => {
    try {
      setSaving(true);
      onSaved(unwrap(await api.put('/admin/complaints/reasons', lists)));
      toast.success('Reasons saved');
    } catch (err) {
      toast.error(errorText(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
      <div className="grid md:grid-cols-2 gap-6">
        {[['user', 'Riders can choose'], ['driver', 'Drivers can choose']].map(([side, title]) => (
          <section key={side} className="space-y-2">
            <h2 className="text-sm font-black text-slate-900">{title}</h2>
            {lists[side].map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <input aria-label={`${title}: reason ${index + 1}`} value={item.text} maxLength={60} onChange={(event) => change(side, index, { text: event.target.value })} className="flex-1 border border-slate-200 rounded-lg py-2 px-3 text-sm" />
                <label className="text-[11px] text-slate-600 inline-flex items-center gap-1"><input type="checkbox" checked={item.safety} onChange={(event) => change(side, index, { safety: event.target.checked })} /> Safety</label>
                <button type="button" aria-label="Remove reason" onClick={() => setLists((prev) => ({ ...prev, [side]: prev[side].filter((_, i) => i !== index) }))} className="p-2 text-rose-600"><Trash2 size={15} /></button>
              </div>
            ))}
            {lists[side].length < 20 && (
              <button type="button" onClick={() => setLists((prev) => ({ ...prev, [side]: [...prev[side], { text: '', safety: false }] }))} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600"><Plus size={14} /> Add reason</button>
            )}
          </section>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">Changing a reason does not change old complaints. Safety ones are listed first.</p>
      <div className="flex gap-3">
        <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50">Save reasons</button>
        <button type="button" onClick={onClose} className="text-xs font-bold text-slate-500">Cancel</button>
      </div>
    </div>
  );
};

const Complaints = () => {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState('');
  const [editing, setEditing] = useState(false);

  const direction = params.get('tab') === 'driver_on_user' ? 'driver_on_user' : 'user_on_driver';
  const query = { status: params.get('status') || '', state: params.get('state') || '', reason: params.get('reason') || '', search: params.get('search') || '', page: params.get('page') || '' };
  const queryKey = JSON.stringify({ direction, ...query });

  const change = (patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
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
    const asked = Object.fromEntries(Object.entries(JSON.parse(queryKey)).filter(([, value]) => value));
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get('/admin/complaints', { params: asked })
        .then((res) => {
          if (!live) return;
          setData({ ...unwrap(res), direction: asked.direction });
          setError('');
        })
        .catch((err) => live && setError(errorText(err, 'Failed to load complaints')))
        .finally(() => live && setLoading(false));
    }, asked.search ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [queryKey]);

  const ready = data?.direction === direction;
  const rows = ready ? data.results : [];
  const meta = (ready && data.pagination) || { page: 1, totalPages: 1, total: 0 };
  const open = rows.find((row) => row.id === openId);
  const close = useCallback(() => setOpenId(''), []);
  // The list's counts stay; only what the admin changed is replaced.
  const saved = (next) => setData((prev) => ({ ...prev, results: prev.results.map((row) => (row.id === next.id ? { ...row, ...next } : row)) }));
  const reasonOptions = data?.reasons?.[direction === 'user_on_driver' ? 'user' : 'driver'] || [];

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      <div className="max-w-[1300px] mx-auto p-4 md:p-8 space-y-5 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-slate-900">Complaints</h1>
            <p className="text-xs text-slate-500">What riders and drivers reported about each other after a ride.</p>
          </div>
          {data?.reasons && <button type="button" onClick={() => setEditing((prev) => !prev)} className="rounded-lg bg-white border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700">Edit reasons</button>}
        </div>

        {editing && data?.reasons && (
          <ReasonsEditor
            reasons={data.reasons}
            onClose={() => setEditing(false)}
            onSaved={(reasons) => {
              setData((prev) => ({ ...prev, reasons }));
              setEditing(false);
            }}
          />
        )}

        <div role="tablist" aria-label="Complaints" className="flex flex-wrap gap-2">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={direction === key} onClick={() => change({ tab: key === 'user_on_driver' ? '' : key, reason: '' })} className={`px-5 py-2.5 rounded-xl text-sm font-bold border ${direction === key ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
              {label}{data?.open ? ` (${data.open[key]} open)` : ''}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
          <label className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input aria-label="Search complaints" value={query.search} onChange={(event) => change({ search: event.target.value })} placeholder="Name, phone, vehicle, owner or ride id" className="w-full border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm" />
          </label>
          <select aria-label="Status" value={query.status} onChange={(event) => change({ status: event.target.value })} className="border border-slate-200 rounded-lg py-2 px-3 text-sm">
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select aria-label="Reason" value={query.reason} onChange={(event) => change({ reason: event.target.value })} className="border border-slate-200 rounded-lg py-2 px-3 text-sm">
            <option value="">All reasons</option>
            {reasonOptions.map((item) => <option key={item.text} value={item.text}>{item.text}</option>)}
          </select>
          <select aria-label="State" value={query.state} onChange={(event) => change({ state: event.target.value })} className="border border-slate-200 rounded-lg py-2 px-3 text-sm">
            <option value="">All states</option>
            {(data?.states || []).map((item) => <option key={item} value={item}>{item}</option>)}
            <option value="none">State not set</option>
          </select>
          {loading && <Loader2 size={16} className="animate-spin text-indigo-600" />}
        </div>

        {error && <p className="text-sm font-bold text-rose-600 bg-rose-50 rounded-xl p-4">{error}</p>}

        {!error && ready && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  {['Reported by', 'About', 'Reason', 'Ride', 'Date', 'Status', ''].map((head) => <th key={head} className="p-4">{head}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const driverCell = (
                    <>
                      <span className="font-bold text-slate-800 block">{row.driver.name || 'No name'}</span>
                      <span className="text-xs text-slate-500 block">{[row.driver.phone, row.driver.vehicle].filter(Boolean).join(' · ')}</span>
                      <span className="text-[11px] font-bold text-indigo-600 block">Owner: {ownerLine(row.owner)}</span>
                    </>
                  );
                  const riderCell = (
                    <>
                      <span className="font-bold text-slate-800 block">{row.user.name || 'No name'}</span>
                      <span className="text-xs text-slate-500 block">{row.user.phone}</span>
                    </>
                  );
                  const onDriver = row.direction === 'user_on_driver';
                  return (
                    <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" onClick={() => setOpenId(row.id)}>
                      <td className="p-4">{onDriver ? riderCell : driverCell}</td>
                      <td className="p-4">
                        {onDriver ? driverCell : riderCell}
                        {row.counts?.person > 1 && <span className="text-[11px] font-bold text-rose-700">Reported {row.counts.person} times</span>}
                      </td>
                      <td className="p-4 font-bold text-slate-700">{row.safety && <ShieldAlert size={14} className="inline text-rose-600 mr-1" aria-label="Safety" />}{row.reason}</td>
                      <td className="p-4 text-xs text-slate-500">#{row.ride_id.slice(-6).toUpperCase()}</td>
                      <td className="p-4 text-xs text-slate-500">{when(row.createdAt)}</td>
                      <td className="p-4"><Badge status={row.status} /></td>
                      <td className="p-4"><button type="button" onClick={() => setOpenId(row.id)} className="text-xs font-bold text-indigo-600">Open</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="p-10 text-center text-sm text-slate-500">No complaints found.</p>}
          </div>
        )}

        {meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 text-sm">
            <button type="button" disabled={meta.page <= 1 || loading} onClick={() => change({ page: String(meta.page - 1) })} className="font-bold text-indigo-600 disabled:opacity-30">Previous</button>
            <span className="text-slate-500">Page {meta.page} of {meta.totalPages} ({meta.total})</span>
            <button type="button" disabled={meta.page >= meta.totalPages || loading} onClick={() => change({ page: String(meta.page + 1) })} className="font-bold text-indigo-600 disabled:opacity-30">Next</button>
          </div>
        )}
      </div>

      {open && <Panel key={open.id} item={open} onClose={close} onSaved={saved} />}
    </div>
  );
};

export default Complaints;
