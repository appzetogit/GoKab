import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { Autocomplete, GoogleMap, MarkerF } from '@react-google-maps/api';
import {
  ArrowLeft,
  ChevronRight,
  Edit2,
  FileSearch,
  Filter,
  Info,
  Loader2,
  MapPin,
  Plus,
  Save,
  Search,
  Tag,
  Train,
  Trash2,
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { DELHI_CENTER, useAppGoogleMapsLoader } from '../../utils/googleMaps';

const inputClass = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors";
const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' };
const LIST_PATH = '/admin/pricing/railway-station';

const defaultFormData = {
  name: '',
  code: '',
  service_location_id: '',
  address: '',
  status: 'active',
  latitude: '',
  longitude: '',
};

const RailwayStation = ({ mode: initialMode = 'list' }) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [view, setView] = useState(initialMode);
  const [stations, setStations] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [entriesPerPage, setEntriesPerPage] = useState(10);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(id || null);
  const [formData, setFormData] = useState(defaultFormData);
  const [mapCenter, setMapCenter] = useState(DELHI_CENTER);
  const [autocomplete, setAutocomplete] = useState(null);
  const [filters, setFilters] = useState({ service_location_id: '', status: '' });
  const mapRef = useRef(null);
  const { isLoaded } = useAppGoogleMapsLoader();

  const resetFormState = () => {
    setSelectedId(null);
    setFormData(defaultFormData);
    setMapCenter(DELHI_CENTER);
  };

  useEffect(() => {
    setView(initialMode);
    if (initialMode === 'list') resetFormState();
  }, [initialMode]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [stationsRes, locationsRes] = await Promise.allSettled([
        adminService.getRailwayStations(),
        adminService.getServiceLocations(),
      ]);
      const pick = (res, key) => {
        if (res.status !== 'fulfilled') return [];
        const v = res.value;
        const list = v?.data?.[key] || v?.data || v?.results || v;
        return Array.isArray(list) ? list : [];
      };
      setStations(pick(stationsRes, 'railway_stations'));
      setServiceLocations(pick(locationsRes, 'service_locations'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleEdit = (station) => {
    setSelectedId(station._id || station.id);
    setFormData({
      name: station.name || '',
      code: station.code || '',
      service_location_id: station.service_location_id?._id || station.service_location_id || '',
      address: station.address || '',
      latitude: station.latitude ?? '',
      longitude: station.longitude ?? '',
      status: station.status || 'active',
    });
    if (station.latitude && station.longitude) {
      setMapCenter({ lat: Number(station.latitude), lng: Number(station.longitude) });
    }
  };

  useEffect(() => {
    if (id && initialMode === 'edit' && stations.length > 0) {
      const station = stations.find((s) => (s._id || s.id) === id);
      if (station) handleEdit(station);
    }
  }, [id, stations]);

  const filteredStations = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return stations.filter((s) => {
      const matchesSearch = !query || [s.name, s.code, s.address, s.service_location_id?.name]
        .filter(Boolean).some((val) => String(val).toLowerCase().includes(query));
      const slId = String(s.service_location_id?._id || s.service_location_id || '');
      const matchesLocation = !filters.service_location_id || slId === String(filters.service_location_id);
      const matchesStatus = !filters.status || String(s.status || 'active').toLowerCase() === filters.status;
      return matchesSearch && matchesLocation && matchesStatus;
    });
  }, [stations, filters, searchTerm]);

  const updatePinnedLocation = (lat, lng) => {
    const nextLat = Number(lat);
    const nextLng = Number(lng);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
    setFormData((prev) => ({ ...prev, latitude: nextLat.toFixed(6), longitude: nextLng.toFixed(6) }));
    setMapCenter({ lat: nextLat, lng: nextLng });
  };

  const handlePlaceChanged = () => {
    if (!autocomplete) return;
    const place = autocomplete.getPlace();
    const lat = place.geometry?.location?.lat?.();
    const lng = place.geometry?.location?.lng?.();
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      updatePinnedLocation(lat, lng);
      mapRef.current?.panTo({ lat, lng });
      mapRef.current?.setZoom(15);
      setFormData((prev) => ({
        ...prev,
        name: prev.name || place.name || '',
        address: prev.address || place.formatted_address || '',
      }));
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.service_location_id) {
      alert('Station name and service location are required.');
      return;
    }
    if (!formData.latitude || !formData.longitude) {
      alert('Pin the station on the map so riders can be shown the nearest one.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...formData, name: formData.name.trim() };
      const res = selectedId
        ? await adminService.updateRailwayStation(selectedId, payload)
        : await adminService.createRailwayStation(payload);
      if (res?.success || res?.status === 200 || res?.status === 201) {
        navigate(LIST_PATH);
        fetchData();
        resetFormState();
      } else {
        alert(res?.data?.message || res?.message || 'Failed to save railway station');
      }
    } catch (err) {
      alert(err?.response?.data?.message || 'Server error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (stationId) => {
    if (!window.confirm('Delete this railway station permanently?')) return;
    try {
      const res = await adminService.deleteRailwayStation(stationId);
      if (res?.success) setStations((prev) => prev.filter((s) => s._id !== stationId && s.id !== stationId));
    } catch (err) {
      alert('Delete failed');
    }
  };

  const handleStatusUpdate = async (station, nextStatus) => {
    const stationId = station._id || station.id;
    try {
      const res = await adminService.updateRailwayStation(stationId, { status: nextStatus });
      if (res?.success) {
        setStations((prev) => prev.map((s) => ((s._id || s.id) === stationId ? { ...s, status: nextStatus, active: nextStatus === 'active' } : s)));
      } else {
        alert(res?.message || 'Failed to update status');
      }
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to update status');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 lg:p-8 animate-in fade-in duration-500 font-sans">
      <AnimatePresence mode="wait">
        {view === 'list' ? (
          <motion.div key="list" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-7xl mx-auto space-y-6">
            <div className="mb-6">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                <span>Pricing</span>
                <ChevronRight size={12} />
                <span className="text-gray-700">Railway Station Management</span>
              </div>
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900">Railway Stations</h1>
                <button onClick={() => navigate('create')} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm">
                  <Plus size={16} /> Add Railway Station
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/30">
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <span>Show</span>
                  <select value={entriesPerPage} onChange={(e) => setEntriesPerPage(Number(e.target.value))} className="border border-gray-200 rounded px-2 py-1 bg-white outline-none focus:border-indigo-500">
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                  <span>entries</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search stations..." className="pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-500 transition-all w-64" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsFilterOpen((c) => !c)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${isFilterOpen ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-gray-200 bg-white text-gray-500 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600'}`}
                  >
                    <Filter size={18} />
                    <span>{isFilterOpen ? 'Hide Filters' : 'Filters'}</span>
                  </button>
                </div>
              </div>

              {isFilterOpen ? (
                <div className="grid grid-cols-1 gap-4 border-b border-gray-100 bg-white px-4 py-4 md:grid-cols-3">
                  <div>
                    <label className={labelClass}>Service Location</label>
                    <select value={filters.service_location_id} onChange={(e) => setFilters((c) => ({ ...c, service_location_id: e.target.value }))} className={inputClass}>
                      <option value="">All service locations</option>
                      {serviceLocations.map((sl) => <option key={sl._id || sl.id} value={sl._id || sl.id}>{sl.name || sl.service_location_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Status</label>
                    <select value={filters.status} onChange={(e) => setFilters((c) => ({ ...c, status: e.target.value }))} className={inputClass}>
                      <option value="">All statuses</option>
                      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button type="button" onClick={() => setFilters({ service_location_id: '', status: '' })} className="h-[42px] w-full rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50">
                      Reset Filters
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-6 py-4 text-left font-semibold text-gray-700">Station Name</th>
                      <th className="px-6 py-4 text-left font-semibold text-gray-700">Code</th>
                      <th className="px-6 py-4 text-left font-semibold text-gray-700">Service Location</th>
                      <th className="px-6 py-4 text-center font-semibold text-gray-700">Status</th>
                      <th className="px-6 py-4 text-right font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr><td colSpan="5" className="py-20 text-center text-gray-400"><Loader2 className="animate-spin mx-auto mb-2" /><span>Loading data...</span></td></tr>
                    ) : filteredStations.length > 0 ? (
                      filteredStations.slice(0, entriesPerPage).map((station) => (
                        <tr key={station._id || station.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded bg-indigo-50 flex items-center justify-center text-indigo-600"><Train size={14} /></div>
                              <span className="font-medium text-gray-900">{station.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-gray-600">{station.code || '—'}</td>
                          <td className="px-6 py-4 text-gray-600">{station.service_location_id?.name || 'N/A'}</td>
                          <td className="px-6 py-4 text-center">
                            <select
                              value={String(station.status || 'active').toLowerCase()}
                              onChange={(e) => handleStatusUpdate(station, e.target.value)}
                              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-700 outline-none transition-colors hover:border-indigo-200 focus:border-indigo-500"
                            >
                              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2 text-gray-400">
                              <button onClick={() => navigate(`edit/${station._id || station.id}`)} className="p-1.5 hover:text-indigo-600 transition-colors"><Edit2 size={14} /></button>
                              <button onClick={() => handleDelete(station._id || station.id)} className="p-1.5 hover:text-rose-600 transition-colors"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="py-32 text-center text-gray-400">
                          <FileSearch size={48} className="mx-auto mb-4 opacity-20" />
                          <h3 className="text-gray-900 font-semibold">No Data Found</h3>
                          <p className="text-xs">Try adjusting your search or add a new railway station.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-7xl mx-auto space-y-6">
            <div className="mb-6">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                <span>Pricing</span>
                <ChevronRight size={12} />
                <span>Railway Station Management</span>
                <ChevronRight size={12} />
                <span className="text-gray-700">{id ? 'Edit' : 'Create'}</span>
              </div>
              <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900">{id ? 'Edit Railway Station' : 'Add Railway Station'}</h1>
                <button onClick={() => navigate(LIST_PATH)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <ArrowLeft size={16} /> Back
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 md:gap-6">
              <div className="xl:col-span-5 space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600"><Train size={18} /></div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Station Details</h3>
                      <p className="text-xs text-gray-400">Shown to riders as a suggestion in Railway rides</p>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div>
                      <label className={labelClass}><MapPin size={12} className="inline mr-1 text-gray-400" />Service Location *</label>
                      <select
                        value={formData.service_location_id}
                        onChange={(e) => {
                          const sid = e.target.value;
                          setFormData((p) => ({ ...p, service_location_id: sid }));
                          const loc = serviceLocations.find((l) => (l._id || l.id) === sid);
                          if (loc && Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude))) {
                            const center = { lat: Number(loc.latitude), lng: Number(loc.longitude) };
                            setMapCenter(center);
                            mapRef.current?.panTo(center);
                          }
                        }}
                        className={inputClass}
                      >
                        <option value="">Select Service Location</option>
                        {serviceLocations.map((sl) => <option key={sl._id || sl.id} value={sl._id || sl.id}>{sl.name}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className={labelClass}><Tag size={12} className="inline mr-1 text-gray-400" />Station Name *</label>
                      <input type="text" value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Indore Junction" className={inputClass} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Station Code</label>
                        <input type="text" value={formData.code} onChange={(e) => setFormData((p) => ({ ...p, code: e.target.value }))} placeholder="e.g. INDB" className={inputClass} />
                      </div>
                      <div>
                        <label className={labelClass}>Status</label>
                        <select value={formData.status} onChange={(e) => setFormData((p) => ({ ...p, status: e.target.value }))} className={inputClass}>
                          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className={labelClass}>Address</label>
                      <input type="text" value={formData.address} onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))} placeholder="Station address" className={inputClass} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Latitude</label>
                        <input type="text" readOnly value={formData.latitude} placeholder="Pin on map" className={`${inputClass} bg-gray-50`} />
                      </div>
                      <div>
                        <label className={labelClass}>Longitude</label>
                        <input type="text" readOnly value={formData.longitude} placeholder="Pin on map" className={`${inputClass} bg-gray-50`} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 p-4 md:p-6 space-y-3">
                  <button onClick={handleSave} disabled={saving} className="w-full py-3 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2">
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {id ? 'Update Railway Station' : 'Save Railway Station'}
                  </button>
                  <button onClick={() => navigate(LIST_PATH)} className="w-full py-3 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>

              <div className="xl:col-span-7">
                <div className="bg-white rounded-xl border border-gray-200 p-2 h-[600px] shadow-sm relative overflow-hidden">
                  {isLoaded ? (
                    <div className="w-full h-full rounded-lg overflow-hidden relative">
                      <div className="absolute inset-x-4 top-4 z-10 md:max-w-md">
                        <div className="flex h-12 w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white/95 px-4 shadow-xl backdrop-blur-sm">
                          <Search className="text-gray-400" size={18} />
                          <Autocomplete onLoad={(a) => setAutocomplete(a)} onPlaceChanged={handlePlaceChanged} className="flex-1">
                            <input type="text" placeholder="Search for a railway station" className="w-full bg-transparent text-sm font-semibold text-gray-800 outline-none placeholder:text-gray-400" />
                          </Autocomplete>
                        </div>
                      </div>

                      <GoogleMap
                        mapContainerStyle={MAP_CONTAINER_STYLE}
                        center={mapCenter}
                        zoom={13}
                        onLoad={(m) => { mapRef.current = m; }}
                        onClick={(e) => updatePinnedLocation(e.latLng?.lat(), e.latLng?.lng())}
                        options={{ mapTypeId: 'roadmap', zoomControl: true, mapTypeControl: true, clickableIcons: true, streetViewControl: false, fullscreenControl: true }}
                      >
                        <MarkerF
                          position={{ lat: Number(formData.latitude || mapCenter.lat), lng: Number(formData.longitude || mapCenter.lng) }}
                          draggable
                          onDragEnd={(e) => updatePinnedLocation(e.latLng?.lat(), e.latLng?.lng())}
                        />
                      </GoogleMap>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg"><Loader2 className="animate-spin text-gray-300" size={32} /></div>
                  )}
                </div>

                <div className="mt-6 bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-start gap-3">
                  <Info size={18} className="text-indigo-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-indigo-900 leading-relaxed font-medium">
                    Search the station or click the map to drop the pin. Active stations are suggested first (nearest to the rider) in the app's Railway ride screen.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default RailwayStation;
