import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Loader2, Check } from 'lucide-react';
import { adminService } from '../../services/adminService.js';

export default function RideModulesList() {
  const [modules, setModules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');

  const fetchModules = async () => {
    try {
      setIsLoading(true);
      const res = await adminService.getRideModules();
      setModules(res?.data?.results || res?.results || []);
    } catch (err) {
      console.error('Error fetching modules:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchModules();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!code || !displayName) return alert('Code and display name are required');
    try {
      await adminService.createRideModule({ code, display_name: displayName, description });
      setCode(''); setDisplayName(''); setDescription('');
      fetchModules();
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to create ride module');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this ride module?')) return;
    try {
      await adminService.deleteRideModule(id);
      fetchModules();
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to delete ride module');
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs font-bold text-gray-700 mb-1">Module Code (unique)</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. airport, outstation, parcel"
            className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-bold text-gray-700 mb-1">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Airport Transfer"
            className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-bold text-gray-700 mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
            className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm"
          />
        </div>
        <button type="submit" className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl flex items-center gap-1.5 h-10">
          <Plus size={16} /> Add Module
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase">
              <th className="px-6 py-3">Code</th>
              <th className="px-6 py-3">Display Name</th>
              <th className="px-6 py-3">Description</th>
              <th className="px-6 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {isLoading ? (
              <tr><td colSpan="4" className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" /></td></tr>
            ) : modules.map((m) => (
              <tr key={m._id} className="hover:bg-gray-50/50">
                <td className="px-6 py-3 font-mono font-bold text-indigo-600">{m.code}</td>
                <td className="px-6 py-3 font-bold text-gray-900">{m.display_name}</td>
                <td className="px-6 py-3 text-gray-500 text-xs">{m.description || 'N/A'}</td>
                <td className="px-6 py-3 text-center">
                  <button onClick={() => handleDelete(m._id)} className="p-1.5 text-gray-400 hover:text-rose-600">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
