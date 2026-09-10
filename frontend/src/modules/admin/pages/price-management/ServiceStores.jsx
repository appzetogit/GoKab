import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { Autocomplete, GoogleMap, MarkerF, Polygon } from '@react-google-maps/api';
import {
  ArrowLeft,
  Building2,
  Car,
  ChevronRight,
  Edit2,
  Loader2,
  MapPin,
  Plus,
  Users,
  Save,
  Search,
  Trash2,
  ShieldCheck,
  AlertCircle,
  Phone,
  LayoutGrid
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { INDIA_CENTER, useAppGoogleMapsLoader } from '../../utils/googleMaps';

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/5';
const labelClass = 'mb-2 block text-[11px] font-black uppercase tracking-widest text-slate-400';

const defaultFormData = {
  name: '',
  zone_id: '',
  address: '',
  owner_name: '',
  owner_phone: '',
  latitude: '',
  longitude: '',
  status: 'active',
};

const defaultStaffFormData = {
  name: '',
  phone: '',
};

const getZoneBoundary = (zone) =>
  Array.isArray(zone?.coordinates)
    ? zone.coordinates
        .map((point) => ({
          lat: Number(point?.lat),
          lng: Number(point?.lng),
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    : [];

const ServiceStores = ({ mode: initialMode = 'list' }) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [view, setView] = useState(initialMode);
  const [stores, setStores] = useState([]);
  const [zones, setZones] = useState([]);
  const [serviceLocations, setServiceLocations] = useState([]);
  const [rentalVehicles, setRentalVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState(id || null);
  const [formData, setFormData] = useState(defaultFormData);
  const [staffFormData, setStaffFormData] = useState(defaultStaffFormData);
  const [zoneBoundary, setZoneBoundary] = useState([]);
  const [mapCenter, setMapCenter] = useState(INDIA_CENTER);
  const [autocomplete, setAutocomplete] = useState(null);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const [addingStaff, setAddingStaff] = useState(false);
  const mapRef = useRef(null);
  const geocoderRef = useRef(null);
  const reverseGeocodeRequestRef = useRef(0);
  const { isLoaded } = useAppGoogleMapsLoader();

  const serviceLocationMap = useMemo(
    () =>
      new Map(
        serviceLocations.map((location) => [String(location._id || location.id), location]),
      ),
    [serviceLocations],
  );

  const getZoneCenter = (zone) => {
    const boundary = getZoneBoundary(zone);
    if (boundary.length > 0) {
      return boundary[0];
    }
    const locationId = zone?.service_location_id || zone?.service_location_id?._id;
    const serviceLocation = serviceLocationMap.get(String(locationId || ''));
    const lat = Number(serviceLocation?.latitude);
    const lng = Number(serviceLocation?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return INDIA_CENTER;
  };

  const resetFormState = () => {
    setSelectedStoreId(null);
    setFormData(defaultFormData);
    setStaffFormData(defaultStaffFormData);
    setZoneBoundary([]);
    setMapCenter(INDIA_CENTER);
  };

  useEffect(() => {
    setView(initialMode);
    if (initialMode === 'list') resetFormState();
  }, [initialMode]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [storesRes, zonesRes, locationsRes, rentalVehiclesRes] = await Promise.allSettled([
        adminService.getServiceStores(),
        adminService.getZones(),
        adminService.getServiceLocations(),
        adminService.getRentalVehicleTypes(),
      ]);
      const nextStores = storesRes.status === 'fulfilled' ? (storesRes.value?.data?.data?.results || storesRes.value?.data?.results || storesRes.value?.results || []) : [];
      const nextZones = zonesRes.status === 'fulfilled' ? (zonesRes.value?.data?.data?.results || zonesRes.value?.data?.results || zonesRes.value?.results || []) : [];
      const nextServiceLocations = locationsRes.status === 'fulfilled' ? (locationsRes.value?.data?.data || locationsRes.value?.data?.results || locationsRes.value?.results || []) : [];
      const nextRentalVehicles = rentalVehiclesRes.status === 'fulfilled' ? (rentalVehiclesRes.value?.data?.data?.results || rentalVehiclesRes.value?.data?.results || rentalVehiclesRes.value?.results || []) : [];

      setStores(nextStores);
      setZones(nextZones);
      setServiceLocations(nextServiceLocations);
      setRentalVehicles(nextRentalVehicles);

      if (id && initialMode === 'edit') {
        const store = nextStores.find(s => String(s._id || s.id) === String(id));
        if (store) handleEdit(store, nextZones, nextServiceLocations);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (id && zones.length > 0 && stores.length > 0 && initialMode === 'edit') {
      const store = stores.find(s => String(s._id || s.id) === String(id));
      if (store) handleEdit(store, zones, serviceLocations);
    }
  }, [id, initialMode, stores, zones]);

  const selectedZone = useMemo(() => zones.find(z => String(z._id || z.id) === String(formData.zone_id)), [formData.zone_id, zones]);
  const selectedServiceLocation = useMemo(() => {
    const locId = selectedZone?.service_location_id?._id || selectedZone?.service_location_id;
    return serviceLocationMap.get(String(locId || '')) || null;
  }, [selectedZone, serviceLocationMap]);

  const filteredStores = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter(s => [s.name, s.owner_name, s.owner_phone, s.zone_id?.name, s.address].some(v => String(v || '').toLowerCase().includes(q)));
  }, [searchTerm, stores]);

  const selectedStore = useMemo(() => stores.find(s => String(s._id || s.id) === String(selectedStoreId)), [selectedStoreId, stores]);
  const selectedStoreStaff = useMemo(() => Array.isArray(selectedStore?.staff) ? selectedStore.staff : [], [selectedStore]);
  const selectedStoreVehicles = useMemo(() => rentalVehicles.filter(v => Array.isArray(v.serviceStoreIds) && v.serviceStoreIds.some(sid => String(sid) === String(selectedStoreId))), [rentalVehicles, selectedStoreId]);

  const fillAddressFromCoordinates = (lat, lng) => {
    if (!window.google?.maps?.Geocoder) return;
    const geocoder = geocoderRef.current || new window.google.maps.Geocoder();
    geocoderRef.current = geocoder;
    setIsResolvingAddress(true);
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      setIsResolvingAddress(false);
      if (status === 'OK' && results[0]) {
        setFormData(prev => ({ ...prev, address: results[0].formatted_address }));
      }
    });
  };

  const updatePinnedLocation = (lat, lng, opts = {}) => {
    const nLat = Number(lat), nLng = Number(lng);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return;
    setFormData(prev => ({ ...prev, latitude: nLat.toFixed(6), longitude: nLng.toFixed(6), address: opts.address || prev.address }));
    setMapCenter({ lat: nLat, lng: nLng });
    if (!opts.address && !opts.skipLookup) fillAddressFromCoordinates(nLat, nLng);
  };

  const handleZoneChange = (zid) => {
    setFormData(prev => ({ ...prev, zone_id: zid }));
    const zone = zones.find(z => String(z._id || z.id) === String(zid));
    setZoneBoundary(getZoneBoundary(zone));
    const center = getZoneCenter(zone);
    setMapCenter(center);
    mapRef.current?.panTo(center);
  };

  const handleEdit = (store, zItems = zones) => {
    setSelectedStoreId(store._id || store.id);
    const zid = store.zone_id?._id || store.zone_id || '';
    const zone = zItems.find(z => String(z._id || z.id) === String(zid));
    setFormData({
      name: store.name || '',
      zone_id: zid,
      address: store.address || '',
      owner_name: store.owner_name || '',
      owner_phone: store.owner_phone || '',
      latitude: store.latitude ?? '',
      longitude: store.longitude ?? '',
      status: store.status || 'active',
    });
    setZoneBoundary(getZoneBoundary(zone));
    const lat = Number(store.latitude), lng = Number(store.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) setMapCenter({ lat, lng });
    else setMapCenter(getZoneCenter(zone));
  };

  const handlePlaceChanged = () => {
    if (!autocomplete) return;
    const place = autocomplete.getPlace();
    const lat = place.geometry?.location?.lat(), lng = place.geometry?.location?.lng();
    if (lat && lng) {
      updatePinnedLocation(lat, lng, { address: place.formatted_address || place.name });
      mapRef.current?.panTo({ lat, lng });
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.zone_id) return alert('Name and zone are required.');
    if (!formData.latitude || !formData.longitude) return alert('Pin the store on the map.');
    setSaving(true);
    try {
      const payload = { ...formData, latitude: Number(formData.latitude), longitude: Number(formData.longitude) };
      const res = selectedStoreId ? await adminService.updateServiceStore(selectedStoreId, payload) : await adminService.createServiceStore(payload);
      if (res?.data?.success || res?.success) {
        navigate('/admin/pricing/service-stores');
        fetchData();
      }
    } catch (e) { alert(e.response?.data?.message || 'Error saving.'); } finally { setSaving(false); }
  };

  const handleAddStaff = async () => {
    if (!selectedStoreId) return alert('Save store first.');
    const name = staffFormData.name.trim(), phone = staffFormData.phone.replace(/\D/g, '').slice(-10);
    if (!name || phone.length !== 10) return alert('Valid name and 10-digit phone required.');
    setAddingStaff(true);
    try {
      const res = await adminService.createServiceStoreStaff(selectedStoreId, { name, phone });
      if (res) {
        fetchData();
        setStaffFormData(defaultStaffFormData);
        setAddingStaff(false);
      }
    } catch (e) { alert(e.response?.data?.message || 'Error adding staff.'); } finally { setAddingStaff(false); }
  };

  const handleDelete = async (sid) => {
    if (!window.confirm('Delete this store?')) return;
    try {
      const res = await adminService.deleteServiceStore(sid);
      if (res) fetchData();
    } catch (e) { alert('Delete failed.'); }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] p-4 md:p-6 lg:p-8 font-sans">
      <AnimatePresence mode="wait">
        {view === 'list' ? (
          <motion.div key="list" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mx-auto max-w-7xl space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
                  <span>Pricing</span><ChevronRight size={10} /><span className="text-slate-900">Stores</span>
                </div>
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Service Stores</h1>
              </div>
              <button onClick={() => navigate('/admin/pricing/service-stores/add')} className="flex items-center gap-2 rounded-2xl bg-slate-900 px-6 py-4 text-sm font-black text-white shadow-xl shadow-slate-900/10 transition-all hover:scale-105">
                <Plus size={18} /> Add New Store
              </button>
            </div>
            <div className="grid gap-4 md:gap-6 md:grid-cols-3">
              {[{ label: 'Total Registry', val: stores.length, icon: Building2 }, { label: 'Zones', val: new Set(stores.map(s => s.zone_id?._id || s.zone_id)).size, icon: MapPin }, { label: 'Active', val: stores.filter(s => s.status === 'active').length, icon: ShieldCheck }].map((s, i) => (
                <div key={i} className="rounded-[2rem] border border-slate-200 bg-white p-4 md:p-8 shadow-sm">
                  <div className="flex justify-between mb-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{s.label}</p><s.icon size={16} className="text-slate-300" /></div>
                  <p className="text-4xl font-black text-slate-900">{s.val}</p>
                </div>
              ))}
            </div>
            <div className="overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50/50 p-4 md:p-6">
                <div className="relative max-w-md"><Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search registry..." className="w-full rounded-2xl border border-slate-200 py-3.5 pl-12 pr-5 text-[13px] font-bold text-slate-900 outline-none focus:border-slate-900 focus:ring-8 focus:ring-slate-900/5" /></div>
              </div>
              <div className="overflow-x-auto no-scrollbar">
                {loading ? <div className="py-24 text-center"><Loader2 size={32} className="animate-spin text-slate-900 mx-auto" /></div> : (
                  <table className="w-full text-left">
                    <thead><tr className="bg-slate-50/30 border-b border-slate-100">{['Identity', 'Zone', 'Owner', 'Fleet', 'Status', ''].map(h => <th key={h} className="px-8 py-5 text-[10px] font-black uppercase tracking-widest text-slate-400">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredStores.map(s => (
                        <tr key={s._id || s.id} className="group hover:bg-slate-50/30">
                          <td className="px-8 py-6 flex items-center gap-4"><div className="h-11 w-11 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-900 group-hover:bg-slate-900 group-hover:text-white transition-colors"><Building2 size={18} /></div><div><p className="text-[14px] font-bold text-slate-900">{s.name}</p><p className="text-[11px] text-slate-400 truncate max-w-[150px]">{s.address}</p></div></td>
                          <td className="px-8 py-6 text-[13px] font-bold text-slate-700">{s.zone_id?.name || '-'}</td>
                          <td className="px-8 py-6"><p className="text-[13px] font-bold text-slate-900">{s.owner_name}</p><p className="text-[11px] text-slate-400">{s.owner_phone}</p></td>
                          <td className="px-8 py-6"><div className="flex gap-4"><div className="flex items-center gap-1.5"><Users size={14} className="text-slate-300"/><span className="text-[13px] font-black">{s.staff?.length || 0}</span></div><div className="flex items-center gap-1.5"><Car size={14} className="text-slate-300"/><span className="text-[13px] font-black">{rentalVehicles.filter(v => v.serviceStoreIds?.includes(s._id || s.id)).length}</span></div></div></td>
                          <td className="px-8 py-6"><div className="flex items-center gap-2"><div className={`h-1.5 w-1.5 rounded-full ${s.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`} /><span className="text-[10px] font-black uppercase text-slate-400">{s.status}</span></div></td>
                          <td className="px-8 py-6 text-right"><div className="flex justify-end gap-1"><button onClick={() => navigate(`/admin/pricing/service-stores/edit/${s._id || s.id}`)} className="p-2.5 text-slate-300 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"><Edit2 size={16} /></button><button onClick={() => handleDelete(s._id || s.id)} className="p-2.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={16} /></button></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto max-w-7xl space-y-8">
            <div className="flex items-center justify-between"><div><h1 className="text-2xl font-black text-slate-900 tracking-tight">{selectedStoreId ? 'Configure Hub' : 'Initialize Hub'}</h1></div><button onClick={() => navigate('/admin/pricing/service-stores')} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-[13px] font-bold text-slate-600 hover:border-slate-900 hover:text-slate-900 transition-all"><ArrowLeft size={16} /> Return</button></div>
            <div className="grid gap-4 md:gap-8 xl:grid-cols-[400px_minmax(0,1fr)]">
              <div className="space-y-6">
                <div className="rounded-[2.5rem] border border-slate-200 bg-white p-4 md:p-8 shadow-sm space-y-6">
                  <div className="flex items-center gap-4 mb-4"><div className="h-12 w-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white"><Building2 size={20} /></div><div><h3 className="font-bold text-slate-900">Identity Details</h3><p className="text-[11px] text-slate-400 uppercase tracking-widest font-black">Core Metadata</p></div></div>
                  <div><label className={labelClass}>Store Name</label><input type="text" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className={inputClass} placeholder="Hub Name" /></div>
                  <div><label className={labelClass}>Zone Association</label><select value={formData.zone_id} onChange={e => handleZoneChange(e.target.value)} className={inputClass}><option value="">Select Zone</option>{zones.map(z => <option key={z._id || z.id} value={z._id || z.id}>{z.name}</option>)}</select></div>
                  <div><label className={labelClass}>Physical Address</label><textarea value={formData.address} onChange={e => setFormData(p => ({ ...p, address: e.target.value }))} className={`${inputClass} min-h-[100px] resize-none leading-relaxed`} placeholder="Street address" /></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className={labelClass}>Status</label><select value={formData.status} onChange={e => setFormData(p => ({ ...p, status: e.target.value }))} className={inputClass}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                    <div><label className={labelClass}>Owner Contact</label><input type="text" value={formData.owner_phone} onChange={e => setFormData(p => ({ ...p, owner_phone: e.target.value }))} className={inputClass} placeholder="Phone" /></div>
                  </div>
                  <button onClick={handleSave} disabled={saving} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-sm shadow-xl shadow-slate-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2">{saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} COMMIT CONFIGURATION</button>
                </div>
              </div>
              <div className="space-y-8">
                <div className="rounded-[3rem] border border-slate-200 bg-white p-2 shadow-xl shadow-slate-200/40"><div className="relative h-[440px] w-full overflow-hidden rounded-[2.5rem]">{isLoaded ? <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={mapCenter} zoom={14} onLoad={m => mapRef.current = m} options={{ disableDefaultUI: true }}>{(formData.latitude || formData.longitude) && <MarkerF position={{ lat: Number(formData.latitude || mapCenter.lat), lng: Number(formData.longitude || mapCenter.lng) }} draggable onDragEnd={e => updatePinnedLocation(e.latLng.lat(), e.latLng.lng())} />}{zoneBoundary.length > 0 && <Polygon paths={zoneBoundary} options={{ fillColor: '#0F172A', fillOpacity: 0.05, strokeColor: '#0F172A', strokeOpacity: 0.4, strokeWeight: 2 }} />}<div className="absolute left-6 top-6 w-[320px]"><Autocomplete onLoad={setAutocomplete} onPlaceChanged={handlePlaceChanged}><div className="relative"><Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input type="text" placeholder="Search & Pin Location..." className="w-full rounded-2xl border-none bg-white/95 py-4 pl-12 pr-5 text-[13px] font-bold text-slate-900 shadow-2xl backdrop-blur-xl outline-none focus:ring-4 focus:ring-slate-900/10" /></div></Autocomplete></div></GoogleMap> : <div className="h-full bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-slate-300" /></div>}</div></div>
                {selectedStoreId && (
                  <div className="grid lg:grid-cols-2 gap-4 md:gap-8">
                    <div className="rounded-[2.5rem] border border-slate-200 bg-white p-4 md:p-8 shadow-sm">
                      <div className="flex items-center justify-between mb-8"><div className="flex gap-4 items-center"><div className="h-12 w-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-900"><Users size={20} /></div><div><h3 className="font-bold text-slate-900">Personnel</h3><p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Team Management</p></div></div><button onClick={() => setAddingStaff(!addingStaff)} className="h-8 w-8 bg-slate-900 text-white rounded-lg flex items-center justify-center transition-all hover:scale-110">{addingStaff ? <AlertCircle size={16} /> : <Plus size={16} />}</button></div>
                      <AnimatePresence>{addingStaff && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-8"><div className="p-5 bg-slate-50 rounded-2xl space-y-4"><div><label className={labelClass}>Name</label><input type="text" value={staffFormData.name} onChange={e => setStaffFormData(p => ({ ...p, name: e.target.value }))} className={inputClass} placeholder="Staff Name" /></div><div><label className={labelClass}>Phone</label><input type="text" value={staffFormData.phone} onChange={e => setStaffFormData(p => ({ ...p, phone: e.target.value }))} className={inputClass} placeholder="10-digit number" /></div><button onClick={handleAddStaff} className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-xs transition-all hover:bg-slate-800">AUTHENTICATE & ADD</button></div></motion.div>}</AnimatePresence>
                      <div className="space-y-3">{selectedStoreStaff.length === 0 ? <div className="py-8 text-center border-2 border-dashed border-slate-100 rounded-2xl text-[11px] text-slate-400 font-bold italic">No Personnel Registered</div> : selectedStoreStaff.map((s, i) => <div key={i} className="flex justify-between items-center p-4 bg-white border border-slate-100 rounded-2xl hover:border-slate-200 transition-all"><div className="flex gap-3 items-center"><div className="h-9 w-9 bg-slate-50 rounded-xl flex items-center justify-center text-[11px] font-black text-slate-400 border border-slate-100">{s.name?.[0]}</div><div><p className="text-[13px] font-bold text-slate-900">{s.name}</p><p className="text-[11px] text-slate-400 font-medium">{s.phone}</p></div></div><div className="flex items-center gap-2"><div className="h-1.5 w-1.5 rounded-full bg-emerald-500" /><span className="text-[10px] font-black text-slate-300 uppercase">Live</span></div></div>)}</div>
                    </div>
                    <div className="rounded-[2.5rem] border border-slate-200 bg-white p-4 md:p-8 shadow-sm">
                      <div className="flex gap-4 items-center mb-8"><div className="h-12 w-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-900"><Car size={20} /></div><div><h3 className="font-bold text-slate-900">Active Fleet</h3><p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Assigned Vehicles</p></div></div>
                      <div className="space-y-3">{selectedStoreVehicles.length === 0 ? <div className="py-8 text-center border-2 border-dashed border-slate-100 rounded-2xl text-[11px] text-slate-400 font-bold italic">No Assets Assigned</div> : selectedStoreVehicles.map((v, i) => <div key={i} className="flex justify-between items-center p-4 bg-white border border-slate-100 rounded-2xl transition-all"><div className="flex gap-4 items-center"><div className="h-10 w-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg shadow-slate-900/10"><Car size={16} /></div><div><p className="text-[13px] font-bold text-slate-900">{v.name}</p><p className="text-[11px] text-slate-400 font-medium">{v.vehicleCategory} · {v.capacity} Seats</p></div></div><ChevronRight size={14} className="text-slate-300" /></div>)}</div>
                      <div className="mt-6 p-4 bg-slate-50 border border-slate-100 rounded-2xl text-[10px] text-slate-400 font-medium italic leading-relaxed text-center uppercase tracking-widest">Update assets via Vehicle Types registry</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ServiceStores;
