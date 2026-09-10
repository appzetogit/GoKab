import React, { useState, useEffect } from 'react';
import { History, Loader2, ShieldAlert } from 'lucide-react';
import { adminService } from '../../services/adminService.js';

export default function TierAuditLogs() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setIsLoading(true);
        const res = await adminService.getTierAuditLogs();
        setLogs(res?.data?.results || res?.results || []);
      } catch (err) {
        console.error('Error fetching audit logs:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchLogs();
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
        <ShieldAlert size={18} className="text-amber-600" />
        <h3 className="font-bold text-sm text-gray-900">Audit History of Tier & Financial Configuration Edits</h3>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase">
            <th className="px-6 py-3">Timestamp</th>
            <th className="px-6 py-3">Admin</th>
            <th className="px-6 py-3">Action</th>
            <th className="px-6 py-3">Changed Fields (Old → New Value)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-xs font-medium">
          {isLoading ? (
            <tr><td colSpan="4" className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" /></td></tr>
          ) : logs.length === 0 ? (
            <tr><td colSpan="4" className="p-8 text-center text-gray-400">No audit log entries found.</td></tr>
          ) : (
            logs.map((log) => (
              <tr key={log._id} className="hover:bg-gray-50/50">
                <td className="px-6 py-3 text-gray-500 font-mono">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="px-6 py-3 font-bold text-gray-900">
                  {log.admin_email || 'Admin'}
                </td>
                <td className="px-6 py-3">
                  <span className={`px-2 py-0.5 rounded uppercase font-black text-[10px] ${log.action === 'create' ? 'bg-emerald-100 text-emerald-800' : log.action === 'delete' ? 'bg-rose-100 text-rose-800' : 'bg-indigo-100 text-indigo-800'}`}>
                    {log.action}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <div className="space-y-1">
                    {(log.changes || []).map((ch, idx) => (
                      <div key={idx} className="font-mono text-gray-700">
                        <span className="font-bold text-indigo-600">{ch.field}:</span>{' '}
                        <span className="line-through text-gray-400">{String(ch.old_value ?? 'null')}</span> →{' '}
                        <span className="font-bold text-emerald-600">{String(ch.new_value ?? 'null')}</span>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
