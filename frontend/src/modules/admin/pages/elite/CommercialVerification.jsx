import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};
const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

const CommercialVerification = () => {
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(async (status) => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/driver-network/commercial-verification?status=${status}`);
      setRows(unwrap(res).results || []);
    } catch (err) {
      toast.error(errorText(err, 'Failed to load'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  const setVerified = async (row, verified) => {
    if (verified && !row.permit_url && !window.confirm('No permit image is saved for this driver. Verify anyway?')) return;
    if (!verified && !window.confirm(`Take back the verification of ${row.name}'s vehicle?`)) return;
    try {
      setBusy(row.id);
      await api.patch(`/admin/driver-network/drivers/${row.id}/vehicle-usage-verified`, { verified });
      toast.success(verified ? 'Verified' : 'Verification removed');
      await load(tab);
    } catch (err) {
      toast.error(errorText(err, 'Failed'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      <div className="max-w-[1200px] mx-auto p-4 md:p-8 space-y-6 pb-32">
        <div className="flex items-center gap-3">
          <BadgeCheck className="text-indigo-600" />
          <div>
            <h1 className="text-xl font-black text-slate-900">Commercial Vehicle Check</h1>
            <p className="text-xs text-slate-500">
              Drivers who registered with a commercial vehicle. Look at the permit, then verify. Only a verified commercial vehicle lets a driver buy Elite or Pro.
            </p>
          </div>
        </div>

        <div className="inline-flex rounded-xl bg-white border border-slate-200 p-1">
          {[
            ['pending', 'Waiting'],
            ['verified', 'Verified'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-lg px-5 py-2 text-sm font-bold ${tab === key ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-400">{tab === 'pending' ? 'Nobody is waiting.' : 'Nothing verified yet.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Driver</th>
                    <th className="px-6 py-3">Vehicle</th>
                    <th className="px-6 py-3">Plan</th>
                    <th className="px-6 py-3">Permit</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="px-6 py-3">
                        <div className="font-bold text-slate-800">{row.name}</div>
                        <div className="text-xs text-slate-400">{row.phone}</div>
                        <div className="text-xs text-slate-400">{row.city}</div>
                      </td>
                      <td className="px-6 py-3">
                        <div>{row.vehicle || '-'}</div>
                        <div className="text-xs text-slate-400">{row.vehicle_number}</div>
                      </td>
                      <td className="px-6 py-3">{row.plan}</td>
                      <td className="px-6 py-3">
                        {row.permit_url ? (
                          <a href={row.permit_url} target="_blank" rel="noreferrer">
                            <img src={row.permit_url} alt="Commercial permit" className="h-16 w-24 rounded-lg object-cover border border-slate-200" />
                          </a>
                        ) : (
                          <span className="text-xs text-rose-600 font-bold">No permit image</span>
                        )}
                        {row.permit_number && <div className="mt-1 text-xs text-slate-500">No. {row.permit_number}</div>}
                        {row.permit_expiry && <div className="text-xs text-slate-400">Expires {String(row.permit_expiry).slice(0, 10)}</div>}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        {tab === 'pending' ? (
                          <button
                            onClick={() => setVerified(row, true)}
                            disabled={busy === row.id}
                            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Verify
                          </button>
                        ) : (
                          <button
                            onClick={() => setVerified(row, false)}
                            disabled={busy === row.id}
                            className="rounded-lg border border-rose-200 px-4 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          >
                            Remove verification
                          </button>
                        )}
                      </td>
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

export default CommercialVerification;
