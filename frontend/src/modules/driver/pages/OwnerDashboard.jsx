import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Bus,
  Car,
  CreditCard,
  IndianRupee,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  TrendingUp,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../../../shared/context/SettingsContext';
import DriverBottomNav from '../../shared/components/DriverBottomNav';
import {
  getOwnerFleetDashboard,
  getOwnerFleetAnalytics,
  addOwnerHiredDriver,
  enableOwnerSelfDrive,
  switchOwnerToSelfDriveSession,
  persistDriverAuthSession,
} from '../services/registrationService';

const isEnabledFlag = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase());
};

const money = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

const formatRelativeDate = (value) => {
  if (!value) {
    return 'Recently';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const statusTone = (value = '') => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'approved' || normalized === 'completed' || normalized === 'active') {
    return 'bg-emerald-50 text-emerald-600';
  }
  if (normalized === 'pending' || normalized === 'accepted' || normalized === 'ongoing') {
    return 'bg-amber-50 text-amber-600';
  }
  if (normalized === 'cancelled' || normalized === 'rejected' || normalized === 'inactive') {
    return 'bg-rose-50 text-rose-600';
  }
  return 'bg-slate-100 text-slate-600';
};

const StatCard = ({ icon, label, value, sub, tone = 'slate' }) => {
  const toneClass =
    tone === 'emerald'
      ? 'from-emerald-500 to-teal-500 text-white'
      : tone === 'blue'
        ? 'from-blue-600 to-indigo-600 text-white'
        : tone === 'amber'
          ? 'from-amber-500 to-orange-500 text-white'
          : 'from-slate-900 to-slate-800 text-white';

  return (
    <div className={`rounded-[28px] bg-gradient-to-br ${toneClass} p-5 shadow-xl`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/65">{label}</p>
          <p className="mt-2 text-[28px] font-black tracking-tight leading-none">{value}</p>
          {sub ? <p className="mt-2 text-[11px] font-bold text-white/75">{sub}</p> : null}
        </div>
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-white">
          {icon}
        </div>
      </div>
    </div>
  );
};

const OwnerDashboard = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = async ({ silent = false } = {}) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError('');

    try {
      const response = await getOwnerFleetDashboard();
      const payload = response?.data?.data || response?.data || response;
      setDashboard(payload);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError?.message || 'Unable to load owner dashboard');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const [activeTab, setActiveTab] = useState('overview');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [selfDriveLoading, setSelfDriveLoading] = useState(false);

  const [addDriverModalOpen, setAddDriverModalOpen] = useState(false);
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [newDriverName, setNewDriverName] = useState('');
  const [addDriverLoading, setAddDriverLoading] = useState(false);
  const [addDriverMessage, setAddDriverMessage] = useState('');

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const response = await getOwnerFleetAnalytics();
      const payload = response?.data?.data || response?.data || response;
      setAnalyticsData(payload);
    } catch (err) {
      console.warn('Fleet analytics load error:', err);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const handleSelfDriveToggle = async () => {
    setSelfDriveLoading(true);
    try {
      let selfDriveId = profile.selfDriveDriverId;
      if (!selfDriveId) {
        const res = await enableOwnerSelfDrive();
        selfDriveId = res?.data?.data?.selfDriveDriverId || res?.data?.selfDriveDriverId;
      }
      const sessionRes = await switchOwnerToSelfDriveSession();
      const token = sessionRes?.data?.data?.token || sessionRes?.data?.token;
      if (token) {
        persistDriverAuthSession({ token, role: 'driver' });
        navigate('/taxi/driver/home', { replace: true });
      }
    } catch (err) {
      console.error('Self-drive error:', err);
    } finally {
      setSelfDriveLoading(false);
    }
  };

  const handleAddHiredDriver = async (e) => {
    e.preventDefault();
    if (!newDriverPhone || newDriverPhone.length !== 10) {
      setAddDriverMessage('Please enter a valid 10-digit mobile number');
      return;
    }
    setAddDriverLoading(true);
    setAddDriverMessage('');
    try {
      const res = await addOwnerHiredDriver({ phone: newDriverPhone, name: newDriverName });
      const msg = res?.data?.message || 'Driver linked successfully';
      setAddDriverMessage(msg);
      setNewDriverPhone('');
      setNewDriverName('');
      loadDashboard({ silent: true });
    } catch (err) {
      setAddDriverMessage(err?.response?.data?.message || err?.message || 'Error adding driver');
    } finally {
      setAddDriverLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics') {
      loadAnalytics();
    }
  }, [activeTab]);

  const profile = dashboard?.profile || {};
  const fleet = dashboard?.fleet || {};
  const bookings = dashboard?.bookings || {};
  const earnings = dashboard?.earnings || {};
  const serviceLocation = dashboard?.serviceLocation || null;
  const recentDrivers = dashboard?.recentDrivers || [];
  const recentVehicles = dashboard?.recentVehicles || [];
  const recentBusBookings = dashboard?.recentBusBookings || [];
  const busOverview = dashboard?.busOverview || {};
  const recentRides = dashboard?.recentRides || [];
  const transportBreakdown = dashboard?.transportBreakdown || [];
  const busEnabled = isEnabledFlag(settings.transportRide?.enable_bus_service);

  const businessSubtitle = useMemo(() => {
    const ownerName = profile.ownerName || profile.companyName || 'Owner';
    const serviceName = serviceLocation?.name || profile.city || 'Service area';
    return `${ownerName} • ${serviceName}`;
  }, [profile.city, profile.companyName, profile.ownerName, serviceLocation?.name]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fb] pb-32">
      <div className="mx-auto max-w-lg px-5 pt-10">
        <header className="rounded-[32px] bg-slate-900 px-5 py-6 text-white shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-400">Owner Dashboard</p>
              <h1 className="mt-2 text-[28px] font-black tracking-tight leading-none">
                {profile.companyName || profile.ownerName || 'Fleet Business'}
              </h1>
              <p className="mt-2 text-[12px] font-bold text-white/70">{businessSubtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => loadDashboard({ silent: true })}
              disabled={isRefreshing}
              className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-white disabled:opacity-60"
              aria-label="Refresh dashboard"
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">Wallet</p>
              <p className="mt-2 text-[20px] font-black">{money(earnings.walletBalance)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">Today Earnings</p>
              <p className="mt-2 text-[20px] font-black">{money(earnings.todayOwnerEarnings)}</p>
            </div>
          </div>
        </header>

        {profile.gracePeriodEndsAt ? (
          <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-amber-700">Grace Period Active</p>
                <p className="mt-1 text-[13px] font-bold">
                  Add more vehicles to maintain your {profile.accountType === 'super_fleet_owner' ? 'Super Fleet' : 'Vendor'} status before {formatRelativeDate(profile.gracePeriodEndsAt)}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/taxi/owner/add-vehicle')}
                className="shrink-0 rounded-xl bg-amber-600 px-3 py-1.5 text-[11px] font-black text-white"
              >
                Add Vehicle
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex rounded-2xl bg-white p-1 shadow-sm border border-slate-100">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`rounded-xl px-4 py-2 text-[12px] font-black transition-all ${
                activeTab === 'overview' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className={`rounded-xl px-4 py-2 text-[12px] font-black transition-all ${
                activeTab === 'analytics' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Fleet Analytics
            </button>
          </div>

          <button
            type="button"
            onClick={handleSelfDriveToggle}
            disabled={selfDriveLoading}
            className="flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-[12px] font-black text-white shadow-md hover:bg-emerald-700 disabled:opacity-50"
          >
            {selfDriveLoading ? <Loader2 size={16} className="animate-spin" /> : <Car size={16} />}
            {profile.selfDriveDriverId ? 'Go Online & Drive' : 'Enable & Drive'}
          </button>
        </div>

        {activeTab === 'analytics' ? (
          <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Fleet Analytics</p>
                <h2 className="mt-1 text-[20px] font-black text-slate-950">Per-driver performance</h2>
              </div>
              <button
                type="button"
                onClick={() => setAddDriverModalOpen(true)}
                className="rounded-xl bg-slate-900 px-3 py-2 text-[11px] font-black text-white"
              >
                + Add Driver
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {analyticsLoading ? (
                <div className="py-8 text-center text-slate-400">
                  <Loader2 size={24} className="mx-auto animate-spin" />
                  <p className="mt-2 text-[12px] font-bold">Loading fleet analytics...</p>
                </div>
              ) : !analyticsData?.driverAnalytics || analyticsData.driverAnalytics.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-5 text-[12px] font-bold text-slate-400 text-center">
                  No hired drivers in your fleet yet. Click "+ Add Driver" to invite drivers.
                </div>
              ) : (
                analyticsData.driverAnalytics.map((item) => (
                  <div key={item.driverId} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[14px] font-black text-slate-900">
                          {item.name || 'Hired Driver'} {item.isSelfDriveOwner ? '(Self)' : ''}
                        </p>
                        <p className="mt-0.5 text-[11px] font-bold text-slate-500">{item.phone}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${item.isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {item.isOnRide ? 'On Ride' : item.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-white p-2">
                        <p className="text-[9px] font-black uppercase text-slate-400">Today Earned</p>
                        <p className="mt-1 text-[13px] font-black text-emerald-600">{money(item.todayEarnings)}</p>
                      </div>
                      <div className="rounded-xl bg-white p-2">
                        <p className="text-[9px] font-black uppercase text-slate-400">Today Rides</p>
                        <p className="mt-1 text-[13px] font-black text-slate-900">{item.todayRides}</p>
                      </div>
                      <div className="rounded-xl bg-white p-2">
                        <p className="text-[9px] font-black uppercase text-slate-400">Total Rides</p>
                        <p className="mt-1 text-[13px] font-black text-slate-900">{item.totalRides}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="mt-5 grid grid-cols-2 gap-3">
          <StatCard
            icon={<Users size={22} />}
            label="Fleet Drivers"
            value={fleet.totalDrivers || 0}
            sub={`${fleet.onlineDrivers || 0} online • ${fleet.busyDrivers || 0} on trip`}
            tone="blue"
          />
          <StatCard
            icon={<Car size={22} />}
            label="Fleet Vehicles"
            value={fleet.totalVehicles || 0}
            sub={`${fleet.approvedVehicles || 0} approved • ${fleet.pendingVehicles || 0} pending`}
            tone="emerald"
          />
          <StatCard
            icon={<Briefcase size={22} />}
            label="Total Bookings"
            value={bookings.total || 0}
            sub={`${bookings.active || 0} active right now`}
            tone="amber"
          />
          <StatCard
            icon={<IndianRupee size={22} />}
            label="Gross Revenue"
            value={money(earnings.grossRevenue)}
            sub={`${money(earnings.ownerEarnings)} net driver earnings`}
          />
        </section>

        {busEnabled ? (
          <>
            <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Bus Business</p>
                  <h2 className="mt-1 text-[20px] font-black text-slate-950">Owner bus snapshot</h2>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/taxi/owner/bus-service')}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-[11px] font-black text-white"
                >
                  <Bus size={14} />
                  Open Bus
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Buses</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{busOverview.totalBuses || 0}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">{busOverview.activeBuses || 0} active</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bus Bookings</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{busOverview.totalBookings || 0}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">{busOverview.upcomingBookings || 0} upcoming</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confirmed</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{busOverview.confirmedBookings || 0}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">live paid seats</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Bus Revenue</p>
                  <p className="mt-2 text-[18px] font-black text-slate-900">{money(busOverview.grossRevenue)}</p>
                  <p className="mt-1 text-[10px] font-bold text-slate-500">pending + confirmed</p>
                </div>
              </div>
            </section>

            <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Recent Bus Bookings</p>
                  <h2 className="mt-1 text-[20px] font-black text-slate-950">Latest seat reservations</h2>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/taxi/owner/bus-bookings')}
                  className="text-[11px] font-black text-blue-600"
                >
                  View all
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {recentBusBookings.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 px-4 py-5 text-[12px] font-bold text-slate-400">
                    No bus bookings found yet.
                  </div>
                ) : (
                  recentBusBookings.map((booking) => (
                    <div key={booking.id} className="rounded-2xl bg-slate-50 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-black text-slate-900">
                            {booking.busService?.busName || booking.routeSnapshot?.busName || 'Bus Service'}
                          </p>
                          <p className="mt-1 text-[11px] font-bold text-slate-500">
                            {booking.routeSnapshot?.originCity || 'Origin'} to {booking.routeSnapshot?.destinationCity || 'Destination'}
                          </p>
                          <p className="mt-1 text-[11px] font-bold text-slate-500">
                            {booking.passenger?.name || 'Passenger'} • {booking.seatLabels?.length || booking.seatIds?.length || 0} seats • {booking.travelDate || '-'}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusTone(booking.status)}`}>
                            {booking.status || 'pending'}
                          </span>
                          <p className="mt-2 text-[12px] font-black text-emerald-600">{money(booking.amount)}</p>
                          <p className="mt-1 text-[10px] font-bold text-slate-400">{formatRelativeDate(booking.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Business Overview</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Live business snapshot</h2>
            </div>
            <TrendingUp size={20} className="text-emerald-500" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Completed</p>
              <p className="mt-2 text-[18px] font-black text-slate-900">{bookings.completed || 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cancelled</p>
              <p className="mt-2 text-[18px] font-black text-slate-900">{bookings.cancelled || 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cash Trips</p>
              <p className="mt-2 text-[18px] font-black text-slate-900">{earnings.cashTrips || 0}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Online Trips</p>
              <p className="mt-2 text-[18px] font-black text-slate-900">{earnings.onlineTrips || 0}</p>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">From DB</p>
          <h2 className="mt-1 text-[20px] font-black text-slate-950">Business details</h2>
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3">
              <MapPin size={18} className="mt-0.5 text-blue-500" />
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Service Location</p>
                <p className="mt-1 text-[14px] font-black text-slate-900">{serviceLocation?.name || '-'}</p>
                <p className="mt-1 text-[12px] font-semibold text-slate-500">{serviceLocation?.address || profile.address || 'Address not updated'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Owner</p>
                <p className="mt-1 text-[14px] font-black text-slate-900">{profile.ownerName || '-'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Transport</p>
                <p className="mt-1 text-[14px] font-black text-slate-900 capitalize">{profile.transportType || '-'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Phone</p>
                <p className="mt-1 text-[14px] font-black text-slate-900">{profile.phone || '-'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Status</p>
                <p className="mt-1 text-[14px] font-black text-slate-900 capitalize">{profile.status || '-'}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Transport Mix</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Bookings by module</h2>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {transportBreakdown.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-[12px] font-bold text-slate-400">
                No booking data yet.
              </div>
            ) : (
              transportBreakdown.map((item) => (
                <div key={item.transportType} className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-black text-slate-900 capitalize">{item.transportType}</p>
                    <p className="text-[12px] font-black text-emerald-600">{money(item.earnings)}</p>
                  </div>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">
                    {item.trips} trips • {item.completedTrips} completed
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Recent Drivers</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Fleet team</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/taxi/owner/manage-drivers')}
              className="text-[11px] font-black text-blue-600"
            >
              View all
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {recentDrivers.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-[12px] font-bold text-slate-400">
                No drivers added yet.
              </div>
            ) : (
              recentDrivers.map((driver) => (
                <div key={driver.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-black text-slate-900 truncate">{driver.name || 'Driver'}</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-500">{driver.phone || '-'} • {driver.city || 'No city'}</p>
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusTone(driver.status)}`}>
                      {driver.status || 'pending'}
                    </span>
                    <p className="mt-1 text-[10px] font-bold text-slate-400">
                      {driver.isOnRide ? 'On trip' : driver.isOnline ? 'Online' : 'Offline'}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Recent Vehicles</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Fleet inventory</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/taxi/owner/vehicle-fleet')}
              className="text-[11px] font-black text-blue-600"
            >
              View all
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {recentVehicles.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-[12px] font-bold text-slate-400">
                No vehicles added yet.
              </div>
            ) : (
              recentVehicles.map((vehicle) => (
                <div key={vehicle.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-black text-slate-900 truncate">
                      {[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || vehicle.vehicleTypeName || 'Vehicle'}
                    </p>
                    <p className="mt-1 text-[11px] font-bold text-slate-500">
                      {vehicle.number || '-'} • {vehicle.color || 'No color'} • {vehicle.transportType || 'taxi'}
                    </p>
                  </div>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusTone(vehicle.status)}`}>
                    {vehicle.status || 'pending'}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-5 rounded-[30px] bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Recent Bookings</p>
              <h2 className="mt-1 text-[20px] font-black text-slate-950">Latest ride activity</h2>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {recentRides.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-[12px] font-bold text-slate-400">
                No bookings found yet.
              </div>
            ) : (
              recentRides.map((ride) => (
                <div key={ride.id} className="rounded-2xl bg-slate-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-black text-slate-900 capitalize">
                        {ride.transportType || 'taxi'} • {ride.driver?.name || 'Driver not assigned'}
                      </p>
                      <p className="mt-1 text-[11px] font-bold text-slate-500 line-clamp-1">Pickup: {ride.pickupAddress || '-'}</p>
                      <p className="mt-1 text-[11px] font-bold text-slate-500 line-clamp-1">Drop: {ride.dropAddress || '-'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusTone(ride.status)}`}>
                        {ride.status || 'pending'}
                      </span>
                      <p className="mt-2 text-[12px] font-black text-emerald-600">{money(ride.earnings || ride.fare)}</p>
                      <p className="mt-1 text-[10px] font-bold text-slate-400">{formatRelativeDate(ride.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setAddDriverModalOpen(true)}
            className="flex items-center justify-between rounded-[26px] bg-white px-4 py-4 shadow-sm"
          >
            <div className="text-left">
              <p className="text-[11px] font-black text-slate-900">+ Add Driver</p>
              <p className="mt-1 text-[10px] font-bold text-slate-400">Invite by phone</p>
            </div>
            <ArrowRight size={16} className="text-slate-300" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/taxi/owner/vehicle-fleet')}
            className="flex items-center justify-between rounded-[26px] bg-white px-4 py-4 shadow-sm"
          >
            <div className="text-left">
              <p className="text-[11px] font-black text-slate-900">Manage Fleet</p>
              <p className="mt-1 text-[10px] font-bold text-slate-400">Update vehicles</p>
            </div>
            <ArrowRight size={16} className="text-slate-300" />
          </button>
        </div>
        </>
        )}
      </div>

      {addDriverModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-[32px] bg-white p-6 shadow-2xl">
            <h3 className="text-[20px] font-black text-slate-900">Invite Hired Driver</h3>
            <p className="mt-1 text-[12px] font-semibold text-slate-500">
              Enter 10-digit mobile number to link an existing driver or send onboarding invite.
            </p>

            <form onSubmit={handleAddHiredDriver} className="mt-4 space-y-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Driver Phone</label>
                <input
                  type="tel"
                  maxLength={10}
                  value={newDriverPhone}
                  onChange={(e) => setNewDriverPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="e.g. 9876543210"
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-[14px] font-bold text-slate-900 outline-none focus:border-slate-900"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Driver Name (Optional)</label>
                <input
                  type="text"
                  value={newDriverName}
                  onChange={(e) => setNewDriverName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-3 text-[14px] font-bold text-slate-900 outline-none focus:border-slate-900"
                />
              </div>

              {addDriverMessage ? (
                <p className="text-[12px] font-bold text-blue-600">{addDriverMessage}</p>
              ) : null}

              <div className="mt-6 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setAddDriverModalOpen(false); setAddDriverMessage(''); }}
                  className="rounded-2xl bg-slate-100 px-4 py-2.5 text-[12px] font-black text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addDriverLoading}
                  className="rounded-2xl bg-slate-900 px-5 py-2.5 text-[12px] font-black text-white disabled:opacity-50"
                >
                  {addDriverLoading ? 'Linking...' : 'Link Driver'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <DriverBottomNav />
    </div>
  );
};

export default OwnerDashboard;
