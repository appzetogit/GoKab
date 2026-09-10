import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Filter,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  Eye,
  Edit,
  Power,
  Calendar,
  Layers,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';

const Motion = motion;
const LIST_PATH = '/admin/promotions/advertisements';
const CREATE_PATH = '/admin/promotions/advertisements/create';

const createInitialFormData = () => ({
  title: '',
  description: '',
  type: 'FULL',
  position: 'HOME_TOP',
  mediaType: 'IMAGE',
  actionType: 'NONE',
  actionValue: '',
  displayOrder: 0,
  status: 'ACTIVE',
  startDate: '',
  endDate: '',
  file: null,
});

const Advertisements = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isCreateRoute = location.pathname === CREATE_PATH;

  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState(createInitialFormData());
  const [editingAd, setEditingAd] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [previewModalAd, setPreviewModalAd] = useState(null);

  const token = localStorage.getItem('adminToken') || '';
  const baseUrl = globalThis.__LEGACY_BACKEND_ORIGIN__ + '/api/v1/admin/advertisements';

  const fetchAds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(baseUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAds(data.data || []);
        } else {
          setAds([]);
        }
      } else {
        setAds([]);
      }
    } catch (error) {
      console.error('Error fetching advertisements:', error);
      setAds([]);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token]);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  useEffect(() => {
    if (!isCreateRoute && !editingAd) {
      setFormData(createInitialFormData());
      setFilePreview(null);
    }
  }, [isCreateRoute, editingAd]);

  const handleFileChange = (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setFormData((current) => ({
      ...current,
      file: selectedFile,
    }));
    setFilePreview(URL.createObjectURL(selectedFile));
  };

  const handleSave = async (event) => {
    event.preventDefault();

    if (!formData.title.trim()) {
      alert('Please enter a title');
      return;
    }

    if (!editingAd && !formData.file) {
      alert('Please upload an advertisement media file');
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title', formData.title.trim());
      fd.append('description', formData.description.trim());
      fd.append('type', formData.type);
      fd.append('position', formData.position);
      fd.append('mediaType', formData.mediaType);
      fd.append('actionType', formData.actionType);
      fd.append('actionValue', formData.actionValue.trim());
      fd.append('displayOrder', formData.displayOrder);
      fd.append('status', formData.status);
      if (formData.startDate) fd.append('startDate', formData.startDate);
      if (formData.endDate) fd.append('endDate', formData.endDate);
      
      if (formData.file) {
        fd.append('file', formData.file);
      }

      const url = editingAd ? `${baseUrl}/${editingAd._id}` : baseUrl;
      const method = editingAd ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: fd,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          alert(editingAd ? 'Advertisement updated successfully!' : 'Advertisement created successfully!');
          setEditingAd(null);
          navigate(LIST_PATH);
          fetchAds();
        } else {
          alert(data.message || 'Failed to save advertisement');
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.message || 'Failed to save advertisement');
      }
    } catch (error) {
      console.error('Error saving ad:', error);
      alert('Network error while saving advertisement');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this advertisement?')) return;

    try {
      const res = await fetch(`${baseUrl}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          alert('Advertisement deleted successfully!');
          fetchAds();
        } else {
          alert(data.message || 'Failed to delete advertisement');
        }
      } else {
        alert('Failed to delete advertisement');
      }
    } catch (error) {
      console.error('Error deleting ad:', error);
      alert('Network error while deleting advertisement');
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      const res = await fetch(`${baseUrl}/${id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          fetchAds();
        } else {
          alert(data.message || 'Failed to update status');
        }
      } else {
        alert('Failed to update status');
      }
    } catch (error) {
      console.error('Error toggling status:', error);
    }
  };

  const startEdit = (ad) => {
    setEditingAd(ad);
    setFormData({
      title: ad.title || '',
      description: ad.description || '',
      type: ad.type || 'FULL',
      position: ad.position || 'HOME_TOP',
      mediaType: ad.mediaType || 'IMAGE',
      actionType: ad.actionType || 'NONE',
      actionValue: ad.actionValue || '',
      displayOrder: ad.displayOrder || 0,
      status: ad.status || 'ACTIVE',
      startDate: ad.startDate ? new Date(ad.startDate).toISOString().split('T')[0] : '',
      endDate: ad.endDate ? new Date(ad.endDate).toISOString().split('T')[0] : '',
      file: null,
    });
    setFilePreview(ad.media?.url || '');
    navigate(CREATE_PATH);
  };

  const cancelEdit = () => {
    setEditingAd(null);
    setFormData(createInitialFormData());
    setFilePreview(null);
    navigate(LIST_PATH);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Promotion Management</h1>
              <p className="text-slate-400 text-sm mt-0.5">Manage active promotional banners, video ads, and animated GIFs</p>
            </div>
          </div>
          
          {!isCreateRoute && (
            <button
              onClick={() => navigate(CREATE_PATH)}
              className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 active:scale-95 transition text-slate-950 font-semibold px-4 py-2.5 rounded-xl text-sm"
            >
              <Plus className="w-4 h-4 stroke-[3]" /> Add Advertisement
            </button>
          )}
        </div>

        <AnimatePresence mode="wait">
          {isCreateRoute ? (
            /* Create / Edit Form */
            <Motion.div
              key="form"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6"
            >
              {/* Form Input Section */}
              <div className="lg:col-span-2 bg-slate-900/60 backdrop-blur border border-slate-850 rounded-2xl p-4 md:p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Layers className="w-5 h-5 text-emerald-400" />
                    {editingAd ? 'Edit Advertisement' : 'Create New Advertisement'}
                  </h2>
                  <button
                    onClick={cancelEdit}
                    className="flex items-center gap-1.5 text-slate-400 hover:text-white transition text-sm font-medium"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back to List
                  </button>
                </div>

                <form onSubmit={handleSave} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    
                    {/* Title */}
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Title *</label>
                      <input
                        type="text"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        placeholder="e.g. 50% Off First Booking"
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition placeholder-slate-600"
                        required
                      />
                    </div>

                    {/* Advertisement Type */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Ad Type *</label>
                      <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition cursor-pointer"
                      >
                        <option value="FULL">FULL (Top Page)</option>
                        <option value="CAROUSEL">CAROUSEL (Bottom Section)</option>
                      </select>
                    </div>

                    {/* Position */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Position *</label>
                      <select
                        value={formData.position}
                        onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition cursor-pointer"
                      >
                        <option value="HOME_TOP">HOME_TOP</option>
                        <option value="HOME_BOTTOM">HOME_BOTTOM</option>
                      </select>
                    </div>

                    {/* Media Type */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Media Type *</label>
                      <select
                        value={formData.mediaType}
                        onChange={(e) => setFormData({ ...formData, mediaType: e.target.value })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition cursor-pointer"
                      >
                        <option value="IMAGE">IMAGE</option>
                        <option value="VIDEO">VIDEO</option>
                        <option value="GIF">GIF</option>
                      </select>
                    </div>

                    {/* Display Order */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Display Order</label>
                      <input
                        type="number"
                        value={formData.displayOrder}
                        onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 0 })}
                        placeholder="0"
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition"
                      />
                    </div>

                    {/* Start Date */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Start Date</label>
                      <input
                        type="date"
                        value={formData.startDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition"
                      />
                    </div>

                    {/* End Date */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">End Date</label>
                      <input
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition"
                      />
                    </div>

                    {/* Action Type */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Action Type</label>
                      <select
                        value={formData.actionType}
                        onChange={(e) => setFormData({ ...formData, actionType: e.target.value })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition cursor-pointer"
                      >
                        <option value="NONE">NONE</option>
                        <option value="URL">URL Link</option>
                        <option value="SCREEN">App Screen Route</option>
                      </select>
                    </div>

                    {/* Action Value */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Action Value</label>
                      <input
                        type="text"
                        value={formData.actionValue}
                        onChange={(e) => setFormData({ ...formData, actionValue: e.target.value })}
                        placeholder={formData.actionType === 'URL' ? 'https://example.com' : 'deep-link://home'}
                        disabled={formData.actionType === 'NONE'}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition disabled:opacity-40"
                      />
                    </div>

                    {/* Description */}
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Description</label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Internal notes or descriptive text for the promotion"
                        rows={3}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition resize-none placeholder-slate-600"
                      />
                    </div>

                    {/* Status */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Status</label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                        className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:border-emerald-500/50 transition cursor-pointer"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                      </select>
                    </div>

                  </div>

                  <div className="border-t border-slate-800 pt-5 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 active:scale-95 transition text-slate-950 px-5 py-3 rounded-xl font-bold text-sm disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" /> Save Advertisement
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="bg-slate-850 hover:bg-slate-800 transition text-slate-300 px-5 py-3 rounded-xl font-bold text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>

              {/* Upload & Preview Sidebar */}
              <div className="bg-slate-900/60 border border-slate-850 rounded-2xl p-4 md:p-6 space-y-6 flex flex-col justify-between">
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800 pb-2">Media Upload</h3>
                  
                  {/* File Dropzone */}
                  <div className="relative group border-2 border-dashed border-slate-800 hover:border-emerald-500/40 rounded-2xl p-4 md:p-6 text-center cursor-pointer transition bg-slate-950">
                    <input
                      type="file"
                      onChange={handleFileChange}
                      accept={formData.mediaType === 'IMAGE' ? 'image/png, image/jpeg, image/jpg, image/webp' : formData.mediaType === 'VIDEO' ? 'video/mp4, video/webm' : 'image/gif'}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl group-hover:scale-110 transition duration-300">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">Click or drag file to upload</p>
                        <p className="text-xs text-slate-500 mt-1">Max file size: 5MB</p>
                        <p className="text-xs text-slate-500">Allowed: JPG, JPEG, PNG, WEBP, MP4, WEBM, GIF</p>
                      </div>
                    </div>
                  </div>

                  {/* Media Preview Box */}
                  {filePreview && (
                    <div className="space-y-2 mt-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Live Preview</h4>
                      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center relative">
                        {formData.mediaType === 'IMAGE' && (
                          <img src={filePreview} alt="Preview" className="w-full h-full object-cover" />
                        )}
                        {formData.mediaType === 'GIF' && (
                          <img src={filePreview} alt="Preview GIF" className="w-full h-full object-cover" />
                        )}
                        {formData.mediaType === 'VIDEO' && (
                          <video src={filePreview} controls className="w-full h-full object-cover" />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4 text-xs text-emerald-400/80 leading-relaxed mt-4">
                  💡 <strong>Sharp Processing Policy:</strong> Image uploads are automatically converted to optimized 1200x600 WebP files. GIFs keep their native animation frames. Videos are written directly to VPS storage.
                </div>
              </div>
            </Motion.div>
          ) : (
            /* Advertisement List Table */
            <Motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
            >
              {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-500">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                  <p className="text-sm">Loading advertisement list...</p>
                </div>
              ) : ads.length === 0 ? (
                <div className="text-center py-20 text-gray-400 space-y-3">
                  <ImageIcon className="w-12 h-12 mx-auto stroke-[1] text-gray-400" />
                  <p className="text-sm">No advertisements found. Click "Add Advertisement" to create your first promotion.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-505 bg-gray-50">
                        <th className="px-6 py-4">Title</th>
                        <th className="px-6 py-4">Media</th>
                        <th className="px-6 py-4">Type</th>
                        <th className="px-6 py-4">Position</th>
                        <th className="px-6 py-4 text-center">Order</th>
                        <th className="px-6 py-4 text-center">Status</th>
                        <th className="px-6 py-4">Validity</th>
                        <th className="px-6 py-4 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm text-gray-600">
                      {ads.map((ad) => (
                        <tr key={ad._id} className="hover:bg-gray-50/70 transition">
                          {/* Title / Description */}
                          <td className="px-6 py-4 max-w-xs">
                            <p className="font-semibold text-gray-900 truncate">{ad.title}</p>
                            <p className="text-xs text-gray-400 truncate mt-0.5">{ad.description || 'No description'}</p>
                          </td>
 
                          {/* Media Preview Cell */}
                          <td className="px-6 py-4">
                            <div className="w-16 h-10 border border-gray-200 rounded bg-gray-50 overflow-hidden flex items-center justify-center">
                              {ad.mediaType === 'VIDEO' ? (
                                <div className="text-[10px] font-bold text-gray-400 uppercase font-mono">Video</div>
                              ) : (
                                <img src={ad.media?.url} alt="thumbnail" className="w-full h-full object-cover" />
                              )}
                            </div>
                          </td>
 
                          {/* Type */}
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-full border ${ad.type === 'FULL' ? 'bg-amber-50 text-amber-700 border-amber-200/50' : 'bg-sky-50 text-sky-700 border-sky-200/50'}`}>
                              {ad.type}
                            </span>
                          </td>
 
                          {/* Position */}
                          <td className="px-6 py-4 text-xs font-semibold text-gray-600">
                            {ad.position || 'N/A'}
                          </td>
 
                          {/* Order */}
                          <td className="px-6 py-4 text-center text-gray-600 font-bold">
                            {ad.displayOrder}
                          </td>
 
                          {/* Status Toggle */}
                          <td className="px-6 py-4 text-center">
                            <button
                              onClick={() => handleToggleStatus(ad._id)}
                              className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full transition cursor-pointer active:scale-95 border ${ad.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-250' : 'bg-rose-50 text-rose-700 border-rose-250'}`}
                            >
                              <Power className="w-3 h-3" />
                              {ad.status}
                            </button>
                          </td>
 
                          {/* Date Range */}
                          <td className="px-6 py-4 text-xs text-gray-550 flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-400" />
                              <span>S: {ad.startDate ? new Date(ad.startDate).toLocaleDateString() : 'Always'}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-400" />
                              <span>E: {ad.endDate ? new Date(ad.endDate).toLocaleDateString() : 'Always'}</span>
                            </div>
                          </td>
 
                          {/* Actions */}
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => setPreviewModalAd(ad)}
                                title="Preview Media"
                                className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition active:scale-90"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => startEdit(ad)}
                                title="Edit Advertisement"
                                className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition active:scale-90"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(ad._id)}
                                title="Delete Advertisement"
                                className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition active:scale-90"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Motion.div>
          )}
        </AnimatePresence>

        {/* Preview Modal */}
        <AnimatePresence>
          {previewModalAd && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <Motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden max-w-2xl w-full shadow-2xl relative"
              >
                <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white text-base">{previewModalAd.title}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{previewModalAd.type} Banner • {previewModalAd.mediaType}</p>
                  </div>
                  <button
                    onClick={() => setPreviewModalAd(null)}
                    className="text-slate-400 hover:text-white transition font-bold text-sm px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg"
                  >
                    Close
                  </button>
                </div>
                
                <div className="bg-slate-950 aspect-video w-full flex items-center justify-center overflow-hidden">
                  {previewModalAd.mediaType === 'IMAGE' && (
                    <img src={previewModalAd.media?.url} alt="preview" className="w-full h-full object-contain" />
                  )}
                  {previewModalAd.mediaType === 'GIF' && (
                    <img src={previewModalAd.media?.url} alt="preview gif" className="w-full h-full object-contain" />
                  )}
                  {previewModalAd.mediaType === 'VIDEO' && (
                    <video src={previewModalAd.media?.url} controls autoPlay className="w-full h-full object-contain" />
                  )}
                </div>

                <div className="p-4 bg-slate-900/60 text-xs text-slate-400 border-t border-slate-800 space-y-1">
                  <p><strong>Local VPS Path:</strong> /var/storage/advertisements/{previewModalAd.mediaType.toLowerCase()}s/...</p>
                  <p><strong>Mime Type:</strong> {previewModalAd.media?.mimeType} • <strong>Size:</strong> {(previewModalAd.media?.size / 1024).toFixed(1)} KB</p>
                </div>
              </Motion.div>
            </div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};

export default Advertisements;
