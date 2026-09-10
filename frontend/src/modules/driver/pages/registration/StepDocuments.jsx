import React, { useEffect, useMemo, useRef, useState } from 'react';
import { 
    AlertCircle,
    ArrowLeft, 
    Camera, 
    Car,
    CheckCircle2, 
    ChevronRight,
    Eye,
    FileText, 
    ImagePlus,
    ShieldCheck, 
    Trash2,
    UploadCloud,
    Users,
    X
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  clearDriverRegistrationSession,
  completeDriverOnboarding,
  getDriverDocumentTemplates,
  getDriverVehicleTypes,
  getStoredDriverRegistrationSession,
  persistDriverAuthSession,
  saveDriverDocuments,
  saveDriverRegistrationSession,
  saveDriverVehicle,
} from '../../services/registrationService';
import {
  flattenDriverDocumentFields,
  getDocumentPreviewUrl,
  normalizeDriverDocumentTemplates,
} from '../../utils/documentTemplates';

const unwrap = (response) => response?.data?.data || response?.data || response;

const normalizeDocument = (doc) => {
  if (!doc) {
    return null;
  }

  if (typeof doc === 'string') {
    return {
      previewUrl: doc,
      secureUrl: doc,
      uploaded: true,
    };
  }

  return {
    ...doc,
    previewUrl: getDocumentPreviewUrl(doc),
    uploaded: doc.uploaded ?? Boolean(getDocumentPreviewUrl(doc)),
    identifyNumber: String(doc.identifyNumber || doc.identify_number || doc.documentNumber || doc.document_number || '').trim(),
    expiryDate: String(doc.expiryDate || doc.expiry_date || doc.expiry || doc.expiresAt || '').trim(),
  };
};

const getDocumentIdentifyValue = (doc) =>
  String(doc?.identifyNumber || doc?.identify_number || doc?.documentNumber || doc?.document_number || '').trim();

const getDocumentExpiryValue = (doc) =>
  String(doc?.expiryDate || doc?.expiry_date || doc?.expiry || doc?.expiresAt || '').trim();

const buildTemplateMetaState = (templates = [], documents = {}) =>
  Object.fromEntries(
    templates.map((template) => {
      const templateFields = Array.isArray(template.fields) ? template.fields : [];
      const firstDocument = templateFields
        .map((field) => normalizeDocument(documents?.[field.key]))
        .find(Boolean);

      return [
        template.id,
        {
          identifyNumber: getDocumentIdentifyValue(firstDocument),
          expiryDate: getDocumentExpiryValue(firstDocument),
        },
      ];
    }),
  );

const formatMetaLabel = (value) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const normalizeSignupRole = (role) =>
  ['owner', 'vendor', 'super_fleet_owner', 'service_center'].includes(String(role || '').toLowerCase()) ? 'owner' : 'driver';

const matchesDocumentRole = (accountType, role) => {
  const rawAccountType = String(accountType || '').trim().toLowerCase();
  const normalizedAccountType = rawAccountType || 'individual';
  const normalizedRole = normalizeSignupRole(role);

  if (normalizedAccountType === 'both') {
    return true;
  }

  if (normalizedRole === 'owner') {
    if (!rawAccountType) {
      return true;
    }

    return ['fleet_drivers', 'owner', 'owners', 'fleet_owner', 'fleet_owners'].includes(normalizedAccountType);
  }

  return normalizedAccountType === 'individual';
};

const inferImageMeta = (file, dataUrl) => {
  const mimeMatch = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  const mimeType = String(file?.type || mimeMatch?.[1] || 'image/jpeg').toLowerCase();
  const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const originalName = String(file?.name || '').trim();

  return {
    mimeType,
    fileName: originalName || `capture-${Date.now()}.${extension}`,
  };
};

const StepDocuments = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/owner')
    ? '/taxi/owner'
    : '/taxi/driver';
  const session = {
    ...getStoredDriverRegistrationSession(),
    ...(location.state || {}),
  };
  const isHandlingHistoryNavigationRef = useRef(false);
  const normalizedRole = normalizeSignupRole(session.role);

  // Dynamic Admin Vehicle Catalog state
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [vehicleTypesLoading, setVehicleTypesLoading] = useState(false);
  const [vehicleData, setVehicleData] = useState({
    vehicleTypeId: session.vehicleTypeId || session.vehicle?.vehicleTypeId || '',
    make: session.make || session.vehicle?.make || '',
    model: session.model || session.vehicle?.model || '',
    year: session.year || session.vehicle?.year || '',
    number: session.number || session.vehicle?.number || '',
    color: session.color || session.vehicle?.color || '',
  });

  // Document Templates state
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [docs, setDocs] = useState(() =>
    Object.fromEntries(
      Object.entries(session.documents || {}).map(([key, value]) => [key, normalizeDocument(value)]),
    ),
  );
  const [documentMeta, setDocumentMeta] = useState({});
  const [uploading, setUploading] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState(null);

  // Load Active Vehicle Types from Admin Vehicle Catalog
  useEffect(() => {
    let active = true;
    const fetchVehicleTypes = async () => {
      if (normalizedRole === 'owner') return;
      setVehicleTypesLoading(true);
      try {
        const response = await getDriverVehicleTypes();
        const results = response?.data?.results || response?.data?.data?.results || response?.data || [];
        const list = Array.isArray(results) ? results : [];
        const activeTypes = list.filter((item) => item.active !== false && Number(item.status ?? 1) !== 0);
        if (active) {
          setVehicleTypes(activeTypes);
        }
      } catch (err) {
        console.error('Failed to fetch active vehicle types:', err);
      } finally {
        if (active) {
          setVehicleTypesLoading(false);
        }
      }
    };
    fetchVehicleTypes();
    return () => { active = false; };
  }, [normalizedRole]);

  // Load Document Templates
  useEffect(() => {
    const loadTemplates = async () => {
      setTemplatesLoading(true);

      try {
        const response = await getDriverDocumentTemplates(normalizedRole);
        const results = response?.data?.data?.results || response?.data?.results || [];
        setTemplates(normalizeDriverDocumentTemplates(results));
      } catch {
        setTemplates(normalizeDriverDocumentTemplates([]));
      } finally {
        setTemplatesLoading(false);
      }
    };

    loadTemplates();
  }, [normalizedRole]);

  const documentTemplates = useMemo(
    () =>
      normalizeDriverDocumentTemplates(templates).filter((template) =>
        matchesDocumentRole(template.account_type, normalizedRole),
      ),
    [normalizedRole, templates],
  );
  const uploadFields = useMemo(
    () => flattenDriverDocumentFields(documentTemplates),
    [documentTemplates],
  );
  const requiredUploadFields = useMemo(
    () => uploadFields.filter((item) => Boolean(item.isRequired)),
    [uploadFields],
  );

  useEffect(() => {
    setDocumentMeta((current) => ({
      ...buildTemplateMetaState(documentTemplates, docs),
      ...current,
    }));
  }, [documentTemplates, docs]);

  useEffect(() => {
    saveDriverRegistrationSession({
      ...getStoredDriverRegistrationSession(),
      ...session,
      ...vehicleData,
      documents: docs,
      documentMeta,
    });
  }, [docs, documentMeta, vehicleData]);

  const buildCurrentSession = () => saveDriverRegistrationSession({
    ...getStoredDriverRegistrationSession(),
    ...session,
    ...vehicleData,
    documents: docs,
    documentMeta,
  });

  const handleBackNavigation = () => {
    const shouldLeave = window.confirm(
      'Go back to vehicle setup? Your uploaded details and documents will stay saved.',
    );

    if (!shouldLeave) {
      return false;
    }

    isHandlingHistoryNavigationRef.current = true;
    navigate(`${routePrefix}/step-vehicle`, { state: buildCurrentSession(), replace: true });
    return true;
  };

  useEffect(() => {
    window.history.pushState({ onboardingStep: 'documents' }, '', window.location.href);

    const handlePopState = () => {
      if (isHandlingHistoryNavigationRef.current) {
        return;
      }

      const didLeave = handleBackNavigation();
      if (!didLeave) {
        window.history.pushState({ onboardingStep: 'documents' }, '', window.location.href);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [routePrefix, docs, vehicleData]);

  const applyTemplateMetaToDocuments = (templateId, templateDocuments = {}, metaState = documentMeta) => {
    const template = documentTemplates.find((item) => item.id === templateId);
    if (!template) {
      return templateDocuments;
    }

    const currentMeta = metaState[templateId] || {};
    const identifyNumber = currentMeta.identifyNumber || '';
    const expiryDate = currentMeta.expiryDate || '';

    return Object.fromEntries(
      Object.entries(templateDocuments).map(([key, doc]) => [
        key,
        doc
          ? {
              ...doc,
              ...(template.has_identify_number && identifyNumber ? { identifyNumber, identify_number: identifyNumber } : {}),
              ...(template.has_expiry_date && expiryDate ? { expiryDate, expiry_date: expiryDate } : {}),
            }
          : null,
      ]),
    );
  };

  const handleMetaChange = (templateId, fieldName, value) => {
    const template = documentTemplates.find((item) => item.id === templateId);
    const templateFields = Array.isArray(template?.fields) ? template.fields : [];
    const nextMeta = {
      ...(documentMeta[templateId] || {}),
      [fieldName]: value,
    };

    setDocumentMeta((prev) => ({
      ...prev,
      [templateId]: nextMeta,
    }));

    setDocs((current) => {
      const nextDocuments = { ...current };
      for (const field of templateFields) {
        if (!nextDocuments[field.key]) {
          continue;
        }

        nextDocuments[field.key] = applyTemplateMetaToDocuments(
          templateId,
          { [field.key]: nextDocuments[field.key] },
          { ...documentMeta, [templateId]: nextMeta },
        )[field.key];
      }
      return nextDocuments;
    });
  };

  const handleFileChange = async (templateId, key, event) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setUploading(key);
    setError('');

    try {
      const dataUrl = await fileToDataUrl(file);
      if (!String(dataUrl || '').startsWith('data:image/')) {
        throw new Error('Please upload an image file');
      }

      const { fileName, mimeType } = inferImageMeta(file, dataUrl);

      setDocs((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          previewUrl: dataUrl,
          fileName,
          mimeType,
          uploaded: false,
          uploading: true,
        },
      }));

      const response = await saveDriverDocuments({
        registrationId: session.registrationId,
        phone: session.phone,
        documents: {
          [key]: {
            dataUrl,
            fileName,
            mimeType,
            identifyNumber: documentMeta[templateId]?.identifyNumber || '',
            expiryDate: documentMeta[templateId]?.expiryDate || '',
          },
        },
      });
      const payload = unwrap(response);

      const uploadedDoc = payload?.documents?.[key] || payload?.session?.documents?.[key];
      const nextDoc = normalizeDocument(uploadedDoc) || {
        previewUrl: dataUrl,
        secureUrl: dataUrl,
        fileName,
        mimeType,
        uploaded: true,
      };
      const nextDocWithMeta = applyTemplateMetaToDocuments(templateId, { [key]: nextDoc })[key];

      setDocs((prev) => ({
        ...prev,
        [key]: nextDocWithMeta,
      }));

      const storedSession = getStoredDriverRegistrationSession();
      saveDriverRegistrationSession({
        ...storedSession,
        ...session,
        ...vehicleData,
        documents: {
          ...(storedSession.documents || {}),
          [key]: nextDocWithMeta,
        },
      });
    } catch (uploadError) {
      setError(uploadError?.message || 'Unable to upload document');
      setDocs((prev) => ({
        ...prev,
        [key]: normalizeDocument(session.documents?.[key]),
      }));
    } finally {
      setUploading(null);
    }
  };

  const handleRemoveDocument = (key) => {
    setDocs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const stored = getStoredDriverRegistrationSession();
    const nextDocs = { ...(stored.documents || {}) };
    delete nextDocs[key];
    saveDriverRegistrationSession({
      ...stored,
      ...session,
      ...vehicleData,
      documents: nextDocs,
    });
  };

  const isVehicleValid = normalizedRole === 'owner' || Boolean(
    vehicleData.vehicleTypeId && String(vehicleData.number || '').trim()
  );

  const isComplete =
    isVehicleValid &&
    requiredUploadFields.every((item) => Boolean(docs[item.key]?.uploaded || docs[item.key]?.secureUrl)) &&
    documentTemplates.every((template) => {
      if (!template.is_required) {
        return true;
      }

      const meta = documentMeta[template.id] || {};
      const hasIdentifyNumber = !template.has_identify_number || Boolean(String(meta.identifyNumber || '').trim());
      const hasExpiryDate = !template.has_expiry_date || Boolean(String(meta.expiryDate || '').trim());
      return hasIdentifyNumber && hasExpiryDate;
    }) &&
    !uploading &&
    !templatesLoading;

  const handleSubmit = async () => {
    if (normalizedRole !== 'owner' && !vehicleData.vehicleTypeId) {
      setError('Please select a vehicle type from the catalog');
      return;
    }

    if (normalizedRole !== 'owner' && !String(vehicleData.number || '').trim()) {
      setError('Please enter your vehicle plate number');
      return;
    }

    if (!isComplete) {
      setError(uploading ? 'Please wait for the current upload to finish' : 'Please upload every required document image');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Save Vehicle Details for driver role
      if (normalizedRole !== 'owner') {
        await saveDriverVehicle({
          registrationId: session.registrationId,
          phone: session.phone,
          locationId: session.locationId || '',
          vehicleTypeId: vehicleData.vehicleTypeId,
          make: vehicleData.make,
          model: vehicleData.model,
          year: vehicleData.year,
          number: String(vehicleData.number).replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
          color: vehicleData.color,
        });
      }

      // 2. Prepare & Submit Final Documents
      const submittedDocuments = Object.fromEntries(
        Object.entries(docs).filter(([, value]) => Boolean(value?.uploaded || value?.secureUrl)),
      );
      const submittedDocumentsWithMeta = { ...submittedDocuments };

      for (const template of documentTemplates) {
        const templateFields = Array.isArray(template.fields) ? template.fields : [];
        const templateDocuments = Object.fromEntries(
          templateFields
            .filter((field) => submittedDocumentsWithMeta[field.key])
            .map((field) => [field.key, submittedDocumentsWithMeta[field.key]]),
        );

        if (Object.keys(templateDocuments).length === 0) {
          continue;
        }

        Object.assign(
          submittedDocumentsWithMeta,
          applyTemplateMetaToDocuments(template.id, templateDocuments),
        );
      }

      const completeResponse = await completeDriverOnboarding({
        registrationId: session.registrationId,
        phone: session.phone,
        documents: submittedDocumentsWithMeta,
      });
      const payload = unwrap(completeResponse);

      const token = payload?.token;
      if (token) {
        persistDriverAuthSession({ token, role: normalizeSignupRole(session.role) });
      }

      saveDriverRegistrationSession({
        ...session,
        ...vehicleData,
        documents: docs,
        completedRegistration: payload || null,
      });
      clearDriverRegistrationSession();

      navigate(`${routePrefix}/registration-status`, {
        state: {
          ...session,
          ...vehicleData,
          documents: docs,
          completedRegistration: payload || null,
        },
      });
    } catch (submitError) {
      setError(submitError?.message || 'Unable to complete registration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
        className="min-h-screen bg-[linear-gradient(180deg,#f6efe4_0%,#fcfaf6_28%,#ffffff_100%)] px-5 pb-32 pt-8 select-none overflow-x-hidden"
        style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
    >
      <main className="mx-auto max-w-sm space-y-6">
        <header className="space-y-5">
            <div className="flex items-center justify-between">
                <button
                    onClick={handleBackNavigation}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-slate-900 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur-sm transition-transform active:scale-95"
                >
                    <ArrowLeft size={18} strokeWidth={2.5} />
                </button>
                <div className="rounded-full bg-slate-900/5 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500 border border-slate-900/5">
                    Step 4 of 4
                </div>
            </div>

            <section className="space-y-3">
                <div className="flex items-center gap-3">
                     <div className="flex h-11 w-11 items-center justify-center rounded-[1.25rem] bg-slate-900 text-white shadow-xl shadow-slate-900/10">
                        <ShieldCheck size={22} strokeWidth={2.5} />
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 opacity-60">
                        Verification & Vehicle
                    </span>
                </div>
                <h1 className="font-['Poppins'] text-[44px] font-black leading-[1] tracking-[-0.04em] text-slate-900">
                    Vehicle & <span className="text-slate-400">KYC Vault</span>
                </h1>
                <p className="text-[15px] leading-relaxed text-slate-500 font-bold opacity-80 max-w-[28ch]">
                    Select your vehicle type, enter details, and upload verification documents.
                </p>
            </section>
        </header>

        {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 shadow-[0_10px_30px_rgba(244,63,94,0.08)]">
                {error}
            </div>
        )}

        {/* PHASE 2 — DYNAMIC VEHICLE SELECTION (From Admin Vehicle Catalog) */}
        {normalizedRole !== 'owner' && (
          <section className="space-y-4 rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
            <div className="space-y-1 px-1">
              <div className="flex items-center gap-2">
                <Car size={20} className="text-slate-900" />
                <h2 className="text-lg font-black tracking-tight text-slate-900">Vehicle Type</h2>
              </div>
              <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest opacity-60">
                Select your vehicle category from Admin catalog
              </p>
            </div>

            {vehicleTypesLoading ? (
              <div className="p-8 text-center space-y-3">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto" />
                <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Loading vehicle catalog...</p>
              </div>
            ) : vehicleTypes.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs font-bold bg-slate-50 rounded-2xl">
                No active vehicle types available
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {vehicleTypes.map((v) => {
                  const isSelected = String(vehicleData.vehicleTypeId) === String(v.id || v._id);
                  const iconUrl = v.image || v.map_icon || v.icon;
                  return (
                    <button
                      key={v.id || v._id}
                      type="button"
                      onClick={() => setVehicleData((prev) => ({ ...prev, vehicleTypeId: String(v.id || v._id) }))}
                      className={`flex items-center gap-4 p-4 rounded-[1.8rem] border-2 transition-all text-left relative overflow-hidden ${
                        isSelected
                          ? 'bg-slate-900 border-slate-900 text-white shadow-xl shadow-slate-900/10'
                          : 'bg-slate-50 border-slate-50 text-slate-800 hover:border-slate-200 hover:bg-white'
                      }`}
                    >
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden ${
                        isSelected ? 'bg-white/10' : 'bg-white shadow-sm border border-slate-100'
                      }`}>
                        {iconUrl ? (
                          <img src={iconUrl} alt={v.name} className="w-10 h-10 object-contain" />
                        ) : (
                          <Car size={26} className={isSelected ? 'text-white' : 'text-slate-500'} />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-black text-sm tracking-tight truncate">{v.name}</h3>
                          <div className={`flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-slate-200/60 text-slate-600'
                          }`}>
                            <Users size={12} />
                            <span>{v.capacity || 4} seats</span>
                          </div>
                        </div>
                        <p className={`text-[11px] font-bold leading-snug line-clamp-2 ${
                          isSelected ? 'text-slate-300' : 'text-slate-400'
                        }`}>
                          {v.short_description || v.description || 'Active catalog vehicle type'}
                        </p>
                      </div>

                      {isSelected && (
                        <div className="absolute top-3 right-3">
                          <CheckCircle2 size={16} className="text-white" strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* PHASE 3 — VEHICLE DETAILS SECTION */}
        {normalizedRole !== 'owner' && (
          <section className="space-y-4 rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
            <div className="space-y-1 px-1">
              <h2 className="text-lg font-black tracking-tight text-slate-900">Vehicle Specifications</h2>
              <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest opacity-60">
                Enter your vehicle plate number and details
              </p>
            </div>

            <div className="space-y-4">
              {/* Plate Number */}
              <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">
                  Plate Number *
                </label>
                <input
                  type="text"
                  value={vehicleData.number}
                  onChange={(e) => setVehicleData((prev) => ({ ...prev, number: e.target.value.toUpperCase() }))}
                  placeholder="e.g. DL1RT1234, DL1AB2345, or MH12AB1234"
                  className="w-full border-none bg-transparent p-0 text-base font-black text-slate-900 outline-none focus:ring-0 placeholder:text-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Brand / Make */}
                <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                  <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">
                    Brand / Make
                  </label>
                  <input
                    type="text"
                    value={vehicleData.make}
                    onChange={(e) => setVehicleData((prev) => ({ ...prev, make: e.target.value }))}
                    placeholder="e.g. Maruti Suzuki"
                    className="w-full border-none bg-transparent p-0 text-sm font-black text-slate-900 outline-none focus:ring-0 placeholder:text-slate-300"
                  />
                </div>

                {/* Model */}
                <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                  <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">
                    Model
                  </label>
                  <input
                    type="text"
                    value={vehicleData.model}
                    onChange={(e) => setVehicleData((prev) => ({ ...prev, model: e.target.value }))}
                    placeholder="Swift, Dzire"
                    className="w-full border-none bg-transparent p-0 text-sm font-black text-slate-900 outline-none focus:ring-0 placeholder:text-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Year */}
                <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                  <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">
                    Year
                  </label>
                  <input
                    type="text"
                    value={vehicleData.year}
                    onChange={(e) => setVehicleData((prev) => ({ ...prev, year: e.target.value }))}
                    placeholder="2022"
                    className="w-full border-none bg-transparent p-0 text-sm font-black text-slate-900 outline-none focus:ring-0 placeholder:text-slate-300"
                  />
                </div>

                {/* Exterior Color */}
                <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                  <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">
                    Exterior Color
                  </label>
                  <input
                    type="text"
                    value={vehicleData.color}
                    onChange={(e) => setVehicleData((prev) => ({ ...prev, color: e.target.value }))}
                    placeholder="White, Black"
                    className="w-full border-none bg-transparent p-0 text-sm font-black text-slate-900 outline-none focus:ring-0 placeholder:text-slate-300"
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* PHASE 4 — DRIVER DOCUMENTS (KYC Vault Cards) */}
        <div className="space-y-6">
          {templatesLoading ? (
            <div className="bg-white rounded-[2.5rem] p-12 text-center space-y-4 shadow-[0_10px_40px_rgba(0,0,0,0.04)] border border-slate-100">
              <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto animate-pulse">
                <FileText size={20} className="text-slate-300" />
              </div>
              <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest">Loading document checklist...</p>
            </div>
          ) : (
            documentTemplates.map((template) => (
              <section key={template.id} className="space-y-5 rounded-[2.5rem] border border-slate-100 bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.04)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <h3 className="text-lg font-black tracking-tight text-slate-900">{template.name}</h3>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest opacity-60">
                           {template.fields.length > 1 ? 'Multiple Sides' : 'Single Side'}
                        </span>
                        <div className="w-1 h-1 rounded-full bg-slate-200" />
                        <span className={`text-[10px] font-black uppercase tracking-widest ${template.is_required ? 'text-emerald-600' : 'text-slate-400 opacity-60'}`}>
                          {template.is_required ? 'Mandatory' : 'Optional'}
                        </span>
                    </div>
                  </div>
                  <div className="rounded-full bg-slate-900/5 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500 border border-slate-900/5">
                    {template.account_type || 'individual'}
                  </div>
                </div>

                <div className="space-y-6">
                  {template.fields.map((field) => {
                    const document = docs[field.key];
                    const isUploading = uploading === field.key;
                    const isRequired = Boolean(field.required ?? field.isRequired);

                    return (
                      <div key={field.key} className="space-y-3">
                        <div className="flex items-center justify-between gap-2 px-1">
                          <label className="block text-[11px] font-black uppercase tracking-widest text-slate-400 opacity-80">{field.label}</label>
                          <span className={`text-[9px] font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded-md ${isRequired ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
                            {isRequired ? 'Required' : 'Optional'}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-1 gap-3">
                            <div
                                className={`relative min-h-[160px] rounded-[1.8rem] border-2 transition-all overflow-hidden flex flex-col items-center justify-center gap-2 ${
                                    document?.previewUrl
                                        ? 'border-emerald-500/20 bg-emerald-50/10'
                                        : 'border-dashed border-slate-100 bg-slate-50 hover:border-slate-200'
                                }`}
                            >
                                {isUploading ? (
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Uploading...</span>
                                    </div>
                                ) : document?.previewUrl ? (
                                    <>
                                        <img src={document.previewUrl} alt={field.label} className="absolute inset-0 h-full w-full object-cover" />
                                        <div className="absolute inset-0 bg-black/10" />
                                        <div className="absolute bottom-4 right-4 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-xl border-2 border-white">
                                            <CheckCircle2 size={16} strokeWidth={3} />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-12 h-12 rounded-2xl bg-white text-slate-400 flex items-center justify-center shadow-sm border border-slate-100">
                                            <UploadCloud size={20} />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Tap to upload photo</p>
                                        </div>
                                        <div className="absolute top-4 right-4 w-8 h-8 rounded-xl bg-slate-900/5 flex items-center justify-center">
                                            <Camera size={14} className="text-slate-400" />
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Document Actions: Upload / Replace / Preview / Remove */}
                            {document?.previewUrl ? (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => setPreviewImageUrl(document.previewUrl)}
                                  className="flex-1 flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-slate-700 text-[11px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all active:scale-[0.98]"
                                >
                                  <Eye size={15} />
                                  Preview
                                </button>
                                <label className="flex-1 relative flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-900 bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-black cursor-pointer transition-all active:scale-[0.98]">
                                  <Camera size={15} />
                                  Replace
                                  <input
                                    type="file"
                                    accept="image/*"
                                    disabled={isUploading}
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    aria-label={`Replace ${field.label}`}
                                    onChange={(event) => handleFileChange(template.id, field.key, event)}
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveDocument(field.key)}
                                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100 shrink-0 transition-all active:scale-[0.98]"
                                  title="Remove Document"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                  <label className={`flex-1 relative flex h-12 items-center justify-center gap-2 text-center rounded-2xl border text-[11px] font-black uppercase tracking-widest transition-all ${
                                      isUploading
                                      ? 'cursor-not-allowed border-slate-50 bg-slate-50 text-slate-300'
                                      : 'cursor-pointer border-slate-100 bg-white text-slate-600 hover:bg-slate-50 active:scale-[0.98]'
                                  }`}>
                                      <ImagePlus size={16} />
                                      Gallery
                                      <input
                                      type="file"
                                      accept="image/*"
                                      disabled={isUploading}
                                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                      aria-label={`Upload ${field.label} from gallery`}
                                      onChange={(event) => handleFileChange(template.id, field.key, event)}
                                      />
                                  </label>
                                  <label className={`flex-1 relative flex h-12 items-center justify-center gap-2 text-center rounded-2xl border text-[11px] font-black uppercase tracking-widest transition-all ${
                                      isUploading
                                      ? 'cursor-not-allowed border-slate-50 bg-slate-50 text-slate-300'
                                      : 'cursor-pointer border-slate-900 bg-slate-900 text-white hover:bg-black shadow-lg shadow-slate-900/10 active:scale-[0.98]'
                                  }`}>
                                      <Camera size={16} />
                                      Camera
                                      <input
                                      type="file"
                                      accept="image/*"
                                      capture="environment"
                                      disabled={isUploading}
                                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                      aria-label={`Capture ${field.label} from camera`}
                                      onChange={(event) => handleFileChange(template.id, field.key, event)}
                                      />
                                  </label>
                              </div>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(template.has_identify_number || template.has_expiry_date) ? (
                  <div className="space-y-4 pt-2">
                    {template.has_identify_number ? (
                      <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                        <div className="flex items-center gap-4">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm group-focus-within:bg-slate-900 group-focus-within:text-white transition-all">
                                <FileText size={20} strokeWidth={2.5} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-0.5">
                                <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">
                                    {formatMetaLabel(template.identify_number_key) || `${template.name} Number`}
                                </label>
                                <input
                                    type="text"
                                    value={documentMeta[template.id]?.identifyNumber || ''}
                                    onChange={(event) => handleMetaChange(template.id, 'identifyNumber', event.target.value.trim().toUpperCase())}
                                    placeholder={`Enter ${formatMetaLabel(template.identify_number_key) || 'Number'}`}
                                    className="w-full border-none bg-transparent p-0 text-lg font-black text-slate-900 outline-none focus:ring-0 placeholder:text-slate-200"
                                />
                            </div>
                        </div>
                      </div>
                    ) : null}

                    {template.has_expiry_date ? (
                      <div className="group rounded-[1.8rem] border-2 transition-all p-4 border-slate-50 bg-slate-50 focus-within:border-slate-900/10 focus-within:bg-white focus-within:shadow-xl focus-within:shadow-slate-900/5">
                        <div className="flex items-center gap-4">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm group-focus-within:bg-slate-900 group-focus-within:text-white transition-all">
                                <AlertCircle size={20} strokeWidth={2.5} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-0.5">
                                <label className="block text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 opacity-70">
                                    Expiry Date
                                </label>
                                <input
                                    type="date"
                                    value={documentMeta[template.id]?.expiryDate || ''}
                                    onChange={(event) => handleMetaChange(template.id, 'expiryDate', event.target.value)}
                                    className="w-full border-none bg-transparent p-0 text-lg font-black text-slate-900 outline-none focus:ring-0"
                                />
                            </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ))
          )}
        </div>

        <div className="bg-white/40 backdrop-blur-sm p-5 rounded-[2rem] flex gap-4 mt-6 border border-white/50 shadow-sm">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
            <AlertCircle size={20} className="text-amber-600" />
          </div>
          <p className="text-[12px] font-black text-amber-900/60 leading-relaxed uppercase tracking-tight">
            Ensure all vehicle details are accurate and uploaded document photos are well-lit and clear before submitting.
          </p>
        </div>

        {/* REVIEW & SUBMIT BUTTON */}
        <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent z-40">
            <div className="mx-auto max-w-sm">
                <motion.button
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSubmit}
                    disabled={loading || !isComplete}
                    className={`group flex h-16 w-full items-center justify-center gap-3 rounded-[1.8rem] text-[15px] font-black tracking-tight transition-all relative overflow-hidden ${
                        isComplete
                            ? 'bg-slate-900 text-white shadow-[0_20px_40px_rgba(0,0,0,0.2)] active:bg-black'
                            : 'pointer-events-none bg-slate-200 text-slate-400 shadow-none'
                    }`}
                >
                    {loading ? (
                        <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            <span className="relative z-10 uppercase tracking-widest">Review & Submit</span>
                            <ChevronRight size={18} strokeWidth={3} className="relative z-10 group-hover:translate-x-1 transition-transform" />
                        </>
                    )}
                </motion.button>
            </div>
        </div>

        {/* IMAGE PREVIEW MODAL */}
        {previewImageUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setPreviewImageUrl(null)}>
            <div className="relative max-w-lg w-full max-h-[85vh] bg-slate-900 rounded-[2rem] overflow-hidden p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setPreviewImageUrl(null)}
                className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black transition-colors"
                title="Close preview"
              >
                <X size={20} />
              </button>
              <img src={previewImageUrl} alt="Document Preview" className="w-full h-full object-contain rounded-[1.5rem]" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default StepDocuments;
