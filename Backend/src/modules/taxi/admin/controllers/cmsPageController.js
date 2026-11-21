import { ApiError } from '../../../../utils/ApiError.js';
import { CmsPage, CMS_AUDIENCES, CMS_SLUGS } from '../models/CmsPage.js';

// What an app shows until the admin writes its own text.
const DEFAULT_TITLE = {
  about: 'About Us',
  privacy: 'Privacy Policy',
  terms: 'Terms & Conditions',
  contact: 'Contact Us',
};

const DEFAULT_CONTENT = {
  user: {
    about:
      'GoKab is a safe, reliable taxi service. Book a ride in a few taps, track your driver live and pay your way.\n\nOur drivers are verified and every ride is supported by our team.',
    privacy:
      'Your privacy matters to us. This app collects location data to enable pickup and drop-off, ride matching and live tracking, and contact details to create your account.\n\nWe do not sell your personal data. Information is shared only with the driver assigned to your ride (name, phone, live location during the trip) and with payment providers.\n\nYou can ask for a copy of your data or ask us to delete your account at any time from Profile > Delete account.',
    terms:
      'By using this app you agree to book rides responsibly, give accurate pickup and drop information, and treat drivers with respect. Fares are calculated from the distance, time and the rates shown at booking.\n\nCancellations after a driver is assigned may carry a cancellation fee. Wallet balances are non-transferable and non-refundable except where the law requires.\n\nThese terms may be updated from time to time. Continued use of the app means you accept the updated terms.',
    contact: 'Need help with a ride or a payment? Reach us using the details below.',
  },
  driver: {
    about:
      'GoKab Driver helps you find rides, grow your earnings and manage your work in one app.\n\nWe work with drivers to keep rides safe, payments clear and support quick.',
    privacy:
      'We collect your location while you are online, your documents and vehicle details to verify you, and your contact details to run your account.\n\nRiders see your name, vehicle and live location only during their trip. We do not sell your personal data.\n\nYou can ask us to delete your account from the app.',
    terms:
      'By driving with GoKab you confirm that your documents and vehicle details are correct and valid, that you will follow traffic law, and that you will treat riders with respect.\n\nCommission, plans and payouts follow the rates shown in your app. Cash rides add the company commission to your wallet balance, which you must keep in credit.\n\nWe may pause an account for false documents, unsafe behaviour or unpaid dues. These terms may be updated from time to time.',
    contact: 'Need help with a ride, your documents or a payout? Reach us using the details below.',
  },
};

const assertCmsAdmin = (req) => {
  const permissions = req.auth?.admin?.permissions || [];
  if (permissions.includes('*') || permissions.includes('settings.view')) return;
  throw new ApiError(403, 'You do not have permission to edit app pages', null, 'FORBIDDEN');
};

const checkKey = (audience, slug) => {
  if (!CMS_AUDIENCES.includes(audience) || !CMS_SLUGS.includes(slug)) {
    throw new ApiError(404, 'Page not found', null, 'CMS_PAGE_NOT_FOUND');
  }
};

const shape = (audience, slug, row) => ({
  audience,
  slug,
  title: row?.title || DEFAULT_TITLE[slug],
  content: row?.content?.trim() ? row.content : DEFAULT_CONTENT[audience][slug],
  contact: {
    phone: row?.contact?.phone || '',
    whatsapp: row?.contact?.whatsapp || '',
    email: row?.contact?.email || '',
    address: row?.contact?.address || '',
    hours: row?.contact?.hours || '',
  },
  is_custom: Boolean(row && (row.content?.trim() || row.title)),
  is_active: row ? row.is_active !== false : true,
  updated_at: row?.updatedAt || null,
});

/** GET /cms/:audience/:slug (public: the apps call it, also before login) */
export const getPublicCmsPageController = async (req, res) => {
  const { audience, slug } = req.params;
  checkKey(audience, slug);
  // A page the admin switched off falls back to the defaults, so an app never shows a blank screen.
  const row = await CmsPage.findOne({ audience, slug, is_active: true }).lean();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: shape(audience, slug, row) });
};

/** GET /admin/cms-pages (all eight pages, defaults filled in) */
export const listCmsPagesController = async (req, res) => {
  assertCmsAdmin(req);
  const rows = await CmsPage.find({}).lean();
  const by = new Map(rows.map((r) => [`${r.audience}:${r.slug}`, r]));
  const results = [];
  for (const audience of CMS_AUDIENCES) {
    for (const slug of CMS_SLUGS) results.push(shape(audience, slug, by.get(`${audience}:${slug}`)));
  }
  res.json({ success: true, data: { results } });
};

const clean = (value, max) => String(value ?? '').slice(0, max);

/** PUT /admin/cms-pages/:audience/:slug */
export const saveCmsPageController = async (req, res) => {
  assertCmsAdmin(req);
  const { audience, slug } = req.params;
  checkKey(audience, slug);
  const body = req.body || {};
  const contact = body.contact || {};
  const update = {
    title: clean(body.title, 120).trim(),
    content: clean(body.content, 60000),
    contact: {
      phone: clean(contact.phone, 40).trim(),
      whatsapp: clean(contact.whatsapp, 40).trim(),
      email: clean(contact.email, 120).trim(),
      address: clean(contact.address, 300).trim(),
      hours: clean(contact.hours, 120).trim(),
    },
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
  };
  const row = await CmsPage.findOneAndUpdate(
    { audience, slug },
    { $set: update, $setOnInsert: { audience, slug } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
  res.json({ success: true, data: shape(audience, slug, row) });
};
