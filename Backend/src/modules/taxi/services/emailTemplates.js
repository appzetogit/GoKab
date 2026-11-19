/**
 * Welcome + Terms & Conditions email bodies for riders and drivers.
 *
 * Pure functions: they never touch the database. The caller resolves the
 * admin-configurable T&C (`terms`) and passes it in; anything it leaves out
 * falls back to the static copy below.
 *
 * NOTE: the static T&C is a plain-language summary, not the full legal text.
 * It points readers at the full terms page when a URL is available. Have the
 * wording reviewed before this email is switched on in production.
 */

const APP_NAME = 'GoKab';

const STATIC_TERMS = {
  user: {
    intro:
      'By using GoKab you agree to these Terms & Conditions. Here is a short summary of the points that matter most.',
    sections: [
      {
        title: 'Use of the platform',
        body: 'GoKab provides technology services for ride booking and related mobility services. Availability can vary by city, vehicle type, demand and operating hours.',
      },
      {
        title: 'Your account',
        bullets: [
          'Give accurate name, phone number and account details.',
          'Use the platform only for lawful purposes.',
        ],
      },
      {
        title: 'Bookings and fares',
        bullets: [
          'A booking is confirmed once the system accepts it and a driver is assigned.',
          'Fares can change with distance, traffic, tolls, waiting time, taxes or peak demand.',
          'The final amount shown at checkout or after the trip is binding unless there is a verified billing error.',
        ],
      },
      {
        title: 'Conduct',
        bullets: [
          'No fake bookings or misuse of payment methods.',
          'No damage to vehicles or harassment of drivers and support staff.',
          'No illegal, dangerous or prohibited goods or activities.',
        ],
      },
      {
        title: 'Account actions',
        body: 'GoKab may suspend or terminate access in cases of fraud, abusive conduct, repeated policy violations, non-payment or legal risk.',
      },
    ],
  },
  driver: {
    intro:
      'By registering as a GoKab driver you agree to these Terms & Conditions. Here is a short summary of the points that matter most.',
    sections: [
      {
        title: 'Your registration',
        bullets: [
          'Documents and details you submit must be accurate, valid and your own.',
          'Your account is activated only after GoKab verifies your documents.',
          'Keep your documents (licence, vehicle papers, permits) valid; expired documents can lead to suspension.',
        ],
      },
      {
        title: 'Trips and conduct',
        bullets: [
          'Follow traffic laws and treat riders and partners with respect.',
          'Do not take cancellations, fares or payments outside the platform to avoid its rules.',
          'Do not use the platform for illegal, dangerous or prohibited goods or activities.',
        ],
      },
      {
        title: 'Earnings and wallet',
        body: 'Commission, wallet balance, cash-collection limits and payouts follow the rules shown in the app and may change with plan or category.',
      },
      {
        title: 'Account actions',
        body: 'GoKab may suspend or terminate an account for fraud, unsafe or abusive conduct, repeated policy violations, expired documents or legal risk.',
      },
    ],
  },
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Only ever link out to http(s): a configured URL is admin input, and a
// `javascript:` href in an email is still an href.
const safeUrl = (value) => {
  const url = String(value ?? '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
};

const displayName = (name) => String(name ?? '').trim().replace(/\s+/g, ' ') || 'there';

// Admin-supplied plain text: blank-line separated paragraphs.
const paragraphsFromText = (text) =>
  String(text ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const termsSections = ({ role, terms }) => {
  const customParagraphs = paragraphsFromText(terms?.text);

  if (customParagraphs.length > 0) {
    return {
      intro: '',
      sections: customParagraphs.map((body) => ({ title: '', body })),
    };
  }

  return STATIC_TERMS[role];
};

const renderTermsHtml = ({ intro, sections }) =>
  [
    intro ? `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>` : '',
    ...sections.map((section) =>
      [
        section.title
          ? `<h3 style="margin:16px 0 6px;font-size:15px;color:#111827">${escapeHtml(section.title)}</h3>`
          : '',
        section.body ? `<p style="margin:0 0 8px">${escapeHtml(section.body)}</p>` : '',
        Array.isArray(section.bullets) && section.bullets.length
          ? `<ul style="margin:0 0 8px;padding-left:20px">${section.bullets
              .map((bullet) => `<li style="margin:0 0 4px">${escapeHtml(bullet)}</li>`)
              .join('')}</ul>`
          : '',
      ].join(''),
    ),
  ].join('');

const renderTermsText = ({ intro, sections }) =>
  [
    intro,
    ...sections.map((section) =>
      [
        section.title ? section.title.toUpperCase() : '',
        section.body || '',
        ...(Array.isArray(section.bullets) ? section.bullets.map((bullet) => `- ${bullet}`) : []),
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ]
    .filter(Boolean)
    .join('\n\n');

const buildWelcomeEmail = ({ role, name, terms, subject, headline, lead }) => {
  const greeting = `Hi ${displayName(name)},`;
  const body = termsSections({ role, terms });
  const termsUrl = safeUrl(terms?.url);

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#374151;line-height:1.5">
    <div style="max-width:600px;margin:0 auto;padding:24px 16px">
      <div style="background:#ffffff;border-radius:8px;padding:24px">
        <h2 style="margin:0 0 12px;color:#111827">${escapeHtml(headline)}</h2>
        <p style="margin:0 0 8px">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 16px">${escapeHtml(lead)}</p>
        <h2 style="margin:24px 0 8px;font-size:17px;color:#111827">Terms &amp; Conditions</h2>
        ${renderTermsHtml(body)}
        ${
          termsUrl
            ? `<p style="margin:16px 0 0">Read the full Terms &amp; Conditions: <a href="${escapeHtml(termsUrl)}">${escapeHtml(termsUrl)}</a></p>`
            : ''
        }
        <p style="margin:24px 0 0;color:#6b7280;font-size:13px">If you did not create this account, please contact GoKab support.</p>
      </div>
      <p style="margin:12px 0 0;text-align:center;color:#9ca3af;font-size:12px">&copy; ${APP_NAME}</p>
    </div>
  </body>
</html>`;

  const text = [
    greeting,
    lead,
    'TERMS & CONDITIONS',
    renderTermsText(body),
    termsUrl ? `Read the full Terms & Conditions: ${termsUrl}` : '',
    'If you did not create this account, please contact GoKab support.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { subject, html, text };
};

export const buildUserWelcomeEmail = ({ name, terms } = {}) =>
  buildWelcomeEmail({
    role: 'user',
    name,
    terms,
    subject: `Welcome to ${APP_NAME} - your account is ready`,
    headline: `Welcome to ${APP_NAME}!`,
    lead: `Thanks for signing up. Your ${APP_NAME} account is ready - you can book your first ride any time. Please take a moment to read the Terms & Conditions that apply to your account.`,
  });

export const buildDriverWelcomeEmail = ({ name, terms } = {}) =>
  buildWelcomeEmail({
    role: 'driver',
    name,
    terms,
    subject: `Welcome to ${APP_NAME} - your driver registration is received`,
    headline: `Welcome to ${APP_NAME}!`,
    lead: `Thanks for registering as a ${APP_NAME} driver. We have received your details and our team will verify your documents; you will be able to go online once your account is approved. Please read the Terms & Conditions that apply to drivers.`,
  });
