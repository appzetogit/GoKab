import React, { useState, useEffect } from 'react';
import { X, Save, AlertTriangle, ShieldCheck, HelpCircle, Layers, DollarSign, Zap } from 'lucide-react';
import { adminService } from '../../services/adminService.js';

export default function SubscriptionTierForm({ tier, onClose, onSuccess }) {
  const isEdit = Boolean(tier?._id);

  const [formData, setFormData] = useState({
    name: tier?.name || '',
    is_default: Boolean(tier?.is_default),
    display_order: tier?.display_order ?? 1,
    priority_score: tier?.priority_score ?? 10,
    price_monthly: tier?.price_monthly ?? 0,
    price_yearly: tier?.price_yearly ?? 0,
    commission_percent: tier?.commission_percent ?? 15,
    search_radius_multiplier: tier?.search_radius_multiplier ?? 1.0,
    max_cash_debt_allowed: tier?.max_cash_debt_allowed ?? 0,
    free_cancellations_per_day: tier?.free_cancellations_per_day ?? 0,
    cancellation_penalty_waived: Boolean(tier?.cancellation_penalty_waived),
    support_channel_type_id: tier?.support_channel_type_id?._id || tier?.support_channel_type_id || '',
    ride_module_ids: (tier?.ride_module_ids || []).map((m) => m._id || m),
    map_icon_asset_url: tier?.map_icon_asset_url || '',
    badge_color_hex: tier?.badge_color_hex || '#10B981',
    is_active: tier?.is_active !== false,
  });

  const [modulesList, setModulesList] = useState([]);
  const [channelsList, setChannelsList] = useState([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [modsRes, chansRes] = await Promise.all([
          adminService.getRideModules(),
          adminService.getSupportChannels(),
        ]);
        setModulesList(modsRes?.data?.results || modsRes?.results || []);
        setChannelsList(chansRes?.data?.results || chansRes?.results || []);
      } catch (err) {
        console.error('Error loading form options:', err);
      }
    };
    loadOptions();
  }, []);

  const handleModuleToggle = (modId) => {
    setFormData((prev) => {
      const exists = prev.ride_module_ids.includes(modId);
      return {
        ...prev,
        ride_module_ids: exists
          ? prev.ride_module_ids.filter((id) => id !== modId)
          : [...prev.ride_module_ids, modId],
      };
    });
  };

  const handleSubmitAttempt = (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!formData.name.trim()) {
      setErrorMsg('Tier name is required');
      return;
    }
    if (formData.commission_percent < 0 || formData.commission_percent > 100) {
      setErrorMsg('Commission percentage must be between 0 and 100');
      return;
    }

    if (isEdit) {
      setShowConfirmModal(true);
    } else {
      executeSave();
    }
  };

  const executeSave = async () => {
    try {
      setIsSubmitting(true);
      setShowConfirmModal(false);

      if (isEdit) {
        await adminService.updateSubscriptionPlan(tier._id, formData);
      } else {
        await adminService.createSubscriptionPlan(formData);
      }

      onSuccess();
    } catch (err) {
      setErrorMsg(err?.response?.data?.message || 'Failed to save subscription tier');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto font-sans">
      <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-gray-100 overflow-hidden my-6">
        {/* HEADER */}
        <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 text-white">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-md font-black"
              style={{ backgroundColor: formData.badge_color_hex || '#10B981' }}
            >
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 className="text-xl font-black">{isEdit ? `Edit Tier: ${tier.name}` : 'Configure New Subscription Tier'}</h2>
              <p className="text-xs text-slate-300">Set commission rate, priority dispatch score, debt limits, and granted modules</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-xl transition">
            <X size={20} />
          </button>
        </div>

        {errorMsg && (
          <div className="mx-8 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-2xl font-bold">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmitAttempt} className="p-8 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* SECTION 1: BASIC INFO & BADGE */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
              <Zap size={14} /> Basic Identity & Default Fallback
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Tier Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Basic, Premium, Super Premium"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold focus:bg-white focus:border-indigo-600 outline-none transition"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Badge Color Hex</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={formData.badge_color_hex}
                    onChange={(e) => setFormData({ ...formData, badge_color_hex: e.target.value })}
                    className="w-12 h-11 rounded-xl cursor-pointer border border-gray-200"
                  />
                  <input
                    type="text"
                    value={formData.badge_color_hex}
                    onChange={(e) => setFormData({ ...formData, badge_color_hex: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-mono uppercase"
                  />
                </div>
              </div>
            </div>

            {/* SINGLETON DEFAULT FALLBACK BANNER */}
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-emerald-900">Default Fallback Tier (`is_default`)</p>
                <p className="text-xs text-emerald-700 font-medium">Assigns this tier's rules to any driver whose subscription is expired or missing.</p>
              </div>
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
              />
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* SECTION 2: DISPATCH PRIORITY & COMMISSION */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
              <Zap size={14} /> Priority Waves & Financial Rules
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                  Priority Score <HelpCircle size={13} className="text-gray-400" title="Higher score drivers are notified first in dispatch waves" />
                </label>
                <input
                  type="number"
                  value={formData.priority_score}
                  onChange={(e) => setFormData({ ...formData, priority_score: Number(e.target.value) })}
                  className="w-full px-4 py-3 bg-indigo-50/50 border border-indigo-200 rounded-2xl text-base font-black text-indigo-700"
                />
                <span className="text-[11px] text-gray-400 block mt-1">e.g. Basic: 10, Premium: 50, Super Premium: 100</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                  Commission Percent % <HelpCircle size={13} className="text-gray-400" title="0% = Driver keeps 100% of ride ticket fare" />
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  value={formData.commission_percent}
                  onChange={(e) => setFormData({ ...formData, commission_percent: Number(e.target.value) })}
                  className="w-full px-4 py-3 bg-emerald-50/50 border border-emerald-200 rounded-2xl text-base font-black text-emerald-700"
                />
                <span className="text-[11px] text-gray-400 block mt-1">e.g. 0% for Super Premium, 5% for Premium</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Search Radius Multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={formData.search_radius_multiplier}
                  onChange={(e) => setFormData({ ...formData, search_radius_multiplier: Number(e.target.value) })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold"
                />
                <span className="text-[11px] text-gray-400 block mt-1">1.0x = standard radius, 2.0x = 2x search radius</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Max Cash Debt Allowed (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={formData.max_cash_debt_allowed}
                  onChange={(e) => setFormData({ ...formData, max_cash_debt_allowed: Number(e.target.value) })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold"
                />
                <span className="text-[11px] text-gray-400 block mt-1">e.g. 1000 = driver wallet balance can drop down to -1000</span>
              </div>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* SECTION 3: PRICING PASS */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
              <DollarSign size={14} /> Subscription Pass Pricing
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Monthly Price (₹)</label>
                <input
                  type="number"
                  value={formData.price_monthly}
                  onChange={(e) => setFormData({ ...formData, price_monthly: Number(e.target.value) })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Yearly Price (₹)</label>
                <input
                  type="number"
                  value={formData.price_yearly}
                  onChange={(e) => setFormData({ ...formData, price_yearly: Number(e.target.value) })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold"
                />
              </div>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* SECTION 4: MODULES & PERKS */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
              <Layers size={14} /> Granted Ride Modules & Support Perks
            </h3>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Support Channel Level</label>
              <select
                value={formData.support_channel_type_id}
                onChange={(e) => setFormData({ ...formData, support_channel_type_id: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold"
              >
                <option value="">Select Support Channel Level...</option>
                {channelsList.map((chan) => (
                  <option key={chan._id} value={chan._id}>{chan.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-2">Granted Ride Modules (Checklist)</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 bg-gray-50 p-4 rounded-2xl border border-gray-200">
                {modulesList.map((mod) => {
                  const checked = formData.ride_module_ids.includes(mod._id);
                  return (
                    <label key={mod._id} className="flex items-center gap-2 text-xs font-bold text-gray-800 cursor-pointer p-2 hover:bg-white rounded-xl transition">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleModuleToggle(mod._id)}
                        className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
                      />
                      {mod.display_name}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ACTIONS */}
          <div className="pt-6 border-t border-gray-100 flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-2xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-8 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-black text-sm rounded-2xl shadow-lg shadow-indigo-200 flex items-center gap-2 transition"
            >
              <Save size={18} /> {isEdit ? 'Save Changes' : 'Create Tier'}
            </button>
          </div>
        </form>

        {/* CONFIRMATION DIFF MODAL */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/75 p-4">
            <div className="bg-white w-full max-w-md p-6 rounded-3xl space-y-4 shadow-2xl">
              <div className="flex items-center gap-3 text-amber-600">
                <AlertTriangle size={26} />
                <h3 className="text-lg font-black text-gray-900">Confirm Live Tier Update</h3>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed font-medium">
                Updating <strong>{formData.name}</strong> takes effect immediately across dispatch and commission calculations for active drivers.
              </p>
              <div className="bg-amber-50 p-4 rounded-2xl text-xs space-y-1.5 text-amber-900 font-bold border border-amber-200">
                <div>• Commission Rate: <strong>{formData.commission_percent}%</strong></div>
                <div>• Priority Dispatch Score: <strong>{formData.priority_score}</strong></div>
                <div>• Max Cash Debt Allowed: <strong>₹{formData.max_cash_debt_allowed}</strong></div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2.5 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeSave}
                  className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-xl shadow-md"
                >
                  Confirm & Apply Live
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
