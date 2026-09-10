import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ShieldCheck, Car, Loader2, RefreshCw, Sparkles, History, CheckCircle2, Zap, Layers, HelpCircle } from 'lucide-react';
import { adminService } from '../../services/adminService.js';
import SubscriptionTierForm from './SubscriptionTierForm.jsx';
import RideModulesList from './RideModulesList.jsx';
import SupportChannelsList from './SupportChannelsList.jsx';
import TierAuditLogs from './TierAuditLogs.jsx';

export default function SubscriptionTierList() {
  const [activeTab, setActiveTab] = useState('tiers'); // 'tiers' | 'modules' | 'channels' | 'audit'
  const [tiers, setTiers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingTier, setEditingTier] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const fetchTiers = async () => {
    try {
      setIsLoading(true);
      const res = await adminService.getSubscriptionPlans();
      const list = res?.data?.results || res?.results || res?.data || [];
      setTiers(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Error fetching tiers:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTiers();
  }, []);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete the "${name}" subscription tier?`)) return;
    try {
      await adminService.deleteSubscriptionPlan(id);
      fetchTiers();
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to delete tier');
    }
  };

  const defaultTier = tiers.find((t) => t.is_default);
  const lowestCommTier = tiers.length ? [...tiers].sort((a, b) => a.commission_percent - b.commission_percent)[0] : null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 font-sans">
      {/* HERO HEADER */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-8 rounded-3xl shadow-xl border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-xs font-black uppercase tracking-wider">
              <Sparkles size={14} /> Driver Priority & Commission Control Hub
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">Driver Subscription Tiers</h1>
            <p className="text-sm text-slate-300 max-w-2xl font-medium">
              Configure driver subscription plans, commission rates, dispatch priority scores, and module permissions.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchTiers()}
              className="p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-2xl transition border border-slate-700/60"
              title="Refresh Data"
            >
              <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => { setEditingTier(null); setIsFormOpen(true); }}
              className="flex items-center gap-2.5 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-sm rounded-2xl shadow-lg shadow-emerald-900/30 transition transform active:scale-95"
            >
              <Plus size={20} /> Create New Tier
            </button>
          </div>
        </div>

        {/* METRICS STATS STRIP */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50 backdrop-blur-sm">
            <span className="text-xs text-slate-400 font-medium block">Total Active Tiers</span>
            <span className="text-2xl font-black text-white">{tiers.length}</span>
          </div>
          <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50 backdrop-blur-sm">
            <span className="text-xs text-slate-400 font-medium block">Default Fallback Tier</span>
            <span className="text-sm font-black text-emerald-400 truncate block">{defaultTier?.name || 'None Set'}</span>
          </div>
          <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50 backdrop-blur-sm">
            <span className="text-xs text-slate-400 font-medium block">Lowest Commission</span>
            <span className="text-2xl font-black text-teal-300">{lowestCommTier ? `${lowestCommTier.commission_percent}%` : 'N/A'}</span>
          </div>
          <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/50 backdrop-blur-sm">
            <span className="text-xs text-slate-400 font-medium block">System Dispatch Mode</span>
            <span className="text-xs font-black text-indigo-300 uppercase tracking-wider block mt-1">Priority Waves (Score-Based)</span>
          </div>
        </div>
      </div>

      {/* EXECUTIVE TAB NAVIGATION */}
      <div className="flex items-center gap-3 bg-gray-100/80 p-1.5 rounded-2xl border border-gray-200">
        <button
          onClick={() => setActiveTab('tiers')}
          className={`flex items-center gap-2 px-6 py-3 font-black text-xs uppercase tracking-wider rounded-xl transition ${activeTab === 'tiers' ? 'bg-white text-indigo-700 shadow-md' : 'text-gray-600 hover:text-gray-900'}`}
        >
          <ShieldCheck size={16} /> Subscription Tiers ({tiers.length})
        </button>
        <button
          onClick={() => setActiveTab('modules')}
          className={`flex items-center gap-2 px-6 py-3 font-black text-xs uppercase tracking-wider rounded-xl transition ${activeTab === 'modules' ? 'bg-white text-indigo-700 shadow-md' : 'text-gray-600 hover:text-gray-900'}`}
        >
          <Layers size={16} /> Ride Modules
        </button>
        <button
          onClick={() => setActiveTab('channels')}
          className={`flex items-center gap-2 px-6 py-3 font-black text-xs uppercase tracking-wider rounded-xl transition ${activeTab === 'channels' ? 'bg-white text-indigo-700 shadow-md' : 'text-gray-600 hover:text-gray-900'}`}
        >
          <Zap size={16} /> Support Channels
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-6 py-3 font-black text-xs uppercase tracking-wider rounded-xl transition ${activeTab === 'audit' ? 'bg-white text-indigo-700 shadow-md' : 'text-gray-600 hover:text-gray-900'}`}
        >
          <History size={16} /> Audit Trail
        </button>
      </div>

      {/* TAB CONTENT 1: TIERS GRID VIEW */}
      {activeTab === 'tiers' && (
        <div className="space-y-6">
          {isLoading ? (
            <div className="p-16 text-center bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3">
              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto" />
              <p className="text-sm font-bold text-gray-500">Loading Subscription Tiers...</p>
            </div>
          ) : tiers.length === 0 ? (
            <div className="p-16 text-center bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3">
              <p className="text-base font-bold text-gray-700">No Subscription Tiers Found</p>
              <p className="text-xs text-gray-400">Click "Create New Tier" to set up Basic, Premium, or Super Premium tiers.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {tiers.map((tier) => (
                <div
                  key={tier._id}
                  className={`bg-white rounded-3xl p-6 border transition-all duration-200 flex flex-col justify-between shadow-sm hover:shadow-xl relative overflow-hidden group ${tier.is_default ? 'border-2 border-emerald-500 ring-4 ring-emerald-50' : 'border-gray-100'}`}
                >
                  {/* TOP COLOR ACCENT BAR */}
                  <div
                    className="absolute top-0 left-0 right-0 h-2"
                    style={{ backgroundColor: tier.badge_color_hex || '#10B981' }}
                  />

                  <div>
                    {/* TIER HEADER */}
                    <div className="flex items-start justify-between gap-3 pt-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-black text-gray-900">{tier.name}</h3>
                          {tier.is_default && (
                            <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase tracking-wider rounded-full border border-emerald-300">
                              Default Fallback
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 font-medium">
                          Support: <strong className="text-gray-800">{tier.support_channel_type_id?.name || 'Standard Chat'}</strong>
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="inline-flex items-center px-3 py-1 bg-indigo-50 text-indigo-700 rounded-xl text-xs font-black border border-indigo-100 shadow-sm">
                          Priority Score: {tier.priority_score || 0}
                        </span>
                      </div>
                    </div>

                    {/* PRICING & COMMISSION CARD */}
                    <div className="mt-5 p-4 bg-gradient-to-br from-gray-50 to-slate-50 rounded-2xl border border-gray-100 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 block">Commission</span>
                        <span className="text-2xl font-black text-emerald-600">{tier.commission_percent}%</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 block">Pricing</span>
                        <span className="text-base font-black text-gray-900">₹{tier.price_monthly} <span className="text-xs text-gray-400 font-medium">/mo</span></span>
                        <span className="text-xs text-gray-400 block font-medium">₹{tier.price_yearly} /yr</span>
                      </div>
                    </div>

                    {/* KEY FEATURES LIST */}
                    <div className="mt-5 space-y-2.5 text-xs font-semibold text-gray-700">
                      <div className="flex items-center justify-between p-2 bg-gray-50 rounded-xl">
                        <span className="text-gray-500">Search Radius Multiplier</span>
                        <span className="font-bold text-gray-900">{tier.search_radius_multiplier || 1.0}x</span>
                      </div>
                      <div className="flex items-center justify-between p-2 bg-gray-50 rounded-xl">
                        <span className="text-gray-500">Max Allowed Cash Debt</span>
                        <span className="font-bold text-gray-900">₹{tier.max_cash_debt_allowed || 0}</span>
                      </div>
                      {tier.free_cancellations_per_day > 0 && (
                        <div className="flex items-center justify-between p-2 bg-emerald-50 text-emerald-900 rounded-xl font-bold">
                          <span>Free Cancellations</span>
                          <span>{tier.free_cancellations_per_day} / day</span>
                        </div>
                      )}
                    </div>

                    {/* GRANTED MODULES */}
                    <div className="mt-5">
                      <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block mb-2">Granted Ride Modules</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(tier.ride_module_ids || []).map((mod, idx) => (
                          <span key={idx} className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-lg text-xs font-bold border border-slate-200">
                            {mod.display_name || mod.code || mod}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* BOTTOM ACTION BUTTONS */}
                  <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
                    <button
                      onClick={() => { setEditingTier(tier); setIsFormOpen(true); }}
                      className="flex-1 py-2.5 px-4 bg-gray-900 hover:bg-black text-white rounded-xl font-bold text-xs shadow-md transition flex items-center justify-center gap-1.5"
                    >
                      <Edit2 size={14} /> Edit Tier
                    </button>
                    {!tier.is_default && (
                      <button
                        onClick={() => handleDelete(tier._id, tier.name)}
                        className="p-2.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition border border-gray-200"
                        title="Delete Tier"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'modules' && <RideModulesList />}
      {activeTab === 'channels' && <SupportChannelsList />}
      {activeTab === 'audit' && <TierAuditLogs />}

      {/* TIER FORM MODAL */}
      {isFormOpen && (
        <SubscriptionTierForm
          tier={editingTier}
          onClose={() => setIsFormOpen(false)}
          onSuccess={() => { setIsFormOpen(false); fetchTiers(); }}
        />
      )}
    </div>
  );
}
