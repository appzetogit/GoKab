import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Loader2, Search, X } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};
const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;
const day = (value) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

/** "3/10", "3" when there is no limit; red when over. */
const Count = ({ used, max }) => (
  <span className={max > 0 && used > max ? 'font-black text-rose-600' : 'font-bold text-slate-700'}>
    {max > 0 ? `${used}/${max}` : used}
  </span>
);

const Status = ({ approved, online, onRide }) => {
  const [label, tone] = !approved
    ? ['Not approved', 'bg-amber-50 text-amber-700']
    : onRide
      ? ['On ride', 'bg-indigo-50 text-indigo-700']
      : online
        ? ['Online', 'bg-emerald-50 text-emerald-700']
        : ['Offline', 'bg-slate-100 text-slate-500'];
  return <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${tone}`}>{label}</span>;
};

const FleetPanel = ({ driverId, onClose }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    api
      .get(`/admin/driver-network/drivers/${driverId}/fleet`)
      .then((res) => live && setData(unwrap(res)))
      .catch((err) => live && setError(errorText(err, 'Failed to load the team')));
    return () => {
      live = false;
    };
  }, [driverId]);

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Driver team and vehicles" className="w-full max-w-lg h-full bg-white overflow-y-auto p-5 space-y-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">{data?.driver?.name || 'Driver'}</h2>
            {data && (
              <p className="text-xs text-slate-500">
                {data.driver.phone}
                {data.plan ? ` · ${data.plan.name}${data.plan.valid_until ? ` till ${day(data.plan.valid_until)}` : ''}` : ''}
              </p>
            )}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        {!data && !error && <Loader2 className="w-7 h-7 text-indigo-600 animate-spin mx-auto" />}

        {data && (
          <>
            {data.team_of && <p className="text-xs font-bold text-indigo-700 bg-indigo-50 rounded-lg p-3">In {data.team_of.name}&apos;s team</p>}

            <section>
              <h3 className="text-sm font-black text-slate-800 mb-2">
                Team drivers {data.limits.can_manage_fleet || data.team.length ? <Count used={data.team.length} max={data.limits.can_manage_fleet ? data.limits.max_team : 0} /> : null}
              </h3>
              {!data.limits.can_manage_fleet && <p className="text-[11px] text-slate-500 mb-2">This plan does not include a team.</p>}
              {data.team.length === 0 ? (
                <p className="text-xs text-slate-400">No team drivers.</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {data.team.map((member) => (
                    <li key={member.id} className="flex items-center justify-between gap-3 p-3">
                      <span className="text-xs">
                        <Link to={`/admin/drivers/${member.id}`} className="font-bold text-slate-800 hover:text-indigo-600">{member.name}</Link>
                        <span className="block text-slate-500">{[member.phone, member.vehicle_number].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Status approved={member.approved} online={member.online} onRide={member.on_ride} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="text-sm font-black text-slate-800 mb-2">Vehicles <Count used={data.vehicle_count} max={data.limits.max_vehicles} /></h3>
              {data.vehicles.length === 0 ? (
                <p className="text-xs text-slate-400">No vehicles.</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {data.vehicles.map((vehicle) => (
                    <li key={vehicle.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                      <span>
                        <span className="font-bold text-slate-800">{vehicle.number || 'No number'}</span>
                        <span className="block text-slate-500">{[vehicle.model, vehicle.usage_type, vehicle.driver].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="font-bold capitalize text-slate-500">{vehicle.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.bills?.enforced && (
              <p className="text-xs text-slate-600">
                Bills this month: {data.bills.allowed ? <Count used={data.bills.used} max={data.bills.limit} /> : <b>not in plan</b>}
              </p>
            )}

            <Link to={`/admin/drivers/${data.driver.id}`} className="inline-block rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-700">Open full profile</Link>
          </>
        )}
      </aside>
    </div>
  );
};

/** A driver's team, opened under their row. */
const TeamRows = ({ driverId, columns }) => {
  const [team, setTeam] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api
      .get(`/admin/driver-network/drivers/${driverId}/fleet`)
      .then((res) => live && setTeam(unwrap(res).team || []))
      .catch((err) => live && setError(errorText(err, 'Failed to load the team')));
    return () => {
      live = false;
    };
  }, [driverId]);

  return (
    <tr className="bg-slate-50">
      <td colSpan={columns} className="px-4 pb-4 pt-1">
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {!team && !error && <Loader2 size={16} className="animate-spin text-indigo-600" />}
        {team && (
          <ul className="ml-8 border-l-2 border-indigo-200 pl-4 space-y-2">
            {team.length === 0 && <li className="text-xs text-slate-500">No team drivers.</li>}
            {team.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 text-xs">
                <Link to={`/admin/drivers/${member.id}`} className="font-bold text-slate-800 hover:text-indigo-600">{member.name || 'No name'}</Link>
                <span className="text-slate-500">{[member.phone, member.vehicle_number].filter(Boolean).join(' · ')}</span>
                <Status approved={member.approved} online={member.online} onRide={member.on_ride} />
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
};

const EMPTY_FILTERS = { search: '', cityId: '', online: false, expiring: false, includeTeam: false };

const PlanDrivers = () => {
  const [params, setParams] = useSearchParams();
  const planId = params.get('plan') || 'all';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [panelId, setPanelId] = useState('');
  const [openTeams, setOpenTeams] = useState([]);

  useEffect(() => {
    let live = true;
    const query = { page, limit: 20 };
    for (const [key, value] of Object.entries(filters)) if (value) query[key] = value;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/admin/driver-network/plans/${planId}/drivers`, { params: query });
        if (!live) return;
        setData({ ...unwrap(res), forPlan: planId });
        setError('');
      } catch (err) {
        if (live) setError(errorText(err, 'Failed to load drivers'));
      } finally {
        if (live) setLoading(false);
      }
    }, filters.search ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [planId, page, filters]);

  const change = (patch) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  };
  const openTab = (id) => {
    setPage(1);
    setOpenTeams([]);
    setError('');
    setParams(id === 'all' ? {} : { plan: id });
  };
  const toggleTeam = (id) => setOpenTeams((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const tabs = [
    { id: 'all', name: 'All', count: data?.tabs?.total },
    ...(data?.tabs?.plans || []),
  ];
  // The rows of the tab before are not shown under the new tab's name.
  const ready = data?.forPlan === planId;
  const rows = ready ? data.results || [] : [];
  const meta = (ready && data.pagination) || { page: 1, totalPages: 1, total: 0 };
  const heads = ['Driver', ...(planId === 'all' ? ['Plan'] : []), 'City', 'Plan till', 'Team', 'Vehicles', 'Status', ''];

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      <div className="max-w-[1300px] mx-auto p-4 md:p-8 space-y-5 pb-24">
        <div>
          <h1 className="text-xl font-black text-slate-900">Drivers by Plan</h1>
          <p className="text-xs text-slate-500">Choose a plan to see its drivers. Open a driver to see the team under them.</p>
        </div>

        <div role="tablist" aria-label="Plans" className="flex gap-2 overflow-x-auto pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={planId === tab.id}
              onClick={() => openTab(tab.id)}
              className={`shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold border ${planId === tab.id ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              {tab.badge_color_hex && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tab.badge_color_hex }} />}
              {tab.name}
              {tab.is_active === false ? ' (off)' : ''}
              {tab.count != null && <span className={planId === tab.id ? 'text-indigo-100' : 'text-slate-400'}>({tab.count})</span>}
            </button>
          ))}
        </div>

        {ready && data.plan?.is_default && (
          <p className="text-xs text-slate-500">This is the default plan: every driver without a running subscription is here.</p>
        )}

        {ready && data.summary && (
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Drivers', data.summary.drivers],
              ['Online now', data.summary.online],
              [`Ending in ${data.summary.expiring_days} days`, data.summary.expiring],
            ].map(([label, value]) => (
              <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4">
                <span className="text-xs text-slate-500 block">{label}</span>
                <span className="text-2xl font-black text-slate-900">{value}</span>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center gap-4">
          <label className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input aria-label="Search drivers" value={filters.search} onChange={(event) => change({ search: event.target.value })} placeholder="Name, phone or vehicle number" className="w-full border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm" />
          </label>
          <select aria-label="City" value={filters.cityId} onChange={(event) => change({ cityId: event.target.value })} className="border border-slate-200 rounded-lg py-2 px-3 text-sm">
            <option value="">All cities</option>
            {(data?.cities || []).map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
          </select>
          {[
            ['online', 'Online only'],
            ['expiring', 'Ending soon'],
            ['includeTeam', 'Show team drivers'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input type="checkbox" checked={filters[key]} onChange={(event) => change({ [key]: event.target.checked })} />
              {label}
            </label>
          ))}
          {loading && <Loader2 size={16} className="animate-spin text-indigo-600" />}
        </div>

        {error && <p className="text-sm font-bold text-rose-600 bg-rose-50 rounded-xl p-4">{error}</p>}

        {!error && ready && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  {heads.map((head) => <th key={head} className="p-4">{head}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const open = openTeams.includes(row.id);
                  return (
                    <React.Fragment key={row.id}>
                      <tr className="border-b border-slate-50">
                        <td className="p-4">
                          <div className="flex items-start gap-2">
                            {row.team_count > 0 ? (
                              <button type="button" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} team of ${row.name}`} onClick={() => toggleTeam(row.id)} className="p-1 rounded hover:bg-slate-100 text-indigo-600">
                                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                            ) : (
                              <span className="w-6" />
                            )}
                            <div>
                              <button type="button" onClick={() => setPanelId(row.id)} className="font-bold text-slate-800 hover:text-indigo-600 block text-left">{row.name || 'No name'}</button>
                              <span className="text-xs text-slate-500">{row.phone}</span>
                              {row.team_of && <span className="block text-[11px] font-bold text-indigo-600">{row.team_of}&apos;s team</span>}
                            </div>
                          </div>
                        </td>
                        {planId === 'all' && (
                          <td className="p-4">
                            {row.plan ? (
                              <span className="inline-flex items-center gap-2 font-bold text-slate-700">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: row.plan.badge_color_hex }} />
                                {row.plan.name}
                              </span>
                            ) : '-'}
                          </td>
                        )}
                        <td className="p-4 text-slate-600">{row.city || '-'}</td>
                        <td className="p-4 text-slate-600">{day(row.valid_until) || 'No subscription'}</td>
                        <td className="p-4">{row.limits.can_manage_fleet || row.team_count ? <Count used={row.team_count} max={row.limits.can_manage_fleet ? row.limits.max_team : 0} /> : '-'}</td>
                        <td className="p-4"><Count used={row.vehicle_count} max={row.limits.max_vehicles} /></td>
                        <td className="p-4"><Status approved={row.approved} online={row.online} onRide={row.on_ride} /></td>
                        <td className="p-4 text-right">
                          <button type="button" onClick={() => setPanelId(row.id)} className="text-xs font-bold text-indigo-600">Details</button>
                        </td>
                      </tr>
                      {open && <TeamRows driverId={row.id} columns={heads.length} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="p-10 text-center text-sm text-slate-500">No drivers found.</p>}
          </div>
        )}

        {meta.totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 text-sm">
            <button type="button" disabled={meta.page <= 1 || loading} onClick={() => setPage(meta.page - 1)} className="font-bold text-indigo-600 disabled:opacity-30">Previous</button>
            <span className="text-slate-500">Page {meta.page} of {meta.totalPages} ({meta.total})</span>
            <button type="button" disabled={meta.page >= meta.totalPages || loading} onClick={() => setPage(meta.page + 1)} className="font-bold text-indigo-600 disabled:opacity-30">Next</button>
          </div>
        )}
      </div>

      {panelId && <FleetPanel driverId={panelId} onClose={() => setPanelId('')} />}
    </div>
  );
};

export default PlanDrivers;
