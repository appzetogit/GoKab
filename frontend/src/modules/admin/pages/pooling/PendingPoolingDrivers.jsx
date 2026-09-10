import React, { useEffect, useMemo, useState } from 'react';
import {
  Car,
  CheckCircle2,
  ChevronRight,
  Eye,
  PencilLine,
  Phone,
  Search,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

const PendingPoolingDrivers = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const loadItems = async (search = '') => {
    setLoading(true);
    try {
      const response = await adminService.getPendingPoolingVehicles(search);
      const payload = response?.data?.data || response?.data || response;
      setItems(Array.isArray(payload) ? payload : []);
    } catch (error) {
      toast.error('Failed to load pending pooling drivers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems(searchTerm);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadItems(searchTerm);
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  const stats = useMemo(() => ({
    pending: items.length,
    withImages: items.filter((item) => Array.isArray(item.images) && item.images.length > 0).length,
  }), [items]);

  const handleApprove = async (id) => {
    if (!window.confirm('Approve this pooling driver request?')) {
      return;
    }

    try {
      await adminService.approvePoolingVehicle(id);
      toast.success('Pooling driver approved');
      loadItems(searchTerm);
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Approval failed');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this pending pooling request?')) {
      return;
    }

    try {
      await adminService.deletePoolingVehicle(id);
      toast.success('Pending request deleted');
      loadItems(searchTerm);
    } catch (error) {
      toast.error('Delete failed');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 md:p-6 lg:p-8">
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
          <span>Car Pooling</span>
          <ChevronRight size={12} />
          <span className="text-indigo-600">Pending Pooling Drivers</span>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Pending Pooling Drivers</h1>
            <p className="text-sm font-medium text-slate-500">Review self-signup pooling drivers before they go live</p>
          </div>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Pending Requests</p>
          <p className="mt-3 text-3xl font-black text-slate-900">{stats.pending}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">With Vehicle Images</p>
          <p className="mt-3 text-3xl font-black text-indigo-600">{stats.withImages}</p>
        </div>
      </div>

      <div className="mb-6">
        <div className="relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by driver, phone, model, or plate number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-sm font-medium outline-none transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-slate-100 bg-white shadow-sm">
        {loading ? (
          <div className="py-20 text-center text-sm font-bold text-slate-400">Loading pending pooling drivers...</div>
        ) : items.length === 0 ? (
          <div className="py-20 text-center text-sm font-bold text-slate-400">No pending pooling drivers found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-white">
                <tr className="text-left text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                  <th className="px-5 py-4">Driver</th>
                  <th className="px-5 py-4">Vehicle</th>
                  <th className="px-5 py-4">Type</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((vehicle) => (
                  <tr key={vehicle._id} className="transition hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <div className="space-y-1">
                        <p className="text-sm font-black text-slate-900">{vehicle.driverName || 'Pooling Driver'}</p>
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                          <Phone size={12} />
                          {vehicle.driverPhone || 'No phone'}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-slate-100">
                          {vehicle.images?.[0] ? (
                            <img src={vehicle.images[0]} alt={vehicle.name} className="h-full w-full object-cover" />
                          ) : (
                            <Car size={20} className="text-slate-300" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900">{vehicle.name || 'Unnamed vehicle'}</p>
                          <p className="text-xs font-semibold text-slate-500">{vehicle.vehicleModel || '-'}</p>
                          <p className="text-xs font-bold text-slate-400">{vehicle.vehicleNumber || '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-indigo-600">
                        {vehicle.vehicleType || 'sedan'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
                        {vehicle.status || 'pending'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => navigate(`/admin/pooling/vehicles/view/${vehicle._id}`)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100"
                        >
                          <Eye size={14} />
                          View
                        </button>
                        <button
                          onClick={() => navigate(`/admin/pooling/vehicles/edit/${vehicle._id}`)}
                          className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-600 transition hover:bg-indigo-50"
                        >
                          <PencilLine size={14} />
                          Edit
                        </button>
                        <button
                          onClick={() => handleApprove(vehicle._id)}
                          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
                        >
                          <CheckCircle2 size={14} />
                          Approve
                        </button>
                        <button
                          onClick={() => handleDelete(vehicle._id)}
                          className="rounded-xl border border-rose-100 p-2.5 text-rose-500 transition hover:bg-rose-50"
                          aria-label={`Delete ${vehicle.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
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
};

export default PendingPoolingDrivers;
