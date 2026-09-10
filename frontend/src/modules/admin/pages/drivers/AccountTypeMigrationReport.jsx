import React, { useState, useEffect } from 'react';
import { History, Loader2, ShieldCheck, RefreshCw } from 'lucide-react';
import { adminService } from '../../services/adminService.js';

export default function AccountTypeMigrationReport() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchReport = async () => {
    try {
      setIsLoading(true);
      const res = await adminService.getAccountTypeMigrationReport();
      const list = res?.data?.results || res?.results || res?.data || [];
      setLogs(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Error loading account type migration report:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 font-sans">
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-8 rounded-3xl shadow-xl border border-slate-800 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-xs font-black uppercase tracking-wider mb-2">
            <ShieldCheck size={14} /> System Reclassification History
          </div>
          <h1 className="text-3xl font-black">Account Type Migration & Audit Report</h1>
          <p className="text-xs text-slate-300 mt-1 max-w-xl font-medium">
            Complete audit trail of all driver account type changes (migration script, 2-way downward grace period reconciliation, instant vehicle promotions, and manual admin overrides).
          </p>
        </div>
        <button
          onClick={fetchReport}
          className="p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-2xl transition border border-slate-700/60"
        >
          <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center space-y-3">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto" />
            <p className="text-sm font-bold text-gray-500">Loading Reclassification Logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-16 text-center space-y-3">
            <p className="text-base font-bold text-gray-700">No Account Type Audit Logs Found</p>
            <p className="text-xs text-gray-400">Reclassifications will appear here automatically when drivers upgrade or grace periods reconcile.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-gray-400 uppercase font-black tracking-wider">
                  <th className="py-4 px-6">Driver Info</th>
                  <th className="py-4 px-6">Reclassification</th>
                  <th className="py-4 px-6">Reason</th>
                  <th className="py-4 px-6">Actual Vehicles</th>
                  <th className="py-4 px-6">Performed By</th>
                  <th className="py-4 px-6">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log._id} className="hover:bg-gray-50/50 transition">
                    <td className="py-4 px-6 font-bold text-gray-900">
                      {log.driver_id?.name || 'Driver ID: ' + (log.driver_id?._id || log.driver_id)}
                      <span className="block text-[11px] text-gray-400 font-normal">{log.driver_id?.phone}</span>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2 font-black">
                        <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-lg uppercase">{log.old_account_type}</span>
                        <span>→</span>
                        <span className="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-lg uppercase">{log.new_account_type}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-bold text-slate-700">
                      <span className="px-2.5 py-1 bg-slate-100 rounded-lg">{log.reason}</span>
                    </td>
                    <td className="py-4 px-6 font-black text-gray-900">{log.actual_vehicle_count}</td>
                    <td className="py-4 px-6 font-medium text-gray-500">{log.performed_by}</td>
                    <td className="py-4 px-6 font-mono text-gray-400">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
