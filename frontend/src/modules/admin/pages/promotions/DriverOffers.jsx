import React, { useEffect, useState } from 'react';
import { ChevronRight, FileSearch, IndianRupee, Loader2, Save, Tag } from 'lucide-react';
import { adminService } from '../../services/adminService';

const inputClass = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";
const cardClass = "bg-white rounded-xl border border-gray-200 p-4 md:p-6 shadow-sm";
const LIMIT = 10;
const RATE_FIELDS = [
  ['hour_rate', 'Per hour (₹)'],
  ['day_rate', 'Per day (₹)'],
  ['week_rate', 'Per week (₹)'],
  ['month_rate', 'Per month (₹)'],
  ['max_live_hours', 'Max live hours'],
];
const STATUS_STYLES = {
  active: 'bg-emerald-50 text-emerald-700',
  expired: 'bg-gray-100 text-gray-600',
  deactivated: 'bg-rose-50 text-rose-700',
};
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—');
const errMsg = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

const DriverOffers = () => {
  const [pricing, setPricing] = useState({ hour_rate: 0, day_rate: 0, week_rate: 0, month_rate: 0, max_live_hours: 0, enabled: true });
  const [pricingLoading, setPricingLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [offers, setOffers] = useState([]);
  const [revenue, setRevenue] = useState({ total: 0, paid_offers: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminService.getOfferPricing();
        if (res?.data) setPricing((p) => ({ ...p, ...res.data }));
      } catch (err) {
        alert(errMsg(err, 'Failed to load fee rates'));
      } finally {
        setPricingLoading(false);
      }
    })();
  }, []);

  const fetchOffers = async () => {
    setLoading(true);
    try {
      const res = await adminService.getDriverOffers({ status, page, limit: LIMIT });
      const d = res?.data || {};
      setOffers(d.results || []);
      setTotal(d.total || 0);
      setRevenue(d.revenue || { total: 0, paid_offers: 0 });
    } catch (err) {
      alert(errMsg(err, 'Failed to load offers'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOffers(); }, [status, page]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { enabled: !!pricing.enabled };
      RATE_FIELDS.forEach(([k]) => { payload[k] = Number(pricing[k]) || 0; });
      const res = await adminService.updateOfferPricing(payload);
      if (res?.success) {
        setPricing((p) => ({ ...p, ...res.data }));
        alert('Fee rates saved');
      } else {
        alert(res?.message || 'Failed to save fee rates');
      }
    } catch (err) {
      alert(errMsg(err, 'Server error occurred'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (offer) => {
    if (!window.confirm('Deactivate this offer? It will no longer be visible to users.')) return;
    try {
      const res = await adminService.deactivateDriverOffer(offer.id);
      if (res?.success) fetchOffers();
      else alert(res?.message || 'Failed to deactivate offer');
    } catch (err) {
      alert(errMsg(err, 'Failed to deactivate offer'));
    }
  };

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8 animate-in fade-in duration-500 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
            <span>Promotions</span>
            <ChevronRight size={12} />
            <span className="text-gray-700">Driver Offers</span>
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Driver Offers</h1>
        </div>

        <div className={cardClass}>
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600"><Tag size={18} /></div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Publishing fee rates</h3>
              <p className="text-xs text-gray-400">Set 0 to not offer a slab. Drivers pay the cheapest combination, e.g. 2 hours = 2 x hour rate.</p>
            </div>
          </div>
          {pricingLoading ? (
            <div className="py-10 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" /></div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {RATE_FIELDS.map(([key, label]) => (
                  <div key={key}>
                    <label className={labelClass}>{label}</label>
                    <input type="number" min="0" value={pricing[key] ?? ''} onChange={(e) => setPricing((p) => ({ ...p, [key]: e.target.value }))} className={inputClass} />
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={!!pricing.enabled} onChange={(e) => setPricing((p) => ({ ...p, enabled: e.target.checked }))} className="w-4 h-4 accent-indigo-600" />
                  Enabled
                </label>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
                </button>
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={cardClass}>
            <p className={labelClass}>Total collected</p>
            <p className="text-2xl font-semibold text-gray-900 flex items-center"><IndianRupee size={20} />{Number(revenue.total || 0).toLocaleString()}</p>
          </div>
          <div className={cardClass}>
            <p className={labelClass}>Paid offers</p>
            <p className="text-2xl font-semibold text-gray-900">{revenue.paid_offers || 0}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/30">
            <h3 className="text-sm font-semibold text-gray-900">Offers</h3>
            <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="border border-gray-200 rounded px-2 py-1 text-sm bg-white outline-none focus:border-indigo-500">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Company', 'Route', 'Driver', 'Offer price', 'Fee paid', 'Live until', 'Status'].map((h) => (
                    <th key={h} className="px-6 py-4 text-left font-semibold text-gray-700">{h}</th>
                  ))}
                  <th className="px-6 py-4 text-right font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan="8" className="py-20 text-center text-gray-400"><Loader2 className="animate-spin mx-auto mb-2" /><span>Loading data...</span></td></tr>
                ) : offers.length > 0 ? (
                  offers.map((o) => (
                    <tr key={o.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{o.company || '—'}</td>
                      <td className="px-6 py-4 text-gray-600">{o.from?.name || '—'} → {o.to?.name || '—'}</td>
                      <td className="px-6 py-4 text-gray-600">{o.driver?.name || '—'}<div className="text-xs text-gray-400">{o.driver?.phone}</div></td>
                      <td className="px-6 py-4 text-gray-600">₹{o.offer_price}</td>
                      <td className="px-6 py-4 text-gray-600">₹{o.fee_amount ?? 0}</td>
                      <td className="px-6 py-4 text-gray-600">{fmtDate(o.live_until)}</td>
                      <td className="px-6 py-4">
                        <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[o.status] || STATUS_STYLES.expired}`}>{o.status}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {o.status === 'active' && (
                          <button onClick={() => handleDeactivate(o)} className="px-3 py-1.5 text-xs font-medium text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors">Deactivate</button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8" className="py-32 text-center text-gray-400">
                      <FileSearch size={48} className="mx-auto mb-4 opacity-20" />
                      <h3 className="text-gray-900 font-semibold">No Data Found</h3>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
            <span>Page {page} of {pages} ({total} offers)</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50">Prev</button>
              <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriverOffers;
