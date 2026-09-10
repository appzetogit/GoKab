import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  Crown,
  FileSearch,
  Loader2,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserCheck,
  Users,
  Building2,
  MoreVertical,
  Edit2,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { adminService } from '../../services/adminService';

const Admins = () => {
  const navigate = useNavigate();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState('');

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const response = await adminService.getAdmins();
      setAdmins(Array.isArray(response?.data?.results) ? response.data.results : []);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Unable to load admins.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdmins();
  }, []);

  const filteredAdmins = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return admins;

    return admins.filter((item) =>
      [
        item.name,
        item.email,
        item.phone,
        item.role,
        item.admin_type,
        ...(item.service_locations || []).map((loc) => loc.name),
        ...(item.zones || []).map((zone) => zone.name),
      ].some((value) => String(value || '').toLowerCase().includes(query))
    );
  }, [admins, searchTerm]);

  const stats = useMemo(() => {
    const superadmins = admins.filter((item) => item.admin_type === 'superadmin').length;
    const subadmins = admins.filter((item) => item.admin_type === 'subadmin').length;
    const activeAdmins = admins.filter((item) => item.active !== false).length;
    return { superadmins, subadmins, activeAdmins, total: admins.length };
  }, [admins]);

  const handleDelete = async (admin) => {
    if (!window.confirm(`Permanently delete ${admin.name || 'this admin'}?`)) return;

    const id = admin.id || admin._id;
    setDeletingId(String(id));
    try {
      await adminService.deleteAdminAccount(id);
      toast.success('Admin deleted successfully');
      loadAdmins();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Delete failed');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="min-h-screen animate-in fade-in duration-500 bg-[#F8F9FA] p-4 md:p-6 lg:p-8 font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-7xl space-y-8"
      >
        {/* Header Section */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3 text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
               <span>Management</span>
               <ChevronRight size={10} className="opacity-50" />
               <span className="text-slate-900">Personnel</span>
            </div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Access Registry</h1>
            <p className="text-[13px] font-medium text-slate-400 mt-1.5">Configure platform administrators and cryptographic access tokens.</p>
          </div>
          <button
            onClick={() => navigate('/admin/management/admins/create')}
            className="group flex items-center justify-center gap-2.5 rounded-2xl bg-slate-900 px-6 py-4 text-sm font-black text-white shadow-2xl shadow-slate-900/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus size={20} strokeWidth={3} />
            <span>INITIALIZE ACCOUNT</span>
          </button>
        </div>

        {/* Executive Stats */}
        <div className="grid grid-cols-1 gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Cloud Registry', value: stats.total, icon: Users, color: 'text-slate-900', bg: 'bg-white' },
            { label: 'Master Access', value: stats.superadmins, icon: Crown, color: 'text-amber-500', bg: 'bg-white' },
            { label: 'Security Force', value: stats.subadmins, icon: ShieldCheck, color: 'text-sky-500', bg: 'bg-white' },
            { label: 'Active Signals', value: stats.activeAdmins, icon: UserCheck, color: 'text-emerald-500', bg: 'bg-white' },
          ].map((stat, i) => (
            <div key={i} className={`rounded-[2rem] border border-slate-200 ${stat.bg} p-4 md:p-6 shadow-sm`}>
               <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{stat.label}</p>
                  <div className={`p-2 rounded-xl bg-slate-50 ${stat.color}`}>
                     <stat.icon size={16} strokeWidth={2.5} />
                  </div>
               </div>
               <p className="text-3xl font-black text-slate-900">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Data Table Container */}
        <div className="overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white shadow-xl shadow-slate-200/40">
          <div className="border-b border-slate-100 bg-slate-50/50 p-4 md:p-6">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6">
                <div className="relative w-full max-w-md">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by identity, role or scope..."
                    className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-12 pr-5 text-[13px] font-bold text-slate-900 outline-none transition-all focus:border-slate-900 focus:ring-8 focus:ring-slate-900/5 placeholder:text-slate-300"
                  />
                </div>
                <div className="flex items-center gap-3">
                   <div className="rounded-full bg-slate-900 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-slate-900/20">
                      {filteredAdmins.length} Nodes Online
                   </div>
                </div>
             </div>
          </div>

          <div className="overflow-x-auto no-scrollbar">
            {loading ? (
              <div className="py-32 flex flex-col items-center justify-center gap-4">
                <Loader2 size={32} className="animate-spin text-slate-900" />
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em]">Synchronizing Registry...</span>
              </div>
            ) : filteredAdmins.length === 0 ? (
              <div className="py-32 flex flex-col items-center text-center px-6">
                <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center text-slate-200 mb-6 border border-slate-100">
                  <FileSearch size={32} strokeWidth={1.5} />
                </div>
                <h3 className="text-[15px] font-bold text-slate-900">No matching nodes found</h3>
                <p className="text-[13px] font-medium text-slate-400 mt-2 max-w-sm">
                   We couldn't locate any administrators matching your search criteria. Check for typos or expand your scope.
                </p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/30">
                    {['Identity Details', 'Security Context', 'Authorization Scope', 'Live Status', ''].map((head, i) => (
                       <th key={i} className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                          {head}
                       </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredAdmins.map((admin) => {
                    const isSuper = admin.admin_type === 'superadmin';
                    const isActive = admin.active !== false;
                    const id = admin.id || admin._id;
                    
                    return (
                      <tr key={id} className="group hover:bg-slate-50/40 transition-colors">
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shadow-sm border ${isSuper ? 'bg-amber-50 border-amber-100 text-amber-600' : 'bg-slate-50 border-slate-100 text-slate-900'}`}>
                              {admin.name?.[0]?.toUpperCase() || <Shield size={20} />}
                            </div>
                            <div>
                              <p className="text-[14px] font-bold text-slate-900 group-hover:text-black transition-colors">{admin.name}</p>
                              <p className="text-[12px] font-medium text-slate-400 mt-0.5">{admin.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-2">
                             {isSuper ? <Crown size={14} className="text-amber-500" /> : <Shield size={14} className="text-slate-400" />}
                             <span className={`text-[11px] font-black uppercase tracking-widest ${isSuper ? 'text-amber-600' : 'text-slate-600'}`}>
                                {isSuper ? 'Super Admin' : (admin.role || 'Personnel')}
                             </span>
                          </div>
                        </td>
                        <td className="px-8 py-6 max-w-[320px]">
                          <div className="space-y-1.5">
                            <p className="text-[11px] font-black text-slate-900 uppercase tracking-tight">
                              {isSuper ? 'UNRESTRICTED CLOUD ACCESS' : `${(admin.permissions || []).length} MODULES ENABLED`}
                            </p>
                            <p className="text-[12px] font-medium text-slate-400 truncate leading-relaxed italic">
                              {isSuper ? 'Full administrative sovereignty over platform infrastructure.' : (admin.permissions || []).join(', ') || 'Restricted entry level.'}
                            </p>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-300'}`} />
                            <span className={`text-[11px] font-black uppercase tracking-widest ${isActive ? 'text-emerald-700' : 'text-slate-400'}`}>
                              {isActive ? 'Verified' : 'Deactivated'}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => navigate(`/admin/management/admins/edit/${id}`)}
                              className="p-3 text-slate-300 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
                            >
                              <Edit2 size={18} strokeWidth={2.5} />
                            </button>
                            {!isSuper && (
                              <button
                                disabled={deletingId === String(id)}
                                onClick={() => handleDelete(admin)}
                                className="p-3 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                              >
                                {deletingId === String(id) ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} strokeWidth={2.5} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Admins;
