# GoKab Apps — Welcome + Terms & Conditions Email

> **Audience:** Flutter developer (rider app and driver app).
> **Status:** written against the backend as implemented. **The feature is switched off on the server for now** (flag `EMAIL_WELCOME_ENABLED`), so nothing is emailed yet.
> **App work needed:** none required. This guide explains what the backend will do once it is switched on, so the signup and onboarding screens can set the right expectations.

## 1. What happens

| App | Moment | Email sent |
|---|---|---|
| Rider app | `POST /users/signup` succeeds (account created) | Welcome email with the **rider** Terms & Conditions |
| Driver app | Driver registration is completed (`completeOnboarding`) | Welcome email with the **driver** Terms & Conditions |

- The two emails are different templates: different subject, different wording, different T&C.
- The driver email says the registration was **received** and that the team will verify the documents. It does **not** say the account is approved, because new drivers start as pending.
- The email carries a link to the full Terms & Conditions when the server has one configured.

## 2. No API changes

No new endpoints, no new request fields, no new response fields. Signup and onboarding return exactly what they returned before, in the same time (the email is sent in the background after the response).

## 3. Rules the app should know about

- **An email address is needed for the email to be sent.** If the rider leaves the email blank, or the driver doesn't enter one, nothing is sent and nothing fails. The backend also skips an address that isn't a valid email format.
- **Registration never depends on the email.** Even if the mail server is down or misconfigured, signup / onboarding still succeeds and the app gets its normal success response. The app can never see an "email failed" error from these calls.
- **One email per account.** The backend records when it sent the welcome email, so the same account is not emailed twice (for example when a deleted account signs up again). A failed send is not recorded, so it is not counted as sent.
- **Not instant, not guaranteed.** The email is a background best-effort send. Do not show "email sent" confirmations as if they were guaranteed, and do not gate any screen on it.

## 4. Suggested (optional) app changes

These are small copy / validation tweaks, not requirements:

1. **Collect a real email.** If the rider signup treats email as optional, consider a short hint such as "We'll email you the Terms & Conditions." Use the same email format check the backend uses (`name@domain.tld`, no spaces).
2. **Driver registration:** the email field on the personal-details step is what the driver welcome email goes to. A typo means the driver never receives it, so ask them to double-check it.
3. **Still show T&C in the app.** The email is a copy for the user's records. Keep the in-app accept-terms checkbox / link as it is.

## 5. Testing once it is switched on

- Sign up a new rider with a real inbox: one welcome email with the rider T&C arrives shortly after the account is created.
- Register a new driver with a real inbox: one email with the driver wording and driver T&C arrives after the final submit.
- Sign up with no email: signup succeeds, no email.
- Repeating a signup for an account that already received the email does not send a second one.

## What did **not** change

- Login, OTP, signup and onboarding endpoints and their responses.
- Owner / vendor registration: it does **not** send this email (only riders and drivers do).
- Admin forgot-password mail: untouched.

## Acceptance checklist

- [ ] Rider signup with and without an email works exactly as before.
- [ ] Driver registration with and without an email works exactly as before.
- [ ] No screen waits for, or shows an error about, the welcome email.
- [ ] (When enabled) both emails arrive, with the right subject and the right T&C for the role.
