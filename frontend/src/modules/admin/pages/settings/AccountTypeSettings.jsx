import React, { useState, useEffect } from 'react';
import { Save, Loader2, ShieldCheck, Zap, Layers, Power, RefreshCw, AlertCircle } from 'lucide-react';
import { adminService } from '../../services/adminService.js';

export default function AccountTypeSettings() {
  const [settings, setSettings] = useState({
    vendor_min_vehicles: 2,
    vendor_max_vehicles: 4,
    super_fleet_min_vehicles: 5,
    grace_period_days: 30,
    delivery_module_globally_enabled: true,
    pooling_module_globally_enabled: true,
    copy_individual: '',
    copy_vendor: '',
    copy_super_fleet_owner: '',
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      const res = await adminService.getAccountTypeSettings();
      const data = res?.data || res || {};
      setSettings({
        vendor_min_vehicles: data.vendor_min_vehicles ?? 2,
        vendor_max_vehicles: data.vendor_max_vehicles ?? 4,
        super_fleet_min_vehicles: data.super_fleet_min_vehicles ?? 5,
        grace_period_days: data.grace_period_days ?? 30,
        delivery_module_globally_enabled: Boolean(data.delivery_module_globally_enabled),
        pooling_module_globally_enabled: Boolean(data.pooling_module_globally_enabled),
        copy_individual: data.copy_individual || '',
        copy_vendor: data.copy_vendor || '',
        copy_super_fleet_owner: data.copy_super_fleet_owner || '',
      });
    } catch (err) {
      console.error('Error fetching account type settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setStatusMsg({ type: '', text: '' });
    try {
      setIsSaving(true);
      await adminService.updateAccountTypeSettings(settings);
      setStatusMsg({ type: 'success', text: 'Account type settings updated successfully!' });
    } catch (err) {
      setStatusMsg({ type: 'error', text: err?.response?.data?.message || 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-16 text-center bg-white rounded-3xl border border-gray-100 shadow-sm space-y-3 font-sans">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto" />
        <p className="text-sm font-bold text-gray-500">Loading Account Type Configuration...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8 font-sans">
      {/* HEADER */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-8 rounded-3xl shadow-xl border border-slate-800 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-xs font-black uppercase tracking-wider mb-2">
            <ShieldCheck size={14} /> Driver Classification & Threshold Rules
          </div>
          <h1 className="text-3xl font-black">Account Type & Capability Settings</h1>
          <p className="text-sm text-slate-300 mt-1 max-w-xl font-medium">
            Configure vehicle count thresholds, grace period reconciliation lengths, onboarding copy, and global module kill switches.
          </p>
        </div>
        <button
          onClick={fetchSettings}
          className="p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-2xl transition border border-slate-700/60"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {statusMsg.text && (
        <div className={`p-4 rounded-2xl text-xs font-bold ${statusMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
          {statusMsg.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* SECTION 1: GLOBAL MASTER KILL SWITCHES */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
            <Power size={16} /> Global Module Master Kill Switches
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-gray-900">Delivery / Parcel Global Master Switch</p>
                <p className="text-xs text-gray-500">If OFF, no driver can enable delivery regardless of subscription tier.</p>
              </div>
              <input
                type="checkbox"
                checked={settings.delivery_module_globally_enabled}
                onChange={(e) => setSettings({ ...settings, delivery_module_globally_enabled: e.target.checked })}
                className="w-6 h-6 accent-indigo-600 rounded cursor-pointer"
              />
            </div>

            <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-gray-900">Pooling / Carpool Global Master Switch</p>
                <p className="text-xs text-gray-500">If OFF, no driver can enable carpooling regardless of subscription tier.</p>
              </div>
              <input
                type="checkbox"
                checked={settings.pooling_module_globally_enabled}
                onChange={(e) => setSettings({ ...settings, pooling_module_globally_enabled: e.target.checked })}
                className="w-6 h-6 accent-indigo-600 rounded cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* SECTION 2: VEHICLE THRESHOLDS & GRACE PERIOD */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
            <Zap size={16} /> Category Vehicle Thresholds & Reconciliation Window
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Vendor Min Vehicles</label>
              <input
                type="number"
                min="1"
                value={settings.vendor_min_vehicles}
                onChange={(e) => setSettings({ ...settings, vendor_min_vehicles: Number(e.target.value) })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Vendor Max Vehicles</label>
              <input
                type="number"
                min="1"
                value={settings.vendor_max_vehicles}
                onChange={(e) => setSettings({ ...settings, vendor_max_vehicles: Number(e.target.value) })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Super Fleet Min Vehicles</label>
              <input
                type="number"
                min="1"
                value={settings.super_fleet_min_vehicles}
                onChange={(e) => setSettings({ ...settings, super_fleet_min_vehicles: Number(e.target.value) })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Grace Period (Days)</label>
              <input
                type="number"
                min="1"
                value={settings.grace_period_days}
                onChange={(e) => setSettings({ ...settings, grace_period_days: Number(e.target.value) })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-bold"
              />
            </div>
          </div>
        </div>

        {/* SECTION 3: ONBOARDING DESCRIPTION COPY */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-indigo-600 flex items-center gap-2">
            <Layers size={16} /> Onboarding Screen Category Description Copy
          </h3>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Individual Driver Copy</label>
              <input
                type="text"
                value={settings.copy_individual}
                onChange={(e) => setSettings({ ...settings, copy_individual: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Vendor Copy</label>
              <input
                type="text"
                value={settings.copy_vendor}
                onChange={(e) => setSettings({ ...settings, copy_vendor: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Super Fleet Owner Copy</label>
              <input
                type="text"
                value={settings.copy_super_fleet_owner}
                onChange={(e) => setSettings({ ...settings, copy_super_fleet_owner: e.target.value })}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-medium"
              />
            </div>
          </div>
        </div>

        {/* SAVE BUTTON */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-black text-sm rounded-2xl shadow-lg shadow-indigo-200 flex items-center gap-2 transition"
          >
            <Save size={18} /> {isSaving ? 'Saving Settings...' : 'Save Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
}
