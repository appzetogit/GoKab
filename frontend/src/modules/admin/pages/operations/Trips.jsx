import React, { useState, useEffect, useCallback } from 'react';
import { Filter, MoreVertical, Search, Loader2, ChevronRight, X, MapPin, Calendar, Clock, Car, CreditCard, Users, ChevronLeft, RefreshCw, User, Phone, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminService } from '../../services/adminService';

const STATUS_STYLES = {
  CANCELLED: 'bg-orange-500 text-white',
  COMPLETED: 'bg-teal-500 text-white',
  UPCOMING: 'bg-amber-400 text-white',
  ONGOING: 'bg-blue-500 text-white',
  ACCEPTED: 'bg-emerald-500 text-white',
};

const PAYMENT_STYLES = {
  CASH: 'bg-orange-500 text-white',
  CARD: 'bg-red-500 text-white',
  WALLET: 'bg-teal-500 text-white',
};

const TAB_SET = ['All', 'Completed', 'Cancelled', 'Upcoming', 'On Trip'];

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const normalizeTab = (tab) => {
  if (tab === 'On Trip') return 'ongoing';
  return tab.toLowerCase();
};

const normalizeRow = (row = {}) => ({
  id: String(row._id || row.id || row.requestId || Math.random()),
  requestId: row.requestId || row.request_id || row.ride_request_id || '--',
  date: row.date || row.createdAt || row.created_at || row.trip_date || row.updatedAt,
  userName: row.userName || row.user_name || row.customer_name || row.user?.name || '--',
  driverName: row.driverName || row.driver_name || row.driver?.name || '--',
  transportType: row.transportType || row.transport_type || row.service_type || row.module || '--',
  tripStatus: String(row.tripStatus || row.trip_status || row.status || '').toUpperCase(),
  paymentOption: String(row.paymentOption || row.payment_option || row.payment_method || 'CASH').toUpperCase(),
  bookingPreferences: row.bookingPreferences || null,
  pickupLabel: row.pickupLabel || '--',
  dropLabel: row.dropLabel || '--',
  userPhone: row.user?.phone || row.userPhone || '--',
  driverPhone: row.driver?.phone || row.driverPhone || '--',
});

const Trips = () => {
  const [activeTab, setActiveTab] = useState('All');
  const [selectedRow, setSelectedRow] = useState(null);
  const [search, setSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  
  // PAGINATION STATES
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await adminService.getRideRequests({
        page,
        limit,
        tab: normalizeTab(activeTab),
        search,
        user_search: userSearch,
        driver_search: driverSearch,
      });

      const payload = response?.data?.data || response?.data || response || {};
      const results = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.docs) ? payload.docs : [];
      
      setRows(results.map(normalizeRow));
      setTotalRecords(payload?.total || payload?.totalDocs || results.length);
      setTotalPages(payload?.totalPages || Math.ceil((payload?.total || results.length) / limit) || 1);
    } catch (err) {
      setRows([]);
      setError(err?.message || 'Failed to load trip requests');
    } finally {
      setLoading(false);
    }
  }, [activeTab, limit, page, search, userSearch, driverSearch]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleLimitChange = (newLimit) => {
    setLimit(Number(newLimit));
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearch('');
    setUserSearch('');
    setDriverSearch('');
    setActiveTab('All');
    setPage(1);
    setShowFilterModal(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto w-full">
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-3xl shadow-xl border border-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-xs font-black uppercase tracking-wider mb-2">
              <Car size={14} /> Operations Control
            </div>
            <h1 className="text-2xl font-black">All Ride Requests & Trips History</h1>
            <p className="text-xs text-slate-300 mt-1 max-w-xl font-medium">
              Search and filter trip requests by passenger, driver, status, or date across the entire platform.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadRows}
              className="p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-2xl transition border border-slate-700/60"
              title="Refresh Trips List"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* CONTROLS CARD */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-6">
          {/* TOP CONTROLS & TABS */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            {/* PAGE LIMIT SELECTOR */}
            <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <span>Show</span>
              <select
                value={limit}
                onChange={(e) => handleLimitChange(e.target.value)}
                className="h-10 border border-slate-200 rounded-xl bg-gray-50 px-3 text-xs font-black text-slate-800 outline-none focus:border-indigo-600 transition"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
                <option value={500}>500</option>
                <option value={1000}>All (1000)</option>
              </select>
              <span>entries per page</span>
            </div>

            {/* TAB BUTTONS */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0">
              {TAB_SET.map((tab) => (
                <button
                  key={tab}
                  onClick={() => handleTabChange(tab)}
                  className={`px-4 py-2 text-xs font-black rounded-xl transition ${
                    activeTab === tab
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-gray-100 text-slate-600 hover:bg-gray-200'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* SEARCH & ADVANCED FILTER TOGGLE */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:w-64">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search ID, Name, Phone..."
                  className="w-full h-10 rounded-2xl border border-slate-200 bg-gray-50 pl-9 pr-4 text-xs font-bold outline-none focus:bg-white focus:border-indigo-600 transition"
                />
              </div>

              <button
                onClick={() => setShowFilterModal(true)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-black shadow-sm transition ${
                  userSearch || driverSearch ? 'bg-amber-500 text-white' : 'bg-slate-900 text-white hover:bg-black'
                }`}
              >
                <Filter size={16} /> Filters {(userSearch || driverSearch) && '• Active'}
              </button>
            </div>
          </div>

          {/* ACTIVE FILTER BADGES */}
          {(userSearch || driverSearch || search) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Filtered By:</span>
              {search && (
                <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-black rounded-xl border border-indigo-100 flex items-center gap-1">
                  Search: "{search}" <X size={12} className="cursor-pointer" onClick={() => setSearch('')} />
                </span>
              )}
              {userSearch && (
                <span className="px-3 py-1 bg-emerald-50 text-emerald-800 text-xs font-black rounded-xl border border-emerald-100 flex items-center gap-1">
                  Passenger: "{userSearch}" <X size={12} className="cursor-pointer" onClick={() => setUserSearch('')} />
                </span>
              )}
              {driverSearch && (
                <span className="px-3 py-1 bg-teal-50 text-teal-800 text-xs font-black rounded-xl border border-teal-100 flex items-center gap-1">
                  Driver: "{driverSearch}" <X size={12} className="cursor-pointer" onClick={() => setDriverSearch('')} />
                </span>
              )}
              <button onClick={handleResetFilters} className="text-xs font-bold text-rose-600 hover:underline">
                Reset All
              </button>
            </div>
          )}

          {/* TRIPS DATA TABLE */}
          <div className="overflow-x-auto border border-slate-100 rounded-2xl">
            {loading ? (
              <div className="p-16 text-center space-y-3">
                <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mx-auto" />
                <p className="text-xs font-bold text-slate-500">Loading Trip History...</p>
              </div>
            ) : rows.length === 0 ? (
              <div className="p-16 text-center space-y-3">
                <p className="text-base font-bold text-slate-700">No Trips Found</p>
                <p className="text-xs text-slate-400">Try adjusting your search query, page limit, or filters.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-black uppercase tracking-wider">
                    <th className="py-4 px-4">Request ID</th>
                    <th className="py-4 px-4">Date & Time</th>
                    <th className="py-4 px-4">Passenger / Customer</th>
                    <th className="py-4 px-4">Driver</th>
                    <th className="py-4 px-4">Service</th>
                    <th className="py-4 px-4">Status</th>
                    <th className="py-4 px-4">Payment</th>
                    <th className="py-4 px-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-4 px-4 font-mono font-black text-indigo-700">#{row.requestId}</td>
                      <td className="py-4 px-4 font-medium text-slate-600">{formatDate(row.date)}</td>
                      <td className="py-4 px-4 font-bold text-slate-900">
                        {row.userName}
                        <span className="block text-[11px] text-slate-400 font-normal">{row.userPhone}</span>
                      </td>
                      <td className="py-4 px-4 font-bold text-slate-900">
                        {row.driverName}
                        <span className="block text-[11px] text-slate-400 font-normal">{row.driverPhone}</span>
                      </td>
                      <td className="py-4 px-4 font-bold text-slate-700">{row.transportType}</td>
                      <td className="py-4 px-4">
                        <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider ${STATUS_STYLES[row.tripStatus] || 'bg-slate-200 text-slate-800'}`}>
                          {row.tripStatus}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider ${PAYMENT_STYLES[row.paymentOption] || 'bg-slate-200 text-slate-800'}`}>
                          {row.paymentOption}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <button
                          onClick={() => setSelectedRow(row)}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition"
                        >
                          <MoreVertical size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* MULTI-PAGE PAGINATION CONTROLS BAR */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-100">
            <div className="text-xs font-bold text-slate-500">
              Showing <span className="font-black text-slate-900">{rows.length > 0 ? (page - 1) * limit + 1 : 0}</span> to{' '}
              <span className="font-black text-slate-900">{Math.min(page * limit, totalRecords)}</span> of{' '}
              <span className="font-black text-indigo-700">{totalRecords}</span> total trip records
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-xs font-bold text-slate-700 flex items-center gap-1 transition"
              >
                <ChevronLeft size={16} /> Previous
              </button>

              <span className="text-xs font-black text-slate-700 px-3">
                Page {page} of {totalPages}
              </span>

              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-xs font-bold flex items-center gap-1 transition shadow-sm"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* FILTER MODAL */}
      {showFilterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
                <Filter size={16} className="text-indigo-600" /> Filter Specific Passenger or Driver
              </h3>
              <button onClick={() => setShowFilterModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <User size={13} className="text-indigo-600" /> Filter by Passenger / User Name or Phone
                </label>
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="e.g. John Doe or 9876543210"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-bold outline-none focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <Phone size={13} className="text-emerald-600" /> Filter by Driver Name or Phone
                </label>
                <input
                  type="text"
                  value={driverSearch}
                  onChange={(e) => setDriverSearch(e.target.value)}
                  placeholder="e.g. Driver Name or 9999988888"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-bold outline-none focus:border-indigo-600"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button
                onClick={handleResetFilters}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:bg-gray-100 rounded-xl"
              >
                Reset
              </button>
              <button
                onClick={() => { setPage(1); setShowFilterModal(false); loadRows(); }}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-md"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TRIP DETAIL DRAWER / MODAL */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wider block">Trip Details</span>
                <h3 className="text-lg font-black text-slate-900">Request #{selectedRow.requestId}</h3>
              </div>
              <button onClick={() => setSelectedRow(null)} className="p-2 text-slate-400 hover:text-slate-700 rounded-xl">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-gray-50 rounded-2xl flex items-center justify-between font-bold">
                <span className="text-slate-500">Trip Status</span>
                <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase ${STATUS_STYLES[selectedRow.tripStatus] || 'bg-slate-200'}`}>
                  {selectedRow.tripStatus}
                </span>
              </div>

              <div className="p-4 bg-gray-50 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <User size={14} className="text-indigo-600" /> Passenger: {selectedRow.userName} ({selectedRow.userPhone})
                </div>
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Car size={14} className="text-emerald-600" /> Driver: {selectedRow.driverName} ({selectedRow.driverPhone})
                </div>
              </div>

              <div className="p-4 bg-slate-900 text-white rounded-2xl space-y-2">
                <div className="flex items-start gap-2">
                  <MapPin size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Pickup Location</span>
                    <span className="font-bold">{selectedRow.pickupLabel}</span>
                  </div>
                </div>
                <div className="flex items-start gap-2 pt-2 border-t border-slate-800">
                  <MapPin size={14} className="text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Drop Location</span>
                    <span className="font-bold">{selectedRow.dropLabel}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedRow(null)}
                className="px-6 py-2.5 bg-slate-900 text-white text-xs font-black rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Trips;
