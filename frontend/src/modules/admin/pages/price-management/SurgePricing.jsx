import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  ChevronRight, 
  Loader2,
  FilePlus,
  ArrowLeft,
  Settings
} from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';

const inputClass = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";

const SurgePricing = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Sunday');
  const [surges, setSurges] = useState([]);
  const [details, setDetails] = useState({ zone_name: '', vehicle_type: '' });

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  useEffect(() => {
    const fetchPriceDetails = async () => {
      try {
        setLoading(true);
        // axiosInstance interceptor already returns response.data
        const res = await api.get('/admin/types/set-prices');
        const items = res.results || res.data?.results || res.data || [];
        
        const target = items.find(i => String(i.id || i._id) === String(id));
        
        if (target) {
          setDetails({
            zone_name: target.zone_id?.name || target.zone_name || 'Global',
            vehicle_type: target.vehicle_type?.name || target.vehicle_type_name || 'Vehicle'
          });
        }
      } catch (err) {
        console.error('Fetch surge details failed:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPriceDetails();
  }, [id]);

  const addSurge = () => {
    const currentTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    setSurges([...surges, { start_time: currentTime, end_time: currentTime, surge_price: '' }]);
  };

  const removeSurge = (index) => {
    setSurges(surges.filter((_, i) => i !== index));
  };

  const updateSurge = (index, field, value) => {
    const newSurges = [...surges];
    newSurges[index][field] = value;
    setSurges(newSurges);
  };

  const handleUpdate = async () => {
    toast.success(`${activeTab} surge prices updated!`);
    navigate(-1);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
         <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8 font-sans">
      
      {/* Header Block from Design System */}
      <div className="mb-8">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
           <span className="cursor-pointer hover:text-indigo-600 transition-colors" onClick={() => navigate('/admin/pricing/set-price')}>Surge</span>
           <ChevronRight size={12} />
           <span className="text-gray-700 font-semibold tracking-tight uppercase">Surge Control</span>
        </div>
        <div className="flex items-center justify-between">
           <h1 className="text-xl font-bold text-gray-900 tracking-tight">SURGE PRICING</h1>
           <button 
             onClick={() => navigate(-1)}
             className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all font-semibold shadow-sm"
           >
             <ArrowLeft size={16} /> Back
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-6">
        
        {/* Summary Info (Left Sidebar style) */}
        <div className="lg:col-span-1 space-y-4">
           <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-50">
                 <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <Settings size={18} />
                 </div>
                 <div>
                    <h3 className="text-sm font-bold text-gray-900 leading-tight">Price Details</h3>
                    <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest mt-0.5">Reference Data</p>
                 </div>
              </div>
              <div className="space-y-4">
                 <div>
                    <label className={labelClass}>Active Zone</label>
                    <div className="p-3 bg-gray-50 rounded-lg text-sm font-bold text-gray-700 border border-gray-100">{details.zone_name}</div>
                 </div>
                 <div>
                    <label className={labelClass}>Vehicle Type</label>
                    <div className="p-3 bg-gray-50 rounded-lg text-sm font-bold text-gray-700 border border-gray-100">{details.vehicle_type}</div>
                 </div>
              </div>
           </div>
        </div>

        {/* Main Configuration Area */}
        <div className="lg:col-span-3">
           <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
              <div className="flex border-b border-gray-100 overflow-x-auto no-scrollbar scroll-smooth bg-gray-50/30">
                 {days.map(day => (
                   <button 
                     key={day}
                     onClick={() => setActiveTab(day)}
                     className={`flex-1 min-w-[120px] h-14 flex items-center justify-center text-[11px] font-black uppercase tracking-widest transition-all relative ${activeTab === day ? 'text-indigo-600 bg-white' : 'text-gray-400 hover:text-gray-600'}`}
                   >
                      {day}
                      {activeTab === day && <div className="absolute top-0 left-0 right-0 h-[3px] bg-indigo-600" />}
                   </button>
                 ))}
              </div>

              <div className="p-4 md:p-8 flex-grow">
                 <div className="flex justify-between items-center mb-8">
                    <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest flex items-center gap-2">
                       <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                       {activeTab} Slots
                    </h2>
                    <button onClick={addSurge} className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-md hover:bg-indigo-700 transition-all flex items-center gap-2 active:scale-95">
                       <Plus size={16} /> Add New Surge
                    </button>
                 </div>

                 {surges.length === 0 ? (
                    <div className="py-24 flex flex-col items-center justify-center gap-4 text-slate-300">
                       <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center border-2 border-dashed border-gray-200">
                          <FilePlus size={32} />
                       </div>
                       <p className="text-[13px] font-bold text-slate-400 uppercase tracking-widest">No Surge Slots defined</p>
                    </div>
                 ) : (
                    <div className="space-y-6">
                       {surges.map((row, idx) => (
                          <div key={idx} className="bg-gray-50/50 p-4 md:p-6 rounded-xl border border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6 items-end relative overflow-hidden group">
                             <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-200 group-hover:bg-indigo-500 transition-colors"></div>
                             
                             <div>
                                <label className={labelClass}>Start Time</label>
                                <input 
                                  type="time"
                                  value={row.start_time}
                                  onChange={(e) => updateSurge(idx, 'start_time', e.target.value)}
                                  className={inputClass}
                                />
                             </div>
                             <div>
                                <label className={labelClass}>End Time</label>
                                <input 
                                  type="time"
                                  value={row.end_time}
                                  onChange={(e) => updateSurge(idx, 'end_time', e.target.value)}
                                  className={inputClass}
                                />
                             </div>
                             <div>
                                <label className={labelClass}>Surge Price (in %)</label>
                                <div className="relative">
                                  <input 
                                    type="number"
                                    placeholder="0"
                                    value={row.surge_price}
                                    onChange={(e) => updateSurge(idx, 'surge_price', e.target.value)}
                                    className={inputClass + " pr-8"}
                                  />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs">%</span>
                                </div>
                             </div>
                             <div className="flex justify-end pr-2">
                                <button 
                                  onClick={() => removeSurge(idx)}
                                  className="w-10 h-10 flex items-center justify-center text-rose-400 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-100"
                                >
                                   <Trash2 size={18} />
                                </button>
                             </div>
                          </div>
                       ))}
                    </div>
                 )}
              </div>

              <div className="p-4 md:p-8 border-t border-gray-100 flex justify-end bg-gray-50/20">
                 <button onClick={handleUpdate} className="bg-indigo-600 text-white px-12 py-3 rounded-xl text-sm font-black uppercase tracking-widest shadow-xl hover:bg-indigo-700 transition-all hover:translate-y-[-2px] active:translate-y-[0px] shadow-indigo-200">
                    Update Surge
                 </button>
              </div>
           </div>
        </div>

      </div>

    </div>
  );
};

export default SurgePricing;

