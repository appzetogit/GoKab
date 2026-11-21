import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

const unwrap = (res) => res?.data ?? res ?? {};
const errorText = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

const inputClass =
  'w-full bg-white border border-slate-200 rounded-lg py-3 px-4 text-[14px] text-slate-700 focus:border-indigo-500 outline-none';

const APPS = [
  { key: 'user', label: 'Rider App (User)' },
  { key: 'driver', label: 'Driver App' },
];

const CONTACT_FIELDS = [
  ['phone', 'Support phone', '+91 98XXXXXXXX'],
  ['whatsapp', 'WhatsApp number', '+91 98XXXXXXXX'],
  ['email', 'Support email', 'support@gokab.in'],
  ['address', 'Office address', 'Street, city, state'],
  ['hours', 'Working hours', 'Mon - Sat, 9 AM to 8 PM'],
];

const Field = ({ label, hint, children }) => (
  <label className="space-y-1.5 block">
    <span className="text-[13px] font-bold text-slate-700 block">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-slate-400 block">{hint}</span>}
  </label>
);

/**
 * One page (About Us, Privacy Policy, Terms or Contact Us) for both apps.
 * What is saved here is what the Rider and Driver apps show.
 */
const CmsContent = ({ slug, heading, description }) => {
  const [audience, setAudience] = useState('user');
  const [pages, setPages] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = unwrap(await api.get('/admin/cms-pages'));
        const results = res?.data?.results || res?.results || [];
        if (!alive) return;
        const map = {};
        results.filter((r) => r.slug === slug).forEach((r) => {
          map[r.audience] = {
            title: r.title || '',
            content: r.content || '',
            contact: { phone: '', whatsapp: '', email: '', address: '', hours: '', ...(r.contact || {}) },
            is_active: r.is_active !== false,
            is_custom: Boolean(r.is_custom),
          };
        });
        setPages(map);
      } catch (err) {
        toast.error(errorText(err, 'Could not load the page'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  const page = pages[audience];
  const patch = (changes) => setPages((prev) => ({ ...prev, [audience]: { ...prev[audience], ...changes } }));
  const patchContact = (key, value) => patch({ contact: { ...page.contact, [key]: value } });

  const save = async () => {
    if (!page.title.trim()) return toast.error('Write a title');
    if (!page.content.trim()) return toast.error('Write the page text');
    setSaving(true);
    try {
      await api.put(`/admin/cms-pages/${audience}/${slug}`, {
        title: page.title,
        content: page.content,
        contact: page.contact,
        is_active: page.is_active,
      });
      patch({ is_custom: true });
      toast.success(`Saved. The ${audience === 'user' ? 'Rider' : 'Driver'} app will show this page now.`);
    } catch (err) {
      toast.error(errorText(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const paragraphs = useMemo(() => (page?.content || '').split(/\n{2,}/).filter(Boolean), [page?.content]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-black text-slate-900">{heading}</h1>
        <p className="text-sm text-slate-500 mt-1">{description}</p>
      </div>

      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 gap-1">
        {APPS.map((app) => (
          <button
            key={app.key}
            type="button"
            onClick={() => setAudience(app.key)}
            className={`px-4 py-2 rounded-lg text-[13px] font-bold flex items-center gap-2 ${
              audience === app.key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Smartphone size={15} /> {app.label}
          </button>
        ))}
      </div>

      {loading || !page ? (
        <div className="flex items-center gap-2 text-slate-500 py-10">
          <Loader2 className="animate-spin" size={18} /> Loading...
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            {!page.is_custom && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px] px-3 py-2">
                This is the standard text. Edit it and press Save to publish your own.
              </div>
            )}
            <Field label="Title" hint="The heading shown at the top of the page in the app.">
              <input className={inputClass} value={page.title} onChange={(e) => patch({ title: e.target.value })} maxLength={120} />
            </Field>
            <Field
              label="Text"
              hint="Leave an empty line between paragraphs. Start a line with # to make it a heading."
            >
              <textarea
                className={`${inputClass} font-normal leading-relaxed`}
                rows={slug === 'contact' ? 5 : 16}
                value={page.content}
                onChange={(e) => patch({ content: e.target.value })}
              />
            </Field>

            {slug === 'contact' && (
              <div className="grid sm:grid-cols-2 gap-4">
                {CONTACT_FIELDS.map(([key, label, placeholder]) => (
                  <Field key={key} label={label}>
                    <input
                      className={inputClass}
                      value={page.contact[key] || ''}
                      placeholder={placeholder}
                      onChange={(e) => patchContact(key, e.target.value)}
                    />
                  </Field>
                ))}
              </div>
            )}

            <label className="flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={page.is_active} onChange={(e) => patch({ is_active: e.target.checked })} />
              Show my text in the app (untick to go back to the standard text)
            </label>

            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-[14px] px-5 py-3 rounded-lg"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save
            </button>
          </div>

          <div className="bg-slate-900 rounded-3xl p-4 text-white h-fit">
            <p className="text-[11px] uppercase tracking-widest text-slate-400 mb-2">Preview in the app</p>
            <div className="bg-white text-slate-800 rounded-2xl p-4 max-h-[460px] overflow-auto">
              <h3 className="font-black text-[15px] mb-2">{page.title || '-'}</h3>
              {paragraphs.map((p, i) =>
                p.startsWith('# ') ? (
                  <h4 key={i} className="font-bold text-[13px] mt-3 mb-1">
                    {p.slice(2)}
                  </h4>
                ) : (
                  <p key={i} className="text-[12px] leading-relaxed mb-2 whitespace-pre-line">
                    {p}
                  </p>
                ),
              )}
              {slug === 'contact' && (
                <ul className="mt-3 space-y-1 text-[12px]">
                  {CONTACT_FIELDS.filter(([k]) => page.contact[k]).map(([k, label]) => (
                    <li key={k}>
                      <b>{label}:</b> {page.contact[k]}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CmsContent;
