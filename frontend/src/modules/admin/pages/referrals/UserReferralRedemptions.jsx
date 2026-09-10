import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Search, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

const UserReferralRedemptions = () => {
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('pending');
  const [data, setData] = useState({ results: [], paginator: null });

  const load = async () => {
    try {
      setLoading(true);
      const response = await adminService.getUserReferralRedemptionRequests({ search, status, page: 1, limit: 50 });
      const payload = response?.data?.data || response?.data || {};
      setData({
        results: Array.isArray(payload.results) ? payload.results : [],
        paginator: payload.paginator || null,
      });
    } catch (error) {
      toast.error('Failed to load referral redemption requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const handleApprove = async (requestId) => {
    try {
      setSubmittingId(requestId);
      await adminService.approveUserReferralRedemptionRequest(requestId);
      toast.success('Referral redemption approved');
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Approval failed');
    } finally {
      setSubmittingId('');
    }
  };

  const handleReject = async (requestId) => {
    const adminNote = window.prompt('Reason for rejection (optional)') || '';

    try {
      setSubmittingId(requestId);
      await adminService.rejectUserReferralRedemptionRequest(requestId, adminNote);
      toast.success('Referral redemption rejected');
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Rejection failed');
    } finally {
      setSubmittingId('');
    }
  };

  return (
    <div className="space-y-6 text-slate-950">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Referral Management</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">User Referral Redemption Requests</h1>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') load();
              }}
              placeholder="Search rider"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-slate-400 sm:w-64"
            />
          </label>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400"
          >
            <option value="pending">Pending</option>
            <option value="">All</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          <button
            type="button"
            onClick={load}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-3 p-16 text-slate-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm font-semibold">Loading requests...</span>
          </div>
        ) : data.results.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  <th className="px-5 py-4">Rider</th>
                  <th className="px-5 py-4">Amount</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Requested</th>
                  <th className="px-5 py-4">Note</th>
                  <th className="px-5 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.results.map((item) => {
                  const busy = submittingId === item._id;
                  return (
                    <tr key={item._id} className="text-sm text-slate-700">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">{item.user_name || 'User'}</div>
                        <div className="text-xs text-slate-500">{item.user_phone || '-'}</div>
                      </td>
                      <td className="px-5 py-4 font-semibold text-slate-900">Rs {Number(item.amount || 0).toFixed(2)}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                          item.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700'
                            : item.status === 'rejected'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">
                        {item.requestedAt ? new Date(item.requestedAt).toLocaleString('en-IN') : '-'}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">{item.adminNote || '-'}</td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy || item.status !== 'pending'}
                            onClick={() => handleApprove(item._id)}
                            className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy || item.status !== 'pending'}
                            onClick={() => handleReject(item._id)}
                            className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold uppercase tracking-wider text-rose-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-16 text-center text-sm font-semibold text-slate-500">No redemption requests found.</div>
        )}
      </div>
    </div>
  );
};

export default UserReferralRedemptions;
