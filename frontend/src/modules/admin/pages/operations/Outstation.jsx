import React, { useState, useEffect, useCallback } from 'react';
import { Filter, MoreVertical, Search, Loader2, ChevronRight, Menu, MapPin, Calendar, Clock, CreditCard, User, Car, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { adminService } from '../../services/adminService';

const STATUS_STYLES = {
  CANCELLED: 'bg-orange-500 text-white',
  COMPLETED: 'bg-teal-500 text-white',
  UPCOMING: 'bg-amber-400 text-white',
  ON_TRIP: 'bg-blue-500 text-white',
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

const Outstation = () => {
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(10);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await adminService.getTrips({
        limit,
        tab: normalizeTab(activeTab),
        search,
      });
      const payload = response?.data?.data || response?.data || response || {};
      const results = Array.isArray(payload?.results) ? payload.results : [];
      setRows(results);
    } catch (err) {
      setRows([]);
      setError(err?.message || 'Failed to load outstation requests');
    } finally {
      setLoading(false);
    }
  }, [activeTab, limit, search]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <div className="p-4 space-y-4">
        {/* Header Section */}
        <div className="flex items-center justify-between px-4 py-2 bg-white rounded-t-xl">
          <h1 className="text-[20px] font-black tracking-tight text-slate-800 uppercase">OUTSTATION REQUESTS</h1>
          <div className="flex items-center gap-2 text-[12px] font-medium text-slate-400">
            <span>Operations</span>
            <ChevronRight size={14} className="text-slate-300" />
            <span className="text-slate-500">Outstation Requests</span>
          </div>
        </div>

        {/* Filters and Search controls */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm relative">
          <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-6 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2 text-[14px] font-medium text-slate-500">
              <span>show</span>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="h-9 w-16 border border-slate-200 rounded-md bg-white px-2 text-[13px] outline-none"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>entries</span>
            </div>

            <div className="flex flex-1 justify-center items-center gap-4 md:gap-8 flex-wrap">
              {TAB_SET.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative py-1 text-[15px] font-bold transition-all ${
                    activeTab === tab ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {tab}
                  {activeTab === tab && (
                    <motion.div layoutId="outstation-tab" className="absolute -bottom-3 left-0 right-0 h-0.5 bg-[#20A354]" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search requests"
                  className="h-10 w-52 rounded-full border border-slate-200 bg-white pl-9 pr-4 text-[13px] outline-none focus:border-slate-300"
                />
              </div>
              <button className="flex items-center gap-2 px-5 py-2.5 bg-[#f46b45] text-white rounded-lg text-[13px] font-bold shadow-sm">
                <Filter size={16} /> Filters
              </button>
            </div>
          </div>

          {/* Requests Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-50">
                  {['Request Id', 'Date', 'Route', 'Trip Type', 'Travel Date', 'User Name', 'Driver Name', 'Fare', 'Status', 'Action'].map((heading) => (
                    <th key={heading} className="px-6 py-4 text-[13px] font-bold text-slate-900 border-b border-slate-100">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-20 text-center">
                      <Loader2 className="animate-spin text-[#20A354] mx-auto" size={32} />
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={10} className="py-20 text-center text-[14px] font-medium text-red-500">
                      {error}
                    </td>
                  </tr>
                ) : rows.length > 0 ? (
                  rows.map((row) => (
                    <tr 
                      key={row.id} 
                      className="hover:bg-slate-50/50 cursor-pointer transition-colors"
                      onClick={() => setSelectedRow(row)}
                    >
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.requestId}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{formatDate(row.date)}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-900 font-bold max-w-[200px] truncate">{row.routeLabel || '--'}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-semibold">{row.tripType || '--'}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium truncate max-w-[150px]">{row.travelDate || '--'}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.userName}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.driverName}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-800 font-bold">Rs {Number(row.fare || 0).toLocaleString()}</td>
                      <td className="px-6 py-5">
                        <span className={`inline-block px-3 py-1 text-[10px] font-bold rounded uppercase ${STATUS_STYLES[row.tripStatus] || 'bg-slate-200 text-slate-700'}`}>
                          {row.tripStatus || 'UNKNOWN'}
                        </span>
                      </td>
                      <td className="px-6 py-5" onClick={(e) => e.stopPropagation()}>
                        <button 
                          onClick={() => setSelectedRow(row)}
                          className="text-slate-400 hover:text-slate-800 p-1 rounded-full hover:bg-slate-100 transition-colors"
                        >
                          <MoreVertical size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} className="py-20 text-center text-[14px] font-medium text-slate-400">
                      No outstation requests found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <button className="fixed bottom-10 right-10 w-14 h-14 bg-[#00BFA5] text-white rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-transform z-50">
            <Menu size={24} />
          </button>
        </div>
      </div>

      {/* Details Drawer / Modal */}
      <AnimatePresence>
        {selectedRow && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRow(null)}
              className="fixed inset-0 bg-black z-[100]"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-2xl z-[101] flex flex-col overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-[#20A354]/5">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#20A354]">Outstation Ride Request</span>
                  <h2 className="text-[20px] font-black text-slate-800 mt-1">{selectedRow.requestId}</h2>
                </div>
                <button
                  onClick={() => setSelectedRow(null)}
                  className="w-10 h-10 rounded-full hover:bg-slate-200/50 flex items-center justify-center text-slate-400 hover:text-slate-800 transition-colors"
                >
                  <X size={20} strokeWidth={2.5} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 p-4 md:p-6 space-y-8">
                {/* Routing & Locations */}
                <div className="space-y-4">
                  <h3 className="text-[12px] font-black uppercase tracking-[0.15em] text-slate-400">Route & Locations</h3>
                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 relative overflow-hidden">
                    <div className="absolute left-[31px] top-[40px] bottom-[40px] w-[1.5px] border-l border-dashed border-slate-200" />
                    
                    <div className="flex gap-4 relative">
                      <div className="w-6 h-6 rounded-full bg-[#20A354]/10 border border-[#20A354]/30 flex items-center justify-center shrink-0 mt-1">
                        <div className="w-2 h-2 bg-[#20A354] rounded-full" />
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Pickup</p>
                        <p className="text-[14px] font-bold text-slate-800 mt-0.5">{selectedRow.pickupLabel}</p>
                      </div>
                    </div>

                    <div className="h-6" />

                    <div className="flex gap-4 relative">
                      <div className="w-6 h-6 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center shrink-0 mt-1">
                        <MapPin size={12} className="text-orange-500" strokeWidth={2.5} />
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Drop</p>
                        <p className="text-[14px] font-bold text-slate-800 mt-0.5">{selectedRow.dropLabel}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Ride Info Grid */}
                <div className="space-y-4">
                  <h3 className="text-[12px] font-black uppercase tracking-[0.15em] text-slate-400">Ride Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-start gap-3">
                      <Calendar size={18} className="text-[#20A354] mt-0.5" />
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Travel Date</p>
                        <p className="text-[14px] font-black text-slate-800 mt-1">{selectedRow.travelDate || 'Now'}</p>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-start gap-3">
                      <Clock size={18} className="text-[#20A354] mt-0.5" />
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Trip Type</p>
                        <p className="text-[14px] font-black text-slate-800 mt-1">{selectedRow.tripType || '--'}</p>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-start gap-3">
                      <Car size={18} className="text-[#20A354] mt-0.5" />
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Vehicle Selected</p>
                        <p className="text-[14px] font-black text-slate-800 mt-1">{selectedRow.transportType || '--'}</p>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex items-start gap-3">
                      <CreditCard size={18} className="text-[#20A354] mt-0.5" />
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Fare & Payment</p>
                        <p className="text-[14px] font-black text-slate-800 mt-1">Rs {selectedRow.fare?.toLocaleString()} ({selectedRow.paymentOption})</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Parties Details */}
                <div className="space-y-4">
                  <h3 className="text-[12px] font-black uppercase tracking-[0.15em] text-slate-400">Users Involved</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                      <div className="w-10 h-10 rounded-full bg-[#20A354]/10 flex items-center justify-center text-[#20A354] shrink-0 font-bold text-sm">
                        <User size={18} />
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Rider</p>
                        <p className="text-[14px] font-bold text-slate-800">{selectedRow.userName}</p>
                        {selectedRow.user?.phone && <p className="text-[12px] font-medium text-slate-400 mt-0.5">{selectedRow.user.phone}</p>}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                      <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center text-orange-500 shrink-0 font-bold text-sm border border-orange-100">
                        <Car size={18} />
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Driver Assigned</p>
                        <p className="text-[14px] font-bold text-slate-800">{selectedRow.driverName}</p>
                        {selectedRow.driver?.phone && (
                          <p className="text-[12px] font-medium text-slate-400 mt-0.5">
                            {selectedRow.driver.phone} • {selectedRow.driver.vehicleNumber || 'No plate'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Outstation;
