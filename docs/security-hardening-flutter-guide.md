# GoKab Apps — Security Hardening (OTP, Payments, Socket)

> **Audience:** Flutter developer (rider app and driver app), plus whoever deploys the backend.
> **Status:** written against the backend as implemented. Smoke-tested by `Backend/scripts/smoke_security_hardening.mjs` (31 checks).
> **App work needed:** small. Remove any reliance on `debugOtp` / `0000`, and handle a refused socket connection.

## 1. OTP

| Before | Now |
|---|---|
| `debugOtp` in the send-OTP response on every non-production server | `debugOtp` is always `null` unless the server sets `EXPOSE_DEBUG_OTP=true` (ignored in production) |
| Driver phone `6268423925` and rider phone `7610416911` always accepted `0000` | No built-in test phones. A test phone/OTP exists only if the server sets `STATIC_OTP_PHONE` + `STATIC_OTP_CODE` |
| OTP from `Math.random` | OTP from a cryptographic RNG (still 4 digits; admin reset OTP still 6) |

**App changes**
- Do not auto-fill the OTP box from `debugOtp`. Treat the field as optional and usually `null`.
- QA builds that used `0000` need a test phone configured on the QA server (ask backend for the number).

Affected calls (shapes unchanged): `POST /drivers/auth/send-otp`, `POST /drivers/onboarding/send-otp`, `POST /drivers/pooling/onboarding/send-otp`, `POST /users/auth/send-otp`.

## 2. Payments (Razorpay)

No request/response shape changed. What changed is what the server accepts:

- **Fake test payments are refused.** IDs that start with `order_test_` / `pay_test_` (the old "Simulate Success" flow) are accepted only when the server sets `RAZORPAY_ALLOW_TEST_MODE=true`, never in production. Without it, verify calls with such IDs return `400 Invalid payment signature`.
  This affects driver wallet top-up, rider wallet top-up, ride payment, bus booking and pooling booking.
- **Real signature always required** for `…/verify` calls: send `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` exactly as the Razorpay SDK returns them.
- **No silent fallback account.** If the server has no Razorpay keys configured, create-order calls fail with `503` instead of charging through a built-in test account. Show the message and a retry, don't loop.

**App changes**
- Remove/hide any "Simulate payment success" button from release builds; it only works on a server running with `RAZORPAY_ALLOW_TEST_MODE=true`.

## 3. Socket connection (driver app)

The socket handshake now checks the driver account every time it connects, like the REST API already does.

| Driver state | Socket |
|---|---|
| approved | connects |
| pending approval (`approve=false` or `status=pending`) | refused |
| blocked / rejected / inactive | refused |
| deleted | refused |

A refused connection arrives as a `connect_error` with message `Driver account is not approved or has been blocked` (or `Driver account no longer exists`).

**App changes**
- On `connect_error` with either message: stop reconnecting, call `GET /drivers/me` (or log out on 401) and route to the pending/blocked screen. Don't retry in a tight loop.
- Pending drivers should not expect live socket events; poll `GET /drivers/me` on the waiting screen instead.

## 4. Admin panel

`POST/PATCH/DELETE /on-boarding` now require an admin token (`GET` stays public). The admin web panel already sends the token, so nothing changes there.

## 5. Server env (for deploy)

| Variable | Needed for | Default |
|---|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | driver subscription checkout | none — checkout returns 503 if unset |
| `RAZORPAY_WEBHOOK_SECRET` | `POST /drivers/webhooks/razorpay` | none — webhook returns 503 if unset |
| `RAZORPAY_ALLOW_TEST_MODE` | mock orders / `order_test_` payments in dev | off; ignored when `NODE_ENV=production` |
| `EXPOSE_DEBUG_OTP` | `debugOtp` in dev | off; ignored when `NODE_ENV=production` |
| `STATIC_OTP_PHONE`, `STATIC_OTP_CODE`, `USE_DEFAULT_OTP` | QA test login | off |

Wallet / ride / booking payments keep using the keys configured in **Admin > Payment Gateways**.

## Acceptance checklist

- [ ] Send-OTP screens work when `debugOtp` is `null`.
- [ ] No release build shows "Simulate payment success".
- [ ] A real Razorpay payment still verifies (wallet top-up, ride, subscription).
- [ ] A blocked driver sees the blocked screen instead of a reconnect spinner.
