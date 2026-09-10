import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { adminService } from '../../services/adminService.js';

export default function SupportChannelsList() {
  const [channels, setChannels] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const fetchChannels = async () => {
    try {
      setIsLoading(true);
      const res = await adminService.getSupportChannels();
      setChannels(res?.data?.results || res?.results || []);
    } catch (err) {
      console.error('Error fetching channels:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!code || !name) return alert('Code and name are required');
    try {
      await adminService.createSupportChannel({ code, name, description });
      setCode(''); setName(''); setDescription('');
      fetchChannels();
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to create support channel');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete support channel type?')) return;
    try {
      await adminService.deleteSupportChannel(id);
      fetchChannels();
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to delete support channel');
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs font-bold text-gray-700 mb-1">Channel Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. phone_247, chat"
            className="w-full px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-bold text-gray-700 mb-1">Channel Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 24/7 Priority Phone Hotline"
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
          <Plus size={16} /> Add Channel
        </button>
      </form>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase">
              <th className="px-6 py-3">Code</th>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Description</th>
              <th className="px-6 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {isLoading ? (
              <tr><td colSpan="4" className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" /></td></tr>
            ) : channels.map((c) => (
              <tr key={c._id} className="hover:bg-gray-50/50">
                <td className="px-6 py-3 font-mono font-bold text-indigo-600">{c.code}</td>
                <td className="px-6 py-3 font-bold text-gray-900">{c.name}</td>
                <td className="px-6 py-3 text-gray-500 text-xs">{c.description || 'N/A'}</td>
                <td className="px-6 py-3 text-center">
                  <button onClick={() => handleDelete(c._id)} className="p-1.5 text-gray-400 hover:text-rose-600">
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
