import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gem, Loader2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};
const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;
const DAY = 24 * 60 * 60 * 1000;

const EliteDrivers = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/driver-network/elite-drivers');
      setRows(unwrap(res).results || []);
    } catch (err) {
      toast.error(errorText(err, 'Failed to load Elite drivers'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const extend = async (row) => {
    const answer = window.prompt(`Add how many days to ${row.name}'s Elite plan?`, '30');
    if (answer === null) return;
    const days = Number(answer);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return toast.error('Enter a whole number of days (1 to 3650)');
    const base = row.valid_until && new Date(row.valid_until).getTime() > Date.now() ? new Date(row.valid_until).getTime() : Date.now();
    try {
      setBusy(row.id);
      await api.patch(`/admin/driver-network/drivers/${row.id}/category`, {
        category: 'prime',
        valid_until: new Date(base + days * DAY).toISOString(),
      });
      toast.success('Plan extended');
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to extend'));
    } finally {
      setBusy('');
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Take Elite from ${row.name}? They go back to the Basic plan and the slot is freed.`)) return;
    try {
      setBusy(row.id);
      await api.patch(`/admin/driver-network/drivers/${row.id}/category`, { category: 'lower', reason: 'admin_removed_elite' });
      toast.success('Elite removed');
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Failed to remove'));
    } finally {
      setBusy('');
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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Gem className="text-indigo-600" />
            <div>
              <h1 className="text-xl font-black text-slate-900">Elite Drivers ({rows.length})</h1>
              <p className="text-xs text-slate-500">Everyone who has the Elite plan now, and when it ends.</p>
            </div>
          </div>
          <Link
            to="/admin/elite/create"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-700"
          >
            <UserPlus size={16} /> Add driver
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-400">No Elite drivers yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Driver</th>
                    <th className="px-6 py-3">City</th>
                    <th className="px-6 py-3">Slot</th>
                    <th className="px-6 py-3">Valid until</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-6 py-3">
                        <div className="font-bold text-slate-800">{row.name}</div>
                        <div className="text-xs text-slate-400">{row.phone}</div>
                      </td>
                      <td className="px-6 py-3">{row.city || '-'}</td>
                      <td className="px-6 py-3">{row.slot_no ? `#${row.slot_no}` : '-'}</td>
                      <td className="px-6 py-3">
                        {row.valid_until ? new Date(row.valid_until).toLocaleDateString() : '-'}
                        {row.days_left !== null && (
                          <span className={`ml-2 text-[11px] font-bold ${row.days_left <= 5 ? 'text-rose-600' : 'text-slate-400'}`}>
                            {row.days_left} day{row.days_left === 1 ? '' : 's'} left
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => extend(row)}
                          disabled={busy === row.id}
                          className="mr-2 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                        >
                          Extend
                        </button>
                        <button
                          onClick={() => remove(row)}
                          disabled={busy === row.id}
                          className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                          Remove Elite
                        </button>
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

export default EliteDrivers;
