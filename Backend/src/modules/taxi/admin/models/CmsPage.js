import mongoose from 'mongoose';

/**
 * A text page the admin writes once and an app shows: About Us, Privacy Policy,
 * Terms & Conditions and Contact Us, separately for the rider and the driver app.
 * Plain text only (the apps render it as text), so nothing here can run script.
 */
const cmsPageSchema = new mongoose.Schema(
  {
    audience: { type: String, enum: ['user', 'driver'], required: true },
    slug: { type: String, enum: ['about', 'privacy', 'terms', 'contact'], required: true },
    title: { type: String, default: '', trim: true, maxlength: 120 },
    content: { type: String, default: '', maxlength: 60000 },
    contact: {
      phone: { type: String, default: '', trim: true, maxlength: 40 },
      whatsapp: { type: String, default: '', trim: true, maxlength: 40 },
      email: { type: String, default: '', trim: true, maxlength: 120 },
      address: { type: String, default: '', trim: true, maxlength: 300 },
      hours: { type: String, default: '', trim: true, maxlength: 120 },
    },
    is_active: { type: Boolean, default: true },
    updated_by: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

cmsPageSchema.index({ audience: 1, slug: 1 }, { unique: true });

export const CmsPage = mongoose.models.TaxiCmsPage || mongoose.model('TaxiCmsPage', cmsPageSchema);
export const CMS_AUDIENCES = ['user', 'driver'];
export const CMS_SLUGS = ['about', 'privacy', 'terms', 'contact'];
