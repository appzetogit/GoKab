import { env } from '../../../config/env.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';
import { Driver } from '../driver/models/Driver.js';
import { User } from '../user/models/User.js';
import { buildDriverWelcomeEmail, buildUserWelcomeEmail } from './emailTemplates.js';
import { sendEmail } from './mailService.js';

const BUILDERS = {
  user: { build: buildUserWelcomeEmail, model: User },
  driver: { build: buildDriverWelcomeEmail, model: Driver },
};

// A mail server that accepts the connection and then stalls would otherwise
// hold this (background) send open for nodemailer's full multi-minute default.
const SEND_TIMEOUT_MS = 20_000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const withTimeout = (promise, ms) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`welcome email timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

// Admin-configurable T&C (`legal.<role>_terms_text` / `_url` in the business
// settings). Both are optional: a missing text falls back to the static copy in
// emailTemplates.js, and a missing URL to the public site's /terms page.
const resolveTermsContent = async (role) => {
  const setting = await AdminBusinessSetting.findOne({ scope: 'default' }).select('legal').lean();
  const legal = setting?.legal || {};
  const publicSite = String(env.publicFrontendUrl || '').trim().replace(/\/+$/, '');

  return {
    text: String(legal[`${role}_terms_text`] || '').trim(),
    url: String(legal[`${role}_terms_url`] || '').trim() || (publicSite ? `${publicSite}/terms` : ''),
  };
};

/**
 * Sends the welcome + T&C email for a newly registered `user` or `driver`.
 *
 * Never throws and never blocks registration on mail: callers fire-and-forget.
 * Off unless EMAIL_WELCOME_ENABLED === 'true'. When `entityId` is given, the
 * send is claimed on `welcomeEmailSentAt` first so the same account is never
 * mailed twice; the claim is released again if the send itself fails, so the
 * field only ever means "this person actually received it".
 */
export const sendWelcomeEmail = async ({ role, email, name, entityId = null }) => {
  if (process.env.EMAIL_WELCOME_ENABLED !== 'true') {
    return { sent: false, reason: 'disabled' };
  }

  const to = String(email ?? '').trim();
  if (!to) {
    return { sent: false, reason: 'no-email' };
  }
  if (!EMAIL_PATTERN.test(to)) {
    return { sent: false, reason: 'invalid-email' };
  }

  const entry = BUILDERS[role];
  if (!entry) {
    return { sent: false, reason: 'unknown-role' };
  }

  let claimed = false;

  try {
    if (entityId) {
      const claim = await entry.model.updateOne(
        { _id: entityId, welcomeEmailSentAt: null },
        { $set: { welcomeEmailSentAt: new Date() } },
      );
      if (!claim.modifiedCount) {
        return { sent: false, reason: 'already-sent' };
      }
      claimed = true;
    }

    const terms = await resolveTermsContent(role);
    const message = entry.build({ name, terms });
    await withTimeout(sendEmail({ to, ...message }), SEND_TIMEOUT_MS);

    return { sent: true };
  } catch (error) {
    console.error(`[welcomeEmail] ${role} welcome email failed:`, error?.message || error);

    if (claimed) {
      await entry.model
        .updateOne({ _id: entityId }, { $set: { welcomeEmailSentAt: null } })
        .catch(() => {});
    }

    return { sent: false, reason: 'error' };
  }
};
