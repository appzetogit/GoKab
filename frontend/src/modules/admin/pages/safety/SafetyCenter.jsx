import React, { useEffect, useMemo, useState } from 'react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Globe,
  History,
  LifeBuoy,
  MapPin,
  MoreHorizontal,
  PhoneCall,
  Radio,
  ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { socketService } from '../../../../shared/api/socket';
import { adminService } from '../../services/adminService';
import { HAS_VALID_GOOGLE_MAPS_KEY, INDIA_CENTER, useAppGoogleMapsLoader } from '../../utils/googleMaps';
import SupportChatPanel from '../../../shared/components/SupportChatPanel';
import { getChatSession } from '../../../shared/chat/chatIdentity';

const mapContainerStyle = { width: '100%', height: '100%' };

const formatRelativeTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Just now';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatDateTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';

  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getParticipantTitle = (alert) =>
  alert?.sourceApp === 'driver'
    ? alert?.driverName || 'Driver'
    : alert?.riderName || 'Rider';

const getDriverLabel = (alert) => alert?.driverName || 'Unassigned driver';
const getRiderLabel = (alert) => alert?.riderName || 'User';

const getMapCenter = (alert) =>
  Number.isFinite(Number(alert?.location?.lat)) && Number.isFinite(Number(alert?.location?.lng))
    ? { lat: Number(alert.location.lat), lng: Number(alert.location.lng) }
    : INDIA_CENTER;

const SOSCard = ({ alert, isActive, onClick }) => (
  <div
    onClick={onClick}
    className={`p-4 rounded-2xl border transition-all cursor-pointer relative ${
      isActive 
        ? 'bg-rose-50/60 border-rose-400 shadow-lg shadow-rose-100/50' 
        : 'bg-white border-slate-100 hover:border-rose-200'
    }`}
  >
    <div className="flex justify-between items-center mb-3">
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isActive ? 'bg-rose-500 text-white animate-pulse' : 'bg-rose-100 text-rose-700'}`}>
        Emergency
      </span>
      <div className="flex items-center gap-1 text-[11px] text-slate-400">
        <Clock size={11} /> {formatRelativeTime(alert?.createdAt)}
      </div>
    </div>

    <h4 className="text-sm font-semibold text-slate-900 mb-0.5">
      {getParticipantTitle(alert)}
    </h4>
    <p className="text-[10px] font-mono text-slate-400 mb-3">
      {alert?.tripCode || alert?.rideId || 'GEN-SOS-INT'}
    </p>

    <div className="space-y-1.5 border-t border-slate-100 pt-3 text-[12px]">
      <p className="font-medium text-slate-700">{getDriverLabel(alert)}</p>
      <p className="text-[10px] text-slate-400">
        {alert?.vehicleLabel || alert?.serviceType || 'Unknown Fleet Unit'}
      </p>
      <div className="flex items-center gap-1.5 mt-1.5">
         <MapPin size={12} className="text-rose-500 shrink-0" />
         <p className="text-[11px] text-slate-600 truncate">
            {alert?.locationLabel || alert?.pickupAddress || 'Locating...'}
         </p>
      </div>
    </div>
  </div>
);

const SafetyCenter = () => {
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const [alerts, setAlerts] = useState([]);
  const [selectedAlertId, setSelectedAlertId] = useState('');
  const [checklist, setChecklist] = useState({
    pcall: false,
    dcall: false,
    police: false,
    nearby: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [logDraft, setLogDraft] = useState('');
  const [activeTab, setActiveTab] = useState('chat');

  const selectedAlert = useMemo(
    () => alerts.find((entry) => entry.id === selectedAlertId) || alerts[0] || null,
    [alerts, selectedAlertId],
  );

  const adminSession = useMemo(() => getChatSession('admin'), []);
  const adminId = adminSession?.id;

  const chatParams = useMemo(() => {
    if (!selectedAlert || !adminId) return null;
    const isDriver = selectedAlert.sourceApp === 'driver';
    const peerRole = isDriver ? 'driver' : 'user';
    const peerId = isDriver ? selectedAlert.driverId : selectedAlert.userId;
    const peerName = isDriver
      ? selectedAlert.driverName || 'Driver'
      : selectedAlert.riderName || 'Rider';
    const peerPhone = isDriver
      ? selectedAlert.driverPhone || ''
      : selectedAlert.riderPhone || '';

    if (!peerId) return null;

    return {
      conversationKey: `${peerRole}:${adminId}:${peerId}`,
      peerRole,
      peerId,
      peerName,
      peerPhone,
    };
  }, [selectedAlert, adminId]);

  const loadAlerts = async () => {
    setIsLoading(true);
    try {
      const response = await adminService.getSafetyAlerts({ status: 'active', limit: 50 });
      const results = response?.data?.data?.results || response?.data?.results || [];
      setAlerts(results);
      setSelectedAlertId((current) => current || results[0]?.id || '');
    } catch (error) {
      console.error('Failed to load safety alerts:', error);
      toast.error(error?.message || 'Terminal: SOS Sync Failed');
      setAlerts([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  useEffect(() => {
    const handleNewAlert = (payload = {}) => {
      setAlerts((current) => [payload, ...current.filter((item) => item.id !== payload.id)]);
      setSelectedAlertId((current) => current || payload.id || '');
      toast.error(`SOS TRIGGERED: ${getParticipantTitle(payload)}`, { 
        duration: 5000,
        style: { background: '#991B1B', color: '#fff', fontWeight: '900', fontSize: '12px', textTransform: 'uppercase' } 
      });
    };

    const handleUpdatedAlert = (payload = {}) => {
      setAlerts((current) =>
        current
          .map((item) => (item.id === payload.id ? payload : item))
          .filter((item) => String(item.status || '').toLowerCase() !== 'resolved'),
      );
      setSelectedAlertId((current) => (current === payload.id ? '' : current));
    };

    socketService.on('new_sos', handleNewAlert);
    socketService.on('safety:alert:new', handleNewAlert);
    socketService.on('safety:alert:updated', handleUpdatedAlert);

    return () => {
      socketService.off('new_sos', handleNewAlert);
      socketService.off('safety:alert:new', handleNewAlert);
      socketService.off('safety:alert:updated', handleUpdatedAlert);
    };
  }, []);

  useEffect(() => {
    if (!selectedAlertId && alerts.length > 0) {
      setSelectedAlertId(alerts[0].id);
    }
  }, [alerts, selectedAlertId]);

  const handleResolve = async () => {
    if (!selectedAlert?.id) return;

    setIsResolving(true);
    try {
      await adminService.resolveSafetyAlert(selectedAlert.id, logDraft.trim());
      setAlerts((current) => current.filter((item) => item.id !== selectedAlert.id));
      setSelectedAlertId('');
      setLogDraft('');
      toast.success('INCIDENT RESOLVED & ARCHIVED');
    } catch (error) {
      console.error('Failed to resolve safety alert:', error);
      toast.error(error?.message || 'Resolution failed');
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-140px)] gap-4 md:gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="w-full max-w-sm shrink-0 flex flex-col space-y-6 overflow-y-auto no-scrollbar pb-10">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
             <div className="h-10 w-10 bg-rose-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-rose-100">
                <ShieldAlert size={20} strokeWidth={2} />
             </div>
             <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-none">SOS Terminal</h1>
                <p className="text-rose-600 font-bold text-[9px] mt-1.5 uppercase tracking-widest leading-none">
                  Safety Operations Center
                </p>
             </div>
          </div>
        </div>

        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Radio size={12} className="text-rose-500 animate-ping" /> Active Incidents ({alerts.length})
            </span>
            <button 
              onClick={loadAlerts} 
              className="text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-50 border border-slate-100 px-3 py-1 rounded-full hover:bg-slate-100 hover:text-slate-800 transition-colors"
            >
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-slate-100 bg-white p-4 md:p-8 text-center">
               <div className="w-6 h-6 border-2 border-slate-200 border-t-rose-600 rounded-full animate-spin mx-auto mb-3" />
               <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Syncing Encrypted Feed...</p>
            </div>
          ) : null}

          {!isLoading && alerts.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-white p-10 text-center shadow-sm">
              <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mx-auto mb-3">
                 <CheckCircle2 size={24} />
              </div>
              <p className="text-sm font-semibold text-slate-900 tracking-tight">System Status: All Clear</p>
              <p className="mt-1 text-[10px] text-slate-400 uppercase tracking-wider">No active distress signals</p>
            </div>
          ) : null}

          <div className="space-y-3">
            {alerts.map((alert) => (
              <SOSCard
                key={alert.id}
                alert={alert}
                isActive={selectedAlert?.id === alert.id}
                onClick={() => setSelectedAlertId(alert.id)}
              />
            ))}
          </div>
        </div>

        <div className="bg-slate-900 rounded-2xl p-5 text-white shadow-lg shadow-slate-900/10">
          <div className="flex items-center gap-2 mb-3">
             <LifeBuoy size={16} className="text-rose-500 shrink-0 animate-spin duration-3000" />
             <h5 className="text-[10px] font-bold uppercase tracking-wider">Response Protocol</h5>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed uppercase tracking-tight">
            Target response time: <span className="text-white font-bold underline decoration-rose-500 decoration-2">{"<"} 30s</span>. 
            Initiate communication immediately. If unresponsive for 120s, escalate to authorities.
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col space-y-6 overflow-y-auto no-scrollbar pr-2 pb-10">
        {selectedAlert ? (
          <>
            <div className="bg-white border border-rose-100/80 rounded-3xl p-4 md:p-6 flex items-center justify-between gap-4 md:gap-6 shadow-lg shadow-rose-50/50">
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 bg-rose-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-rose-600/20 relative border border-rose-50/50 shrink-0">
                  <ShieldAlert size={26} strokeWidth={2.5} className="animate-bounce" />
                  <div className="absolute -top-1.5 -right-1.5 px-2 py-0.5 bg-slate-900 text-white rounded-full text-[8px] font-bold tracking-wider">
                    PRIO-1
                  </div>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-1.5">
                    {getParticipantTitle(selectedAlert)} triggered SOS
                  </h2>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1 rounded-xl border border-slate-100/80">
                      <MapPin size={14} className="text-rose-500 shrink-0" />
                      <p className="text-[11px] font-medium text-slate-800">
                        {selectedAlert.locationLabel || selectedAlert.pickupAddress || 'Locating distress source...'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 bg-rose-50 px-2.5 py-1 rounded-xl border border-rose-100/50">
                       <Clock size={12} className="text-rose-600 shrink-0" />
                       <p className="text-[10px] font-semibold text-rose-700">{formatRelativeTime(selectedAlert.createdAt)}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => window.open('tel:100', '_self')}
                  className="bg-rose-600 text-white px-5 py-3 rounded-xl text-xs font-bold hover:bg-rose-700 transition-all shadow-md shadow-rose-600/10 flex items-center gap-2 active:scale-95 shrink-0"
                >
                  <PhoneCall size={14} strokeWidth={2.5} /> EMERGENCY (100)
                </button>
                <button
                  onClick={handleResolve}
                  disabled={isResolving}
                  className="bg-slate-900 text-white px-5 py-3 rounded-xl text-xs font-bold hover:bg-slate-800 transition-all flex items-center gap-2 disabled:opacity-60 active:scale-95 uppercase tracking-wider shrink-0"
                >
                  <CheckCircle2 size={14} /> {isResolving ? 'Archiving...' : 'Close Incident'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 flex-1 min-h-0">
              <div className="flex flex-col gap-4 md:gap-6">
                <div className="bg-white h-[260px] rounded-3xl border border-slate-100 shadow-sm overflow-hidden relative group shrink-0">
                  {loadError ? (
                    <div className="absolute inset-0 flex items-center justify-center p-4 md:p-8 text-center bg-slate-50">
                      <div>
                        <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center text-rose-500 mx-auto mb-3 shrink-0">
                           <MapPin size={24} />
                        </div>
                        <p className="text-[11px] font-bold text-rose-600 uppercase tracking-widest">Map Feed Offline</p>
                        <p className="text-xs text-slate-400 mt-1 uppercase tracking-tight">Encryption layer failed to decrypt spatial data</p>
                      </div>
                    </div>
                  ) : HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
                    <GoogleMap
                      mapContainerStyle={mapContainerStyle}
                      center={getMapCenter(selectedAlert)}
                      zoom={16}
                      options={{
                        streetViewControl: false,
                        mapTypeControl: false,
                        fullscreenControl: true,
                        styles: [
                          { "elementType": "geometry", "stylers": [{ "color": "#f5f5f5" }] },
                          { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
                          { "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
                          { "elementType": "labels.text.stroke", "stylers": [{ "color": "#f5f5f5" }] },
                          { "featureType": "administrative.land_parcel", "elementType": "labels.text.fill", "stylers": [{ "color": "#bdbdbd" }] },
                          { "featureType": "poi", "elementType": "geometry", "stylers": [{ "color": "#eeeeee" }] },
                          { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
                          { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#e5e5e5" }] },
                          { "featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] },
                          { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#ffffff" }] },
                          { "featureType": "road.arterial", "elementType": "labels.text.fill", "stylers": [{ "color": "#757575" }] },
                          { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#dadada" }] },
                          { "featureType": "road.highway", "elementType": "labels.text.fill", "stylers": [{ "color": "#616161" }] },
                          { "featureType": "road.local", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] },
                          { "featureType": "transit.line", "elementType": "geometry", "stylers": [{ "color": "#e5e5e5" }] },
                          { "featureType": "transit.station", "elementType": "geometry", "stylers": [{ "color": "#eeeeee" }] },
                          { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#c9c9c9" }] },
                          { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#9e9e9e" }] }
                        ]
                      }}
                    >
                      {selectedAlert?.location ? (
                        <MarkerF
                          position={getMapCenter(selectedAlert)}
                          title={`${getParticipantTitle(selectedAlert)} distress location`}
                          icon={{
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 12,
                            fillColor: '#E11D48',
                            fillOpacity: 1,
                            strokeColor: '#ffffff',
                            strokeWeight: 4,
                          }}
                        />
                      ) : null}
                    </GoogleMap>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center p-4 md:p-8 text-center bg-slate-50">
                      <div className="max-w-[280px]">
                        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-300 mx-auto mb-4 shrink-0">
                           <Globe size={24} />
                        </div>
                        <p className="text-[11px] font-bold text-slate-900 uppercase tracking-widest mb-2">Spatial Data Restricted</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-tight">Active API key required to visualize SOS coordinates in the terminal.</p>
                      </div>
                    </div>
                  )}

                  <div className="absolute top-4 right-4 flex flex-col gap-2">
                    <button className="bg-white/90 backdrop-blur-md p-2 rounded-xl shadow border border-white text-slate-800 hover:scale-105 transition-all">
                      <MoreHorizontal size={16} strokeWidth={2.5} />
                    </button>
                    <button className="bg-rose-600 p-2 rounded-xl shadow border border-rose-500 text-white hover:scale-110 transition-all animate-pulse">
                      <MapPin size={16} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 p-4 md:p-6 shadow-sm space-y-6 flex-1 overflow-y-auto no-scrollbar">
                  <div>
                    <h4 className="text-[11px] font-semibold text-slate-400 tracking-wider uppercase mb-3">Distress Context</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="bg-slate-50/60 p-3.5 rounded-xl border border-slate-100">
                        <p className="text-[10px] text-slate-400 font-medium mb-1">Subject</p>
                        <p className="font-semibold text-slate-900">{getParticipantTitle(selectedAlert)}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {selectedAlert.sourceApp === 'driver' ? selectedAlert.driverPhone || '--' : selectedAlert.riderPhone || '--'}
                        </p>
                      </div>
                      <div className="bg-slate-50/60 p-3.5 rounded-xl border border-slate-100">
                        <p className="text-[10px] text-slate-400 font-medium mb-1">Counterpart</p>
                        <p className="font-semibold text-slate-900">
                          {selectedAlert.sourceApp === 'driver' ? getRiderLabel(selectedAlert) : getDriverLabel(selectedAlert)}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {selectedAlert.sourceApp === 'driver' ? selectedAlert.riderPhone || '--' : selectedAlert.driverPhone || '--'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Class</p>
                      <p className="font-semibold text-slate-700 uppercase">{selectedAlert.serviceType || 'Standard'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Reference</p>
                      <p className="font-semibold text-slate-700 font-mono">{selectedAlert.tripCode || selectedAlert.id.slice(-8).toUpperCase()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-medium mb-0.5">Fleet Unit</p>
                      <p className="font-semibold text-slate-700 truncate">{selectedAlert.vehicleLabel || 'UNASSIGNED'}</p>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <h4 className="text-[11px] font-semibold text-slate-900 tracking-wider uppercase mb-3 flex items-center gap-2">
                      <AlertCircle size={13} className="text-indigo-600" /> Mandatory Response Checklist
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {[
                        { id: 'pcall', label: `Contact ${selectedAlert.sourceApp === 'driver' ? 'Driver' : 'Rider'}` },
                        { id: 'dcall', label: `Contact ${selectedAlert.sourceApp === 'driver' ? 'Rider' : 'Driver'}` },
                        { id: 'police', label: 'Alert Police' },
                        { id: 'nearby', label: 'Signal Fleet Units' },
                      ].map((step) => (
                        <button 
                          key={step.id} 
                          onClick={() => setChecklist((prev) => ({ ...prev, [step.id]: !prev[step.id] }))}
                          className={`flex items-center gap-3 w-full text-left px-3 py-2 rounded-xl transition-all border ${
                            checklist[step.id] 
                              ? 'bg-slate-50 border-slate-200/60' 
                              : 'bg-white border-slate-100 hover:bg-slate-50/60'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                            checklist[step.id] ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'
                          }`}>
                             {checklist[step.id] && <CheckCircle2 size={10} strokeWidth={3} />}
                          </div>
                          <span className={`text-[11px] font-medium truncate ${checklist[step.id] ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                            {step.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
                <div className="border-b border-slate-100 bg-slate-50/30 p-4">
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button
                      onClick={() => setActiveTab('chat')}
                      className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                        activeTab === 'chat' 
                          ? 'bg-white text-indigo-600 shadow-sm font-bold' 
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Live Support Chat
                    </button>
                    <button
                      onClick={() => setActiveTab('logs')}
                      className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                        activeTab === 'logs' 
                          ? 'bg-white text-indigo-600 shadow-sm font-bold' 
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Incident Log History
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 relative bg-[#f6f8fc]">
                  {activeTab === 'chat' ? (
                    chatParams ? (
                      <SupportChatPanel
                        mode="admin"
                        title={`Safety Chat with ${chatParams.peerName}`}
                        subtitle="SOS Distress Line"
                        surface="plain"
                        className="h-full"
                        showSidebar={false}
                        targetConversationKey={chatParams.conversationKey}
                        targetPeerRole={chatParams.peerRole}
                        targetPeerId={chatParams.peerId}
                        targetPeerName={chatParams.peerName}
                        targetPeerPhone={chatParams.peerPhone}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-4 md:p-6 text-center text-slate-400">
                        <div>
                          <LifeBuoy className="w-10 h-10 text-slate-300 mx-auto mb-3 animate-spin duration-3000" />
                          <p className="text-xs font-semibold uppercase tracking-wider">Resolving Secure Tunnel...</p>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="flex flex-col h-full bg-slate-900 text-white p-4 md:p-6 justify-between">
                      <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3 shrink-0">
                        <h4 className="text-[10px] font-semibold text-slate-400 tracking-widest uppercase flex items-center gap-2">
                          <History size={14} /> Incident Logs
                        </h4>
                        <div className="h-2 w-2 bg-rose-500 rounded-full animate-ping" />
                      </div>

                      <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 pr-1 text-xs mb-4">
                        {[
                          {
                            createdAt: selectedAlert.createdAt,
                            message: `DISTRESS SIGNAL RECEIVED VIA ${selectedAlert.sourceApp.toUpperCase()} GATEWAY.`,
                          },
                          ...(Array.isArray(selectedAlert.logs) ? selectedAlert.logs : []),
                        ].map((log, index) => (
                          <div key={`${log.createdAt || 'log'}-${index}`} className="flex gap-4 group">
                            <div className="flex flex-col items-center">
                               <div className={`h-2 w-2 rounded-full border ${index === 0 ? 'bg-rose-500 border-rose-300 animate-pulse' : 'bg-slate-700 border-slate-600'}`} />
                               {index < (selectedAlert.logs?.length || 0) && <div className="w-0.5 flex-1 bg-slate-800 my-1" />}
                            </div>
                            <div className="flex-1 min-w-0">
                               <p className="text-[9px] font-mono text-slate-500 leading-none mb-1">
                                 {formatDateTime(log.createdAt)}
                               </p>
                               <p className="text-[11px] font-mono text-slate-300 leading-normal uppercase">
                                 {log.message}
                               </p>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-auto relative shrink-0">
                        <input
                          type="text"
                          value={logDraft}
                          onChange={(event) => setLogDraft(event.target.value)}
                          placeholder="Add cryptographic entry..."
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-xs font-mono text-white placeholder:text-slate-600 focus:ring-1 focus:ring-rose-500/50 outline-none transition-all uppercase tracking-tight"
                        />
                        <button
                          onClick={handleResolve}
                          className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 bg-white rounded-lg text-slate-900 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all shadow-md active:scale-95"
                        >
                          <ArrowRight size={14} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center flex-col text-center p-20">
            <div className="w-24 h-24 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-200 mb-6 border border-slate-100 shadow-inner shrink-0 animate-pulse">
              <ShieldAlert size={48} strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight mb-2 uppercase">Standby Mode</h3>
              <p className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider max-w-[280px] leading-relaxed">
                Terminal is polling for emergency distress signals. Select an active incident to initiate SOP.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SafetyCenter;
