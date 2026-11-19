/**
 * Smoke test for the welcome + Terms & Conditions email (user and driver).
 *
 * A real (tiny) SMTP server runs inside this script, so what is checked is
 * what actually goes over the wire: recipient, subject and body.
 *
 * Needs THREE backend instances against the same database, differing only in
 * mail env (the user-signup checks go over HTTP):
 *   ON       EMAIL_WELCOME_ENABLED=true  EMAIL_HOST=127.0.0.1 EMAIL_PORT=<SMTP_PORT>
 *   BADSMTP  EMAIL_WELCOME_ENABLED=true  EMAIL_HOST=127.0.0.1 EMAIL_PORT=1   (nothing listens)
 *   OFF      (EMAIL_WELCOME_ENABLED unset)
 *
 * The in-process checks (templates, service, driver onboarding) use this
 * process's own env, which the script sets itself before importing anything.
 *
 * Usage:
 *   SMOKE_API_ON=... SMOKE_API_BADSMTP=... SMOKE_API_OFF=... SMOKE_SMTP_PORT=2526 \
 *     node scripts/smoke_welcome_email.mjs
 */

import net from 'node:net';

const SMTP_PORT = Number(process.env.SMOKE_SMTP_PORT || 2526);

// Read at import time by services/mailService.js — must be set first.
process.env.EMAIL_HOST = '127.0.0.1';
process.env.EMAIL_PORT = String(SMTP_PORT);
process.env.EMAIL_FROM = '"GoKab" <noreply@gokab.test>';
delete process.env.EMAIL_WELCOME_ENABLED;

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const API_ON = process.env.SMOKE_API_ON || 'http://127.0.0.1:4094/api/v1';
const API_BADSMTP = process.env.SMOKE_API_BADSMTP || 'http://127.0.0.1:4093/api/v1';
const API_OFF = process.env.SMOKE_API_OFF || 'http://127.0.0.1:4092/api/v1';
const DB_URI = process.env.SMOKE_DB_URI || 'mongodb://127.0.0.1:27039/gokab_welcome?replicaSet=rs0';

let pass = 0;
let fail = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(100);
  }
  return false;
};

// ---------------------------------------------------------------------------
// A minimal SMTP server that records every accepted message.
// ---------------------------------------------------------------------------
const startFakeSmtp = (port) => {
  const messages = [];

  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    socket.write('220 fake.smtp ESMTP\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      if (inData) {
        if (buffer.endsWith('\r\n.\r\n')) {
          messages.push(buffer.slice(0, -5));
          buffer = '';
          inData = false;
          socket.write('250 OK queued\r\n');
        }
        return;
      }

      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const command = buffer.slice(0, index).toUpperCase();
        buffer = buffer.slice(index + 2);

        if (command.startsWith('EHLO') || command.startsWith('HELO')) socket.write('250 fake.smtp\r\n');
        else if (command === 'DATA') {
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          inData = true;
          break;
        } else if (command === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {});
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, messages })));
};

const decodeQuotedPrintable = (value) =>
  value
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const parseMessage = (raw) => {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const headers = raw.slice(0, headerEnd);
  const header = (name) => headers.match(new RegExp(`^${name}:\\s*(.*)$`, 'im'))?.[1]?.trim() || '';
  return { to: header('To'), subject: header('Subject'), from: header('From'), body: decodeQuotedPrintable(raw.slice(headerEnd + 4)) };
};

const post = async (base, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
};

const signupUserOverHttp = async (base, { phone, name, email }) => {
  await post(base, '/users/auth/send-otp', { phone });
  const verified = await post(base, '/users/auth/verify-otp', { phone, otp: '0000' });
  if (verified.status !== 200) return { stage: 'verify-otp', ...verified };
  return post(base, '/users/signup', {
    name,
    phone,
    email,
    profileImage: 'https://example.test/profile.jpg',
    governmentIdProof: { type: 'aadhaar', imageUrl: 'https://example.test/id.jpg' },
  });
};

const run = async () => {
  await mongoose.connect(DB_URI);
  const { User } = await import('../src/modules/taxi/user/models/User.js');
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { AdminBusinessSetting } = await import('../src/modules/taxi/admin/models/AdminBusinessSetting.js');
  const { DriverRegistrationSession } = await import('../src/modules/taxi/driver/models/DriverRegistrationSession.js');
  const { buildUserWelcomeEmail, buildDriverWelcomeEmail } = await import('../src/modules/taxi/services/emailTemplates.js');
  const { sendWelcomeEmail } = await import('../src/modules/taxi/services/welcomeEmailService.js');
  const onboardingService = await import('../src/modules/taxi/driver/services/onboardingService.js');

  const smtp = await startFakeSmtp(SMTP_PORT);
  const mailbox = smtp.messages;
  const sentTo = (address) => mailbox.map(parseMessage).filter((message) => message.to.includes(address));

  const stamp = String(Date.now()).slice(-6);

  // =========================================================================
  console.log('\n=== 1. Templates ===');
  const userMail = buildUserWelcomeEmail({ name: 'Ram Kumar' });
  check('User template returns { subject, html, text }', Boolean(userMail.subject && userMail.html && userMail.text));
  check('User subject says welcome', /welcome/i.test(userMail.subject), userMail.subject);
  check('Greets the user by name (html + text)', userMail.html.includes('Hi Ram Kumar,') && userMail.text.includes('Hi Ram Kumar,'));
  check('Static user T&C present (html + text)', userMail.html.includes('Terms &amp; Conditions') && /TERMS & CONDITIONS/.test(userMail.text) && /bookings and fares/i.test(userMail.text));

  const driverMail = buildDriverWelcomeEmail({ name: 'Suresh' });
  check('Driver template is a different email', driverMail.subject !== userMail.subject && driverMail.text !== userMail.text);
  check('Driver subject mentions the driver registration', /driver/i.test(driverMail.subject), driverMail.subject);
  check('Driver copy says documents are verified before going online', /verify/i.test(driverMail.text) && /approved/i.test(driverMail.text));
  check('Driver T&C is the driver one, not the rider one', /earnings and wallet/i.test(driverMail.text) && !/bookings and fares/i.test(driverMail.text));
  check('Nothing is sent to the user about verification', !/verify your documents/i.test(userMail.text));

  const hostile = buildUserWelcomeEmail({ name: '<script>alert(1)</script> "Eve"' });
  check('A hostile name is HTML-escaped', !hostile.html.includes('<script>') && hostile.html.includes('&lt;script&gt;'));
  check('A missing name falls back to "there"', buildUserWelcomeEmail({}).text.includes('Hi there,'));

  const customMail = buildUserWelcomeEmail({
    name: 'Ram',
    terms: { text: 'First custom paragraph.\n\nSecond custom paragraph.', url: 'https://gokab.test/terms' },
  });
  check('Admin T&C text replaces the static copy', customMail.text.includes('First custom paragraph.') && customMail.text.includes('Second custom paragraph.') && !/bookings and fares/i.test(customMail.text));
  check('Full-terms link rendered when a URL is given', customMail.html.includes('href="https://gokab.test/terms"') && customMail.text.includes('https://gokab.test/terms'));
  const badUrlMail = buildUserWelcomeEmail({ name: 'Ram', terms: { url: 'javascript:alert(1)' } });
  check('A non-http(s) URL is never linked', !badUrlMail.html.includes('javascript:') && !badUrlMail.html.includes('href='));

  // =========================================================================
  console.log('\n=== 2. Service: flag off / skipped inputs ===');
  const amit = await User.findOne({ phone: '9100000001' }).lean();
  const suresh = await Driver.findOne({ phone: '9000000002' }).lean();
  await User.updateOne({ _id: amit._id }, { $set: { welcomeEmailSentAt: null } });

  const off = await sendWelcomeEmail({ role: 'user', email: 'amit@example.test', name: 'Amit', entityId: amit._id });
  check('Flag unset: nothing sent (reason: disabled)', off.sent === false && off.reason === 'disabled', JSON.stringify(off));
  await sleep(300);
  check('...and nothing reached the mail server', sentTo('amit@example.test').length === 0);
  check('...and the account is not marked as mailed', (await User.findById(amit._id).lean()).welcomeEmailSentAt === null);

  process.env.EMAIL_WELCOME_ENABLED = 'false';
  const offExplicit = await sendWelcomeEmail({ role: 'user', email: 'amit@example.test', name: 'Amit', entityId: amit._id });
  check('EMAIL_WELCOME_ENABLED=false: nothing sent', offExplicit.sent === false && offExplicit.reason === 'disabled');

  process.env.EMAIL_WELCOME_ENABLED = 'true';
  const noEmail = await sendWelcomeEmail({ role: 'user', email: '', name: 'Amit', entityId: amit._id });
  check('Empty email: skipped, no error', noEmail.sent === false && noEmail.reason === 'no-email', JSON.stringify(noEmail));
  const spaces = await sendWelcomeEmail({ role: 'user', email: '   ', name: 'Amit', entityId: amit._id });
  check('Whitespace-only email: skipped', spaces.reason === 'no-email');
  const nullEmail = await sendWelcomeEmail({ role: 'user', email: null, name: 'Amit', entityId: amit._id });
  check('Null email: skipped', nullEmail.reason === 'no-email');
  const badEmail = await sendWelcomeEmail({ role: 'user', email: 'not-an-email', name: 'Amit', entityId: amit._id });
  check('Malformed email: skipped', badEmail.sent === false && badEmail.reason === 'invalid-email');
  const badRole = await sendWelcomeEmail({ role: 'admin', email: 'a@example.test', name: 'A' });
  check('Unknown role: skipped', badRole.sent === false && badRole.reason === 'unknown-role');
  check('Skipped sends did not mark the account or hit the mail server', (await User.findById(amit._id).lean()).welcomeEmailSentAt === null && mailbox.length === 0);

  // =========================================================================
  console.log('\n=== 3. Service: flag on, real SMTP delivery ===');
  const sentUser = await sendWelcomeEmail({ role: 'user', email: 'amit@example.test', name: 'Amit Sharma', entityId: amit._id });
  check('User welcome email sent', sentUser.sent === true, JSON.stringify(sentUser));
  const amitMail = sentTo('amit@example.test');
  check('Exactly one message arrived for the user', amitMail.length === 1, String(amitMail.length));
  check('Subject is the user welcome subject', amitMail[0]?.subject === userMail.subject, amitMail[0]?.subject);
  check('Sent from the configured sender', (amitMail[0]?.from || '').includes('noreply@gokab.test'));
  check('Body greets by name and carries the user T&C', Boolean(amitMail[0]?.body.includes('Hi Amit Sharma,')) && /bookings and fares/i.test(amitMail[0]?.body || ''));
  check('Account marked welcomeEmailSentAt', Boolean((await User.findById(amit._id).lean()).welcomeEmailSentAt));

  const again = await sendWelcomeEmail({ role: 'user', email: 'amit@example.test', name: 'Amit Sharma', entityId: amit._id });
  check('A second call for the same account is skipped (already-sent)', again.sent === false && again.reason === 'already-sent', JSON.stringify(again));
  await sleep(300);
  check('...and no second message arrived', sentTo('amit@example.test').length === 1);

  await Driver.updateOne({ _id: suresh._id }, { $set: { welcomeEmailSentAt: null } });
  const sentDriver = await sendWelcomeEmail({ role: 'driver', email: 'suresh@example.test', name: 'Suresh Kumar', entityId: suresh._id });
  const sureshMail = sentTo('suresh@example.test');
  check('Driver welcome email sent', sentDriver.sent === true && sureshMail.length === 1, JSON.stringify(sentDriver));
  check('Driver email uses the driver subject and driver T&C', sureshMail[0]?.subject === driverMail.subject && /earnings and wallet/i.test(sureshMail[0]?.body || '') && !/bookings and fares/i.test(sureshMail[0]?.body || ''));
  check('Driver marked welcomeEmailSentAt', Boolean((await Driver.findById(suresh._id).lean()).welcomeEmailSentAt));

  const noEntity = await sendWelcomeEmail({ role: 'user', email: 'anon@example.test', name: 'Anon' });
  check('Works without an entityId (no dedupe), still delivers', noEntity.sent === true && sentTo('anon@example.test').length === 1);

  // =========================================================================
  console.log('\n=== 4. T&C from admin settings ===');
  await AdminBusinessSetting.updateOne(
    { scope: 'default' },
    { $set: { 'legal.user_terms_text': 'Admin-written terms, paragraph one.\n\nParagraph two.', 'legal.user_terms_url': 'https://gokab.test/legal/user' } },
  );
  const settingsRow = await AdminBusinessSetting.findOne({ scope: 'default' }).lean();
  check('legal.* settings persisted (schema allows the section)', settingsRow?.legal?.user_terms_url === 'https://gokab.test/legal/user');
  await sendWelcomeEmail({ role: 'user', email: 'custom@example.test', name: 'Custom' });
  const customDelivered = sentTo('custom@example.test')[0];
  check('Email carries the admin-configured T&C text', Boolean(customDelivered?.body.includes('Admin-written terms, paragraph one.')), customDelivered?.body.slice(0, 200));
  check('...instead of the static copy', !/bookings and fares/i.test(customDelivered?.body || ''));
  check('...and the configured full-terms link', Boolean(customDelivered?.body.includes('https://gokab.test/legal/user')));
  await sendWelcomeEmail({ role: 'driver', email: 'drivercustom@example.test', name: 'D' });
  check('A role with no override still gets its static T&C', /earnings and wallet/i.test(sentTo('drivercustom@example.test')[0]?.body || ''));
  await AdminBusinessSetting.updateOne({ scope: 'default' }, { $unset: { legal: '' } });

  // =========================================================================
  console.log('\n=== 5. User signup over HTTP ===');
  const onPhone = `93${stamp}01`;
  const signupOn = await signupUserOverHttp(API_ON, { phone: onPhone, name: 'Welcome On', email: `welcome-on-${stamp}@example.test` });
  check('Signup succeeds (201) with the flag on', signupOn.status === 201, JSON.stringify(signupOn));
  const arrived = await waitFor(() => sentTo(`welcome-on-${stamp}@example.test`).length > 0);
  check('The welcome email reaches the new user', arrived);
  const onMail = sentTo(`welcome-on-${stamp}@example.test`)[0];
  check('...addressed by name, with the user T&C', Boolean(onMail?.body.includes('Hi Welcome On,')) && /bookings and fares/i.test(onMail?.body || ''));
  check('...and the user is marked as mailed', await waitFor(async () => Boolean((await User.findOne({ phone: onPhone }).lean())?.welcomeEmailSentAt)));
  check('Exactly one email for that signup', sentTo(`welcome-on-${stamp}@example.test`).length === 1);

  const noEmailPhone = `93${stamp}02`;
  const beforeNoEmail = mailbox.length;
  const signupNoEmail = await signupUserOverHttp(API_ON, { phone: noEmailPhone, name: 'No Email User', email: '' });
  check('Signup without an email still succeeds (201)', signupNoEmail.status === 201, JSON.stringify(signupNoEmail));
  await sleep(1200);
  check('...and sends nothing', mailbox.length === beforeNoEmail);

  const badPhone = `93${stamp}03`;
  const startedAt = Date.now();
  const signupBad = await signupUserOverHttp(API_BADSMTP, { phone: badPhone, name: 'Bad Smtp', email: `bad-smtp-${stamp}@example.test` });
  check('Wrong SMTP settings: signup STILL succeeds (201)', signupBad.status === 201, JSON.stringify(signupBad));
  check('...promptly (mail does not block the response)', Date.now() - startedAt < 5000, `${Date.now() - startedAt}ms`);
  check('...and a usable session is returned', Boolean(signupBad.json?.data?.token));
  const badUser = await User.findOne({ phone: badPhone }).lean();
  check('...the user exists', Boolean(badUser));
  await sleep(1500);
  check('...and is not marked as mailed (the claim was released)', (await User.findOne({ phone: badPhone }).lean())?.welcomeEmailSentAt === null);

  const offPhone = `93${stamp}04`;
  const beforeOff = mailbox.length;
  const signupOff = await signupUserOverHttp(API_OFF, { phone: offPhone, name: 'Flag Off', email: `flag-off-${stamp}@example.test` });
  check('Flag off: signup succeeds (201)', signupOff.status === 201, JSON.stringify(signupOff));
  await sleep(1200);
  check('...and no email is sent', mailbox.length === beforeOff && sentTo(`flag-off-${stamp}@example.test`).length === 0);
  check('...and the account is not marked', (await User.findOne({ phone: offPhone }).lean())?.welcomeEmailSentAt === null);

  // =========================================================================
  console.log('\n=== 6. Driver onboarding (in-process) ===');
  const passwordHash = await bcrypt.hash('password', 10);
  const city = await Driver.findOne({ phone: '9000000001' }).select('service_location_id').lean();

  const registerDriver = async ({ phone, email, plate, name }) => {
    const registrationId = `welcome-smoke-${phone}`;
    await DriverRegistrationSession.deleteOne({ registrationId });
    await Driver.deleteOne({ phone });
    await DriverRegistrationSession.create({
      registrationId,
      phone,
      role: 'driver',
      status: 'personal_saved',
      otpHash: 'x',
      otpExpiresAt: new Date(Date.now() + 3600_000),
      otpVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      personal: { fullName: name, email, passwordHash },
    });
    await onboardingService.saveDriverVehicle({
      registrationId,
      phone,
      vehicle_usage_type: 'private',
      locationId: String(city.service_location_id),
      locationName: 'Indore',
      vehicleTypeId: new mongoose.Types.ObjectId(),
      make: 'Maruti', model: 'Alto', year: '2022', number: plate, color: 'White',
    });
    return onboardingService.completeDriverOnboarding({
      registrationId,
      phone,
      documents: { rc: { secureUrl: 'https://example.test/rc.jpg', identifyNumber: plate, expiryDate: '2030-06-15' } },
    });
  };

  const driverEmail = `new-driver-${stamp}@example.test`;
  const driverPhone = `94${stamp}01`;
  const completion = await registerDriver({ phone: driverPhone, email: driverEmail, plate: `MP09WE${stamp.slice(0, 4)}`, name: 'New Driver' });
  check('Onboarding completes', Boolean(completion?.driver?.id), JSON.stringify(completion));
  check('The driver welcome email arrives', await waitFor(() => sentTo(driverEmail).length > 0));
  const newDriverMail = sentTo(driverEmail)[0];
  check('...with the driver subject, name and driver T&C', newDriverMail?.subject === driverMail.subject && Boolean(newDriverMail?.body.includes('Hi New Driver,')) && /earnings and wallet/i.test(newDriverMail?.body || ''));
  check('...and the driver is marked as mailed', await waitFor(async () => Boolean((await Driver.findById(completion.driver.id).lean())?.welcomeEmailSentAt)));

  const noEmailDriver = await registerDriver({ phone: `94${stamp}02`, email: '', plate: `MP09WF${stamp.slice(0, 4)}`, name: 'No Email Driver' });
  const beforeDriverNoEmail = mailbox.length;
  check('Onboarding without an email completes', Boolean(noEmailDriver?.driver?.id));
  await sleep(1200);
  check('...and sends nothing', mailbox.length === beforeDriverNoEmail);

  // The mail server goes away: onboarding must still complete.
  await new Promise((resolve) => smtp.server.close(resolve));
  const badSmtpEmail = `driver-bad-smtp-${stamp}@example.test`;
  const badSmtpDriver = await registerDriver({ phone: `94${stamp}03`, email: badSmtpEmail, plate: `MP09WG${stamp.slice(0, 4)}`, name: 'Bad Smtp Driver' });
  check('SMTP unreachable: onboarding STILL completes', Boolean(badSmtpDriver?.driver?.id) && Boolean(badSmtpDriver?.token), JSON.stringify(badSmtpDriver).slice(0, 200));
  check('...the driver exists', Boolean(await Driver.findById(badSmtpDriver.driver.id).lean()));
  await sleep(2000);
  check('...and is not marked as mailed (the claim was released)', (await Driver.findById(badSmtpDriver.driver.id).lean()).welcomeEmailSentAt === null);

  process.env.EMAIL_WELCOME_ENABLED = 'false';
  const offDriver = await registerDriver({ phone: `94${stamp}04`, email: `driver-off-${stamp}@example.test`, plate: `MP09WH${stamp.slice(0, 4)}`, name: 'Flag Off Driver' });
  await sleep(800);
  check('Flag off: onboarding completes and the driver is not marked', Boolean(offDriver?.driver?.id) && (await Driver.findById(offDriver.driver.id).lean()).welcomeEmailSentAt === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
