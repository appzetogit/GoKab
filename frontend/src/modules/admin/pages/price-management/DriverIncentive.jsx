import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  ChevronRight, 
  Loader2,
  Settings,
  ArrowLeft
} from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';

const DriverIncentive = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('daily');
  const [incentives, setIncentives] = useState([{ min_rides: '0', amount: '0' }]);
  const [details, setDetails] = useState({ zone_name: '', vehicle_type: '' });

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
        console.error('Fetch incentive details failed:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPriceDetails();
  }, [id]);

  const addRow = () => {
    setIncentives([...incentives, { min_rides: '0', amount: '0' }]);
  };

  const removeRow = (index) => {
    setIncentives(incentives.filter((_, i) => i !== index));
  };

  const updateRow = (index, field, value) => {
    const newInc = [...incentives];
    newInc[index][field] = value;
    setIncentives(newInc);
  };

  const handleSubmit = async () => {
    toast.success('Incentives updated successfully!');
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
    <div className="min-h-screen bg-[#F8F9FD] p-4 md:p-6 lg:p-10 font-sans">
      
      {/* Header Block */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-10">
        <h1 className="text-[13px] font-black text-gray-800 uppercase tracking-widest">INCENTIVE</h1>
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
           <span>Incentive</span>
           <ChevronRight size={12} strokeWidth={3} />
           <span className="text-gray-600">Incentive</span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-10">
         <div className="bg-white border-2 border-dashed border-indigo-100 rounded-xl p-4 md:p-6 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] font-black text-indigo-100 bg-indigo-50/50 px-3 py-1 rounded-full uppercase mb-2">Zone</span>
            <span className="text-sm font-bold text-gray-700">{details.zone_name}</span>
         </div>
         <div className="bg-white border-2 border-dashed border-indigo-100 rounded-xl p-4 md:p-6 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] font-black text-indigo-100 bg-indigo-50/50 px-3 py-1 rounded-full uppercase mb-2">Vehicle Type</span>
            <span className="text-sm font-bold text-gray-700">{details.vehicle_type}</span>
         </div>
      </div>

      {/* Tabs & Content */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden min-h-[400px] flex flex-col">
         <div className="flex border-b border-gray-100 h-16">
            <button 
              onClick={() => setActiveTab('daily')}
              className={`flex-1 flex items-center justify-center text-[12px] font-black uppercase tracking-widest transition-all relative ${activeTab === 'daily' ? 'text-[#00BFA5]' : 'text-gray-400 hover:text-gray-600'}`}
            >
               Daily
               {activeTab === 'daily' && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#00BFA5]" />}
            </button>
            <button 
              onClick={() => setActiveTab('weekly')}
              className={`flex-1 flex items-center justify-center text-[12px] font-black uppercase tracking-widest transition-all relative ${activeTab === 'weekly' ? 'text-[#00BFA5]' : 'text-gray-400 hover:text-gray-600'}`}
            >
               Weekly
               {activeTab === 'weekly' && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#00BFA5]" />}
            </button>
         </div>

         <div className="p-4 md:p-8 space-y-8 flex-grow">
            <div className="flex justify-end">
               <button onClick={addRow} className="bg-[#405189] text-white px-4 py-2 rounded-lg text-xs font-bold shadow-md hover:bg-[#344475] transition-all flex items-center gap-2">
                  <Plus size={14} /> Add
               </button>
            </div>

            <div className="space-y-6">
               {incentives.map((row, idx) => (
                  <div key={idx} className="flex flex-col md:flex-row items-end gap-4 md:gap-6 animate-in slide-in-from-left-4 duration-300">
                     <div className="flex-1 space-y-2 w-full">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">Minimum Ride Should Complete</label>
                        <input 
                          type="number"
                          value={row.min_rides}
                          onChange={(e) => updateRow(idx, 'min_rides', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm font-bold text-gray-700 focus:border-indigo-500 outline-none"
                        />
                     </div>
                     <div className="flex-1 space-y-2 w-full">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">Incentive Amount</label>
                        <input 
                          type="number"
                          value={row.amount}
                          onChange={(e) => updateRow(idx, 'amount', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm font-bold text-gray-700 focus:border-indigo-500 outline-none"
                        />
                     </div>
                     <button 
                       onClick={() => removeRow(idx)}
                       className="p-2.5 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors mb-0.5"
                     >
                        <Trash2 size={18} />
                     </button>
                  </div>
               ))}
            </div>
         </div>

         <div className="p-4 md:p-8 border-t border-gray-50 flex justify-end">
            <button onClick={handleSubmit} className="bg-[#405189] text-white px-10 py-2.5 rounded-lg text-sm font-bold shadow-xl hover:bg-[#344475] transition-all active:scale-95">
               Submit
            </button>
         </div>
      </div>

      {/* Floating Design element */}
      <div className="fixed bottom-10 right-10">
         <button className="w-14 h-14 bg-[#00BFA5] text-white rounded-full flex items-center justify-center shadow-2xl hover:rotate-[360deg] transition-all duration-700">
            <div className="flex flex-col gap-1 items-center">
               <div className="w-6 h-[2.5px] bg-white rounded-full"></div>
               <div className="w-6 h-[2px] bg-white/70 rounded-full"></div>
               <div className="w-6 h-[1.5px] bg-white/40 rounded-full"></div>
            </div>
         </button>
      </div>

    </div>
  );
};

export default DriverIncentive;
