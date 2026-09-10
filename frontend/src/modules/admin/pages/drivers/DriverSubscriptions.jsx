import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  Search, 
  ChevronRight, 
  Plus, 
  Filter, 
  Download, 
  Car,
  MoreVertical,
  List,
  LayoutGrid
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';

const ToggleSwitch = ({ label, enabled, onToggle }) => (
  <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl shadow-sm flex-1 min-w-[280px]">
    <span className="text-sm font-semibold text-gray-700">{label}</span>
    <button 
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${enabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  </div>
);

const DriverSubscriptions = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [config, setConfig] = useState({
    mode: 'commissionOnly' // commissionOnly, subscriptionOnly, both
  });
  const [isLoading, setIsLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const handleToggle = async (mode) => {
    try {
      const res = await adminService.updateSubscriptionSettings({ mode });
      if (res.success) {
        setConfig({ mode });
        toast.success(`Mode changed to ${mode.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
      } else {
        toast.error(res.message || "Failed to update settings");
      }
    } catch (err) {
      console.error('Update settings error:', err);
      toast.error(err.message || "Failed to update settings");
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        
        const [plansRes, settingsRes] = await Promise.all([
          adminService.getSubscriptionPlans(),
          adminService.getSubscriptionSettings()
        ]);

        const plansData = plansRes?.data || plansRes || {};
        const plansList = Array.isArray(plansData)
          ? plansData
          : Array.isArray(plansData.results)
          ? plansData.results
          : Array.isArray(plansData.data?.results)
          ? plansData.data.results
          : [];
        setPlans(plansList);

        const settingsData = settingsRes?.data || settingsRes || {};
        const mode = settingsData.mode || settingsData.data?.mode || 'both';
        setConfig({ mode });
      } catch (err) {
        console.error('Fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const filteredPlans = plans.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8">
      {/* HEADER */}
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Drivers</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Subscription</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-gray-900">Subscription</h1>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
              <Download size={15} /> Export List
            </button>
          </div>
        </div>
      </div>

      {/* TOP CONFIG TOGGLES */}
      <div className="flex flex-wrap gap-4 mb-8">
        <ToggleSwitch 
          label="Enable Commission Only" 
          enabled={config.mode === 'commissionOnly'} 
          onToggle={() => handleToggle('commissionOnly')} 
        />
        <ToggleSwitch 
          label="Enable Subscription Only" 
          enabled={config.mode === 'subscriptionOnly'} 
          onToggle={() => handleToggle('subscriptionOnly')} 
        />
        <ToggleSwitch 
          label="Enable Subscription and Commission" 
          enabled={config.mode === 'both'} 
          onToggle={() => handleToggle('both')} 
        />
      </div>

      {/* LIST SECTION */}
      {config.mode !== 'commissionOnly' && (
      <div className="bg-white rounded-xl border border-gray-200 overflow-visible shadow-sm">
        {/* TOOLBAR */}
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button className="w-10 h-10 bg-teal-500 text-white rounded-lg flex items-center justify-center shadow-sm">
              <List size={18} />
            </button>
            <button className="w-10 h-10 bg-gray-100 text-gray-400 rounded-lg flex items-center justify-center hover:bg-indigo-50 transition-all">
              <LayoutGrid size={18} />
            </button>
            <div className="flex items-center gap-2 text-xs text-gray-500 ml-4 font-medium">
              <span>Show</span>
              <select
                value={itemsPerPage}
                onChange={(e) => setItemsPerPage(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs bg-white outline-none"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>entries</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button className="bg-orange-500 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-sm uppercase tracking-wide">
              <Filter size={14} /> Filters
            </button>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search plans..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg w-56 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
            <button 
              onClick={() => navigate('/admin/drivers/subscription/create')}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
            >
               <Plus size={15} /> Add Subscription
            </button>
          </div>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price / Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transport Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr>
                  <td colSpan="5" className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-7 h-7 text-indigo-600 animate-spin" />
                      <p className="text-sm text-gray-400">Loading plans...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredPlans.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-16 text-center text-sm text-gray-400">
                    No plans found.
                  </td>
                </tr>
              ) : (
                filteredPlans.map((item) => (
                  <tr key={item._id || item.id || item.name} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-gray-900">{item.name}</p>
                      {item.description && <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>}
                    </td>
                    <td className="px-4 py-4 text-sm font-black text-emerald-600">
                      ₹{item.amount}
                    </td>
                    <td className="px-4 py-4 text-sm font-medium text-gray-600">
                      {item.duration} {item.duration === 1 ? 'day' : 'days'} {item.duration === 365 ? '(1 Year)' : item.duration === 30 ? '(1 Month)' : ''}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                       <div className="flex items-center gap-2 capitalize font-medium">
                          <Car size={14} className="text-indigo-500" /> {item.transport_type || 'all'}
                       </div>
                    </td>
                    <td className="px-4 py-4">
                       <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${item.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-50 text-gray-500 border border-gray-200'}`}>
                          {item.active ? 'Active' : 'Inactive'}
                       </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* FOOTER */}
        {!isLoading && filteredPlans.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
             <span>Showing 1 to {filteredPlans.length} of {filteredPlans.length} entries</span>
             <div className="flex items-center gap-1">
                <button className="px-3 py-1.5 border border-gray-200 rounded text-xs text-gray-400" disabled>Prev</button>
                <button className="w-7 h-7 rounded bg-indigo-600 text-white text-xs font-medium flex items-center justify-center">1</button>
                <button className="px-3 py-1.5 border border-gray-200 rounded text-xs text-gray-400" disabled>Next</button>
             </div>
          </div>
        )}
      </div>
      )}

    </div>
  );
};

export default DriverSubscriptions;
