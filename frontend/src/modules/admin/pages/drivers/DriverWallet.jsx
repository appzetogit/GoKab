import React, { useEffect, useMemo, useState } from 'react';
import { 
  Wallet, 
  Search, 
  ChevronRight, 
  ArrowUpRight, 
  ArrowDownRight, 
  IndianRupee, 
  History, 
  CreditCard, 
  Download, 
  Filter, 
  MoreHorizontal, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Zap,
  ArrowRight,
  TrendingUp,
  ReceiptText
} from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const signedMoney = (value) => `${Number(value || 0) < 0 ? '-' : '+'}${money(Math.abs(Number(value || 0)))}`;
const shortDate = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

const DriverWallet = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ totalBalance: 0, pendingPayouts: 0, processedToday: 0, failedTransactions: 0 });
  const [rows, setRows] = useState([]);

  // This screen used to render hardcoded figures, so it reported a balance pool
  // and transactions that existed nowhere in the data. It now reads the real ledger.
  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await api.get('/admin/wallet/drivers/ledger', {
          params: { limit: 50, ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}) },
        });
        const payload = response?.data?.data || response?.data || response || {};
        if (!active) return;
        setStats(payload.stats || { totalBalance: 0, pendingPayouts: 0, processedToday: 0, failedTransactions: 0 });
        setRows(Array.isArray(payload.results) ? payload.results : []);
      } catch (err) {
        if (!active) return;
        setError(err?.message || 'Unable to load the fleet ledger');
        setRows([]);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    const timer = setTimeout(load, searchTerm ? 350 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [searchTerm]);

  const walletStats = useMemo(() => ({
    totalBalance: money(stats.totalBalance),
    pendingPayouts: money(stats.pendingPayouts),
    processedToday: money(stats.processedToday),
    failedTransactions: stats.failedTransactions ?? 0,
  }), [stats]);

  const ledger = useMemo(() => rows.map((t) => ({
    id: String(t._id || '').slice(-8).toUpperCase(),
    driver: t.driver || 'Unknown driver',
    type: t.type,
    category: t.category,
    amount: signedMoney(t.amount),
    date: shortDate(t.createdAt),
    status: 'Success',
  })), [rows]);

  return (
    <div className="space-y-10 p-1 animate-in fade-in duration-700 font-sans text-gray-950">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-6">
         <div>
            <h1 className="text-4xl font-black tracking-tight text-gray-900 mb-2 leading-none">Fleet Ledger</h1>
            <div className="flex items-center gap-2 text-[13px] font-bold text-gray-400">
               <span className="text-gray-950">Finance Control</span>
               <ChevronRight size={14} />
               <span>Transaction Audit</span>
            </div>
         </div>
         <div className="flex items-center gap-3">
            <button className="bg-white border border-gray-100 text-gray-950 px-5 py-2.5 rounded-xl text-[12px] font-black flex items-center gap-2 hover:bg-gray-50 transition-all shadow-sm">
               <Download size={16} className="text-gray-400" /> Export CSV
            </button>
            <button className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-[12px] font-black flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-xl">
               <Zap size={16} /> Bulk Settle Payouts
            </button>
         </div>
      </div>

      {/* WALLET SUMMARY */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-8">
         <div className="bg-gray-950 p-4 md:p-8 rounded-[40px] text-white shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 md:p-6 opacity-20 scale-[2.5] -rotate-12 translate-x-4"><Wallet size={80} strokeWidth={1} /></div>
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-6 relative z-10">Total Balance Pool</p>
            <div className="relative z-10 mb-8">
               <p className="text-4xl font-black tracking-tighter leading-none mb-2">{walletStats.totalBalance}</p>
               <p className="text-[11px] font-black text-emerald-400 flex items-center gap-1.5 leading-none">
                  <ArrowUpRight size={14} /> +24% <span className="text-gray-600 uppercase tracking-widest">Growth (MTD)</span>
               </p>
            </div>
         </div>

         <div className="bg-white p-4 md:p-8 rounded-[40px] border border-gray-50 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 md:p-6 opacity-5 scale-[2] -rotate-12 translate-x-4"><Clock size={80} strokeWidth={1} /></div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 relative z-10">Pending Payouts</p>
            <div className="relative z-10">
               <p className="text-3xl font-black text-gray-950 tracking-tight leading-none mb-2">{walletStats.pendingPayouts}</p>
               <p className="text-[11px] font-bold text-amber-500 uppercase flex items-center gap-1.5 leading-none mt-4">
                  Awaiting Settlement
               </p>
            </div>
         </div>

         <div className="bg-white p-4 md:p-8 rounded-[40px] border border-gray-50 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 md:p-6 opacity-5 scale-[2] -rotate-12 translate-x-4 group-hover:scale-[2.4] transition-transform duration-1000"><CheckCircle2 size={80} strokeWidth={1} /></div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 relative z-10">Processed Today</p>
            <div className="relative z-10">
               <p className="text-3xl font-black text-gray-950 tracking-tight leading-none mb-2">{walletStats.processedToday}</p>
               <p className="text-[11px] font-bold text-emerald-600 uppercase flex items-center gap-1.5 leading-none mt-4">
                  Cleared to Bank
               </p>
            </div>
         </div>

         <div className="bg-white p-4 md:p-8 rounded-[40px] border border-rose-50 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 md:p-6 opacity-10 text-rose-500 scale-[2] -rotate-12 translate-x-4"><AlertCircle size={80} strokeWidth={1} /></div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 relative z-10">Verification Failures</p>
            <div className="relative z-10">
               <p className="text-3xl font-black text-rose-500 tracking-tight leading-none mb-2">{walletStats.failedTransactions}</p>
               <p className="text-[11px] font-bold text-rose-600 uppercase flex items-center gap-1.5 leading-none mt-4">
                  Action REQUIRED
               </p>
            </div>
         </div>
      </div>

      {/* LEDGER TABLE */}
      <div className="space-y-8">
         <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <h2 className="text-2xl font-black tracking-tight text-gray-900 leading-none">Stream Ledger</h2>
            <div className="flex items-center gap-3">
               <div className="relative w-80">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search by driver name or phone..." className="w-full pl-11 pr-4 py-3 bg-white border border-gray-100 rounded-xl text-[12px] font-bold focus:ring-2 focus:ring-gray-100 outline-none transition-all" />
               </div>
               <button className="p-3 bg-white border border-gray-100 text-gray-400 rounded-xl hover:text-gray-950 shadow-sm"><Filter size={18} /></button>
            </div>
         </div>

         <div className="bg-white rounded-[40px] border border-gray-50 shadow-sm overflow-hidden">
            <div className="overflow-x-auto no-scrollbar">
               <table className="w-full text-left">
                  <thead>
                     <tr className="border-b border-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] bg-gray-50/20">
                        <th className="px-8 py-6">Transaction ID</th>
                        <th className="px-6 py-6">Operator</th>
                        <th className="px-6 py-6">Categorization</th>
                        <th className="px-6 py-6 text-center">Amount</th>
                        <th className="px-6 py-6 text-center">Status</th>
                        <th className="px-8 py-6 text-right w-10"></th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                     {isLoading && (
                        <tr><td colSpan={6} className="px-8 py-8 text-[12px] font-bold text-gray-400">Loading fleet ledger…</td></tr>
                     )}
                     {!isLoading && error && (
                        <tr><td colSpan={6} className="px-8 py-8 text-[12px] font-bold text-rose-500">{error}</td></tr>
                     )}
                     {!isLoading && !error && ledger.length === 0 && (
                        <tr><td colSpan={6} className="px-8 py-8 text-[12px] font-bold text-gray-400">No wallet transactions yet.</td></tr>
                     )}
                     {ledger.map((txn, i) => (
                        <tr key={i} className="hover:bg-gray-50/20 transition-all cursor-pointer group">
                           <td className="px-8 py-6">
                              <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">{txn.id}</p>
                              <p className="text-[10px] font-bold text-gray-300 mt-1 uppercase">{txn.date}</p>
                           </td>
                           <td className="px-6 py-6">
                              <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-200 text-gray-950 font-black text-[11px] flex items-center justify-center uppercase">
                                    {txn.driver.split(' ').map(n => n[0]).join('')}
                                 </div>
                                 <span className="text-[13px] font-black text-gray-950">{txn.driver}</span>
                              </div>
                           </td>
                           <td className="px-6 py-6 font-bold text-[13px] text-gray-800">
                              <div className="flex items-center gap-2">
                                 <ReceiptText size={16} className="text-gray-300" /> {txn.category}
                              </div>
                           </td>
                           <td className="px-6 py-6 text-center">
                              <span className={`text-[15px] font-black ${txn.type === 'Credit' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                 {txn.amount}
                              </span>
                           </td>
                           <td className="px-6 py-6 text-center">
                              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest border ${txn.status === 'Success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                                 {txn.status}
                              </span>
                           </td>
                           <td className="px-8 py-6 text-right">
                              <button className="p-2.5 text-gray-400 hover:text-gray-950 hover:bg-white rounded-xl transition-all shadow-sm">
                                 <MoreHorizontal size={18} />
                              </button>
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         </div>
      </div>

      {/* FOOTER STATS */}
      <div className="p-4 md:p-8 bg-white border border-gray-50 rounded-[40px] shadow-sm flex items-center justify-between">
         <div className="flex items-center gap-4 md:gap-8">
            <div className="flex items-center gap-3">
               <div className="p-3 bg-emerald-50 text-emerald-500 rounded-2xl border border-emerald-100"><TrendingUp size={24} /></div>
               <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1.5 focus:outline-none">Liquidity Trend</p>
                  <p className="text-xl font-black text-gray-950 tracking-tighter leading-none">POSITIVE</p>
               </div>
            </div>
         </div>
         <button className="flex items-center gap-2 px-8 py-4 bg-gray-50 text-gray-400 text-[11px] font-black uppercase tracking-widest rounded-2xl hover:bg-gray-100 hover:text-gray-950 transition-all border border-gray-100 shadow-sm group">
            Audit full ledger trail <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
         </button>
      </div>
    </div>
  );
};

export default DriverWallet;
