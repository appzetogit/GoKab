import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Car,
  CircleAlert,
  Clock,
  CreditCard,
  History,
  IndianRupee,
  ShieldCheck,
  UserCheck,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { BACKEND_LABEL } from '../../../../shared/api/runtimeConfig';

const currency = (value) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
const DASHBOARD_REFRESH_INTERVAL_MS = 30000;

const MetricCard = ({ label, value, icon: Icon, color, isLoading, subtitle, onClick }) => (
  <div
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={(e) => onClick && (e.key === 'Enter' || e.key === ' ') && onClick()}
    className={`group relative overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white p-4 md:p-8 shadow-sm transition-all hover:border-slate-900 hover:shadow-2xl hover:shadow-slate-200/50 ${
      onClick ? 'cursor-pointer hover:-translate-y-0.5' : ''
    }`}
  >
    <div className="flex items-start justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 mb-2">{label}</p>
        {isLoading ? (
          <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-50" />
        ) : (
          <h4 className="text-3xl font-black text-slate-900 tracking-tight">{value}</h4>
        )}
        {subtitle && <p className="mt-2 text-[11px] font-bold text-slate-400 uppercase tracking-widest">{subtitle}</p>}
      </div>
      <div className={`rounded-2xl bg-slate-50 p-3 ${color} transition-colors group-hover:bg-slate-900 group-hover:text-white`}>
        <Icon size={20} strokeWidth={2.5} />
      </div>
    </div>
  </div>
);

const RevenueGrid = ({ label, value, icon: Icon, color, isLoading, onClick }) => (
  <div
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={(e) => onClick && (e.key === 'Enter' || e.key === ' ') && onClick()}
    className={`flex items-center justify-between rounded-3xl border border-slate-100 bg-slate-50/50 p-5 transition-all hover:bg-white hover:shadow-xl hover:shadow-slate-200/30 group ${
      onClick ? 'cursor-pointer' : ''
    }`}
  >
    <div className="flex items-center gap-4">
      <div className={`rounded-2xl bg-white p-2.5 shadow-sm ${color} group-hover:bg-slate-900 group-hover:text-white transition-colors`}>
        <Icon size={16} strokeWidth={2.5} />
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
        <p className="text-[14px] font-black text-slate-900 mt-0.5">₹{currency(value)}</p>
      </div>
    </div>
  </div>
);

const MainDashboard = () => {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetch = async (silent = false) => {
      try {
        silent ? setIsRefreshing(true) : setIsLoading(true);
        const res = await adminService.getDashboardData();
        if (!isMounted) return;
        setDashboard(res?.data || res || {});
        setDashboardError('');
        setLastUpdatedAt(new Date());
      } catch (err) {
        if (!isMounted) return;
        setDashboardError(`System offline. Connection to ${BACKEND_LABEL} failed.`);
      } finally {
        if (!isMounted) return;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    };

    fetch();
    const interval = setInterval(() => fetch(true), DASHBOARD_REFRESH_INTERVAL_MS);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const todayEarnings = dashboard?.todayEarnings || {};
  const overallEarnings = dashboard?.overallEarnings || {};
  const notifiedSos = dashboard?.notifiedSos || {};
  const todayTrips = dashboard?.todayTrips || {};

  const totalEarningsToday = Number(todayEarnings.total || 0);
  const cashShare = totalEarningsToday > 0 ? Math.round(((todayEarnings.by_cash || 0) / totalEarningsToday) * 100) : 0;
  const walletShare = totalEarningsToday > 0 ? Math.round(((todayEarnings.by_wallet || 0) / totalEarningsToday) * 100) : 0;
  const cardShare = totalEarningsToday > 0 ? Math.round(((todayEarnings.by_card || 0) / totalEarningsToday) * 100) : 0;

  return (
    <div className="min-h-screen animate-in fade-in duration-500 bg-[#F8F9FA] p-4 md:p-6 lg:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">Operations Hub</span>
            </div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight">Executive Dashboard</h1>
          </div>
          <div className="hidden md:flex flex-col items-end gap-2">
            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-slate-200 shadow-sm">
              <Clock size={14} className="text-slate-400" />
              <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">
                Live: {lastUpdatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            {isRefreshing && <p className="text-[9px] font-black text-emerald-500 uppercase tracking-[0.2em] animate-pulse">Syncing live data...</p>}
          </div>
        </div>

        {dashboardError && (
          <div className="rounded-3xl bg-rose-50 border border-rose-100 p-4 md:p-6 flex items-center gap-5">
            <div className="h-12 w-12 bg-white rounded-2xl flex items-center justify-center text-rose-500 shadow-sm">
              <CircleAlert size={24} />
            </div>
            <div>
              <p className="text-[14px] font-black text-rose-900">Communication Error</p>
              <p className="text-xs font-bold text-rose-600 mt-1 uppercase tracking-widest">{dashboardError}</p>
            </div>
          </div>
        )}

        {/* Primary KPI Grid - Linked to Real Admin Pages */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-8">
          <MetricCard
            label="Fleet Inventory"
            value={dashboard?.totalDrivers?.total || 0}
            icon={Car}
            color="text-slate-900"
            isLoading={isLoading}
            subtitle="Total Registered Drivers"
            onClick={() => navigate('/admin/drivers')}
          />
          <MetricCard
            label="Active Drivers"
            value={dashboard?.totalDrivers?.approved || 0}
            icon={ShieldCheck}
            color="text-emerald-500"
            isLoading={isLoading}
            subtitle="Verified & Approved"
            onClick={() => navigate('/admin/drivers/active')}
          />
          <MetricCard
            label="Pending Drivers"
            value={dashboard?.totalDrivers?.declined || 0}
            icon={Clock}
            color="text-amber-500"
            isLoading={isLoading}
            subtitle="Awaiting Verification"
            onClick={() => navigate('/admin/drivers/pending')}
          />
          <MetricCard
            label="User Base"
            value={dashboard?.totalUsers || 0}
            icon={Users}
            color="text-sky-500"
            isLoading={isLoading}
            subtitle="Registered Customers"
            onClick={() => navigate('/admin/users')}
          />
        </div>

        {/* Intelligence Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-8">
          {/* Revenue Intel */}
          <div className="lg:col-span-8 rounded-[3rem] border border-slate-200 bg-white p-6 md:p-10 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Revenue Intel</h3>
                <p className="text-[12px] font-bold text-slate-400 uppercase tracking-widest mt-1">Transaction Breakdown · Today</p>
              </div>
              <div
                onClick={() => navigate('/admin/earnings')}
                className="bg-slate-50 px-5 py-2.5 rounded-2xl border border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors"
              >
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Net Volume</p>
                <p className="text-lg font-black text-slate-900 tracking-tight">₹{currency(todayEarnings.total)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              <RevenueGrid
                label="Cash Flows"
                value={todayEarnings.by_cash}
                icon={Wallet}
                color="text-emerald-500"
                isLoading={isLoading}
                onClick={() => navigate('/admin/earnings')}
              />
              <RevenueGrid
                label="Wallet Assets"
                value={todayEarnings.by_wallet}
                icon={Zap}
                color="text-sky-500"
                isLoading={isLoading}
                onClick={() => navigate('/admin/earnings')}
              />
              <RevenueGrid
                label="Electronic / Cards"
                value={todayEarnings.by_card}
                icon={CreditCard}
                color="text-indigo-500"
                isLoading={isLoading}
                onClick={() => navigate('/admin/earnings')}
              />
              <RevenueGrid
                label="Admin Commission"
                value={todayEarnings.admin_commission}
                icon={ShieldCheck}
                color="text-amber-500"
                isLoading={isLoading}
                onClick={() => navigate('/admin/earnings')}
              />
              <RevenueGrid
                label="Fleet Payouts"
                value={todayEarnings.driver_earnings}
                icon={UserCheck}
                color="text-slate-400"
                isLoading={isLoading}
                onClick={() => navigate('/admin/drivers/wallet/withdrawals')}
              />
              <div
                onClick={() => navigate('/admin/reports/finance')}
                className="flex items-center justify-between rounded-3xl border border-dashed border-slate-200 bg-white p-5 group cursor-pointer hover:border-slate-900 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="rounded-2xl bg-slate-50 p-2.5 group-hover:bg-slate-900 group-hover:text-white transition-colors">
                    <BarChart3 size={16} />
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Finance Report</p>
                </div>
                <ArrowRight size={14} className="text-slate-200 group-hover:text-slate-900" />
              </div>
            </div>

            {/* Revenue Distribution Breakdown Chart */}
            <div className="mt-10 pt-8 border-t border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Payment Breakdown Share</p>
                <button
                  onClick={() => navigate('/admin/earnings')}
                  className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
                >
                  Full Breakdown →
                </button>
              </div>

              <div className="space-y-3">
                <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex">
                  <div style={{ width: `${cashShare}%` }} className="bg-emerald-500 transition-all duration-500" title={`Cash: ${cashShare}%`} />
                  <div style={{ width: `${walletShare}%` }} className="bg-sky-500 transition-all duration-500" title={`Wallet: ${walletShare}%`} />
                  <div style={{ width: `${cardShare}%` }} className="bg-indigo-500 transition-all duration-500" title={`Card: ${cardShare}%`} />
                </div>

                <div className="flex flex-wrap items-center justify-between text-xs font-bold text-slate-500 pt-1 gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" />
                    <span>Cash: ₹{currency(todayEarnings.by_cash)} ({cashShare}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-sky-500 inline-block" />
                    <span>Wallet: ₹{currency(todayEarnings.by_wallet)} ({walletShare}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 inline-block" />
                    <span>Card: ₹{currency(todayEarnings.by_card)} ({cardShare}%)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SOS Terminal */}
          <div className="lg:col-span-4 space-y-8">
            <div
              onClick={() => navigate('/admin/safety')}
              className="group h-full flex flex-col justify-between rounded-[3rem] border border-slate-200 bg-white p-6 md:p-10 shadow-sm transition-all hover:border-slate-900 hover:shadow-2xl hover:shadow-slate-200/50 cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">SOS Terminal</h3>
                  <p className="text-[12px] font-bold text-slate-400 uppercase tracking-widest mt-1">Safety Monitoring</p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-[1.25rem] bg-rose-50 text-rose-500 transition-colors group-hover:bg-rose-500 group-hover:text-white">
                  <Activity size={24} strokeWidth={2.5} />
                </div>
              </div>

              <div className="py-8 flex flex-col items-center">
                <div className="relative">
                  <div className="text-7xl font-black text-slate-900 tracking-tighter leading-none">{notifiedSos.total || 0}</div>
                  {Number(notifiedSos.total || 0) > 0 && (
                    <div className="absolute -top-2 -right-2 h-4 w-4 bg-rose-500 rounded-full border-2 border-white animate-ping" />
                  )}
                </div>
                <p className="mt-4 text-[11px] font-black uppercase tracking-[0.4em] text-slate-400">Active Emergency Signals</p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100 group-hover:bg-white transition-colors">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Assigned Response</span>
                  <span className="text-sm font-black text-slate-900">{notifiedSos.assigned || 0}</span>
                </div>
                <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-100 group-hover:bg-white transition-colors">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Resolved Alerts</span>
                  <span className="text-sm font-black text-slate-900">{notifiedSos.closed || 0}</span>
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/admin/safety');
                }}
                className="mt-8 w-full py-4 rounded-2xl bg-slate-900 text-white text-[13px] font-black uppercase tracking-widest shadow-xl shadow-slate-900/10 transition-all group-hover:scale-[1.02]"
              >
                Open Safety Center
              </button>
            </div>
          </div>
        </div>

        {/* Financial & Operations Summary */}
        <div className="rounded-[3rem] border border-slate-200 bg-white p-6 md:p-10 shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Financial & Operations Summary</h3>
              <p className="text-[12px] font-bold text-slate-400 uppercase tracking-widest mt-1">All-time Revenue & Trip Statistics</p>
            </div>
            <button
              onClick={() => navigate('/admin/reports/finance')}
              className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-slate-900 transition-colors"
            >
              View Finance Report
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {[
              {
                label: 'Cumulative Volume',
                val: overallEarnings.total,
                icon: IndianRupee,
                color: 'text-slate-900',
                path: '/admin/reports/finance',
              },
              {
                label: 'Admin Net Commission',
                val: overallEarnings.admin_commission,
                icon: ShieldCheck,
                color: 'text-amber-500',
                path: '/admin/earnings',
              },
              {
                label: 'Driver Earnings Paid',
                val: overallEarnings.driver_earnings,
                icon: UserCheck,
                color: 'text-sky-500',
                path: '/admin/drivers/wallet/withdrawals',
              },
              {
                label: 'Completed Trips Today',
                val: todayTrips.completed || 0,
                icon: History,
                color: 'text-emerald-500',
                isCurrency: false,
                path: '/admin/trips',
              },
            ].map((item, i) => (
              <div
                key={i}
                onClick={() => navigate(item.path)}
                className="group p-4 md:p-6 rounded-[2rem] bg-slate-50/50 border border-slate-100 transition-all hover:bg-white hover:shadow-xl hover:shadow-slate-200/40 cursor-pointer"
              >
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</p>
                  <item.icon size={14} className={item.color} strokeWidth={2.5} />
                </div>
                <p className="text-2xl font-black text-slate-900">
                  {item.isCurrency === false ? item.val : `₹${currency(item.val)}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MainDashboard;
