# GoKab Driver App — Backend Update (Oct 2026): Complete Flutter Guide

> **Audience:** Flutter developer (driver app; §1 also touches the rider app).
> **Status:** written against the backend as implemented, every flow below is covered by a smoke script in `Backend/scripts/` (see §10).
> **Base URL:** `/api/v1` (`/api` also works). All driver endpoints need `Authorization: Bearer <driver token>`.
> **Response envelope (unchanged):** success → `{ "success": true, "data": … }`; error → `{ "success": false, "message": "…", "code": "SOME_CODE", "details": {…} | null }`. **Always branch on `code`, never on `message`.**

This one file covers everything. The per-feature guides in `docs/` say the same things in shorter form:
`security-hardening-…`, `secure-unsecure-publish-…`, `earnings-split-…`, `ride-history-upcoming-…`, `banner-publisher-card-…`, `saved-contacts-…`.

---

## Contents

0. [What changed at a glance](#0-what-changed-at-a-glance)
1. [Security changes that affect the app](#1-security-changes-that-affect-the-app)
2. [Secure / Unsecure publish](#2-secure--unsecure-publish)
3. [Earnings split](#3-earnings-split)
4. [Ride history filters & Upcoming rides](#4-ride-history-filters--upcoming-rides)
5. [Profile banner, publisher card, organisation name](#5-profile-banner-publisher-card-organisation-name)
6. [Saved Contacts](#6-saved-contacts)
7. [All error codes](#7-all-error-codes)
8. [Socket changes](#8-socket-changes)
9. [Dart models (copy-paste)](#9-dart-models-copy-paste)
10. [QA checklist & test scripts](#10-qa-checklist--test-scripts)

---

## 0. What changed at a glance

| Area | New / changed endpoint | App work |
|---|---|---|
| OTP | send-OTP responses: `debugOtp` now normally `null` | stop auto-filling OTP from it |
| Payments | fake `order_test_` / `pay_test_` payments refused | hide "Simulate success" in release |
| Socket | blocked / pending / deleted drivers refused at connect | handle `connect_error` |
| Publish | `POST /drivers/network/rides/:id/publish` + `is_secure` | Secure/Unsecure toggle, insufficient-wallet sheet |
| Feed / rides | `is_secure`, `payment_method`, `publisher` images | badge + publisher card |
| Report | `POST /drivers/network/rides/:id/report` | Report button on unsecure rides |
| Earnings | `GET /drivers/earnings/summary`, `GET /drivers/earnings/commissions` | new Earnings screen |
| History | `GET /rides?status=&role=` | Driven / Published tabs, status chips |
| Upcoming | `GET /drivers/rides/upcoming` | new Upcoming screen |
| Banner | `PATCH /drivers/me` + `PATCH /drivers/onboarding/personal` → `bannerImage` | banner picker |
| Org name | `PATCH /drivers/organization` accepts `{ name }` | send `name` (works now) |
| Contacts | `/drivers/contacts…` + assign to contact with split | Contacts screen, assign sheet |
| Category | `GET /drivers/category` → `permissions.can_use_contacts` | gate Contacts UI |

Nothing existing was removed. All new response fields are additive — old screens keep working.

---

## 1. Security changes that affect the app

### 1.1 OTP (driver + rider apps)

Affected (request/response shape unchanged):
`POST /drivers/auth/send-otp`, `POST /drivers/onboarding/send-otp`, `POST /drivers/pooling/onboarding/send-otp`, `POST /users/auth/send-otp`

| Before | Now |
|---|---|
| `session.debugOtp` filled on every non-production server | `null` unless the server sets `EXPOSE_DEBUG_OTP=true` (never in production) |
| Driver `6268423925` / rider `7610416911` always accepted `0000` | no built-in test numbers; QA numbers only via server env `STATIC_OTP_PHONE` + `STATIC_OTP_CODE` |
| 4-digit OTP from `Math.random` | 4-digit OTP from a secure RNG |

**Do:** treat `debugOtp` as optional and usually null. Never auto-submit from it. Ask backend for the QA test number per environment.

### 1.2 Razorpay

No request/response shapes changed. Behaviour:

- `…/verify` calls with `order_test_…` / `pay_test_…` IDs → `400 Invalid payment signature` unless the server runs with `RAZORPAY_ALLOW_TEST_MODE=true` (dev only). Affects driver wallet top-up, rider wallet top-up, ride payment, bus booking, pooling booking.
- Always send `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` exactly as the Razorpay SDK returns them.
- If the server has no Razorpay keys, create-order returns `503` with a message (no silent fallback account). Show the message + Retry.

**Do:** remove/hide any "Simulate payment success" button in release builds.

### 1.3 Socket handshake (driver app)

See [§8](#8-socket-changes). A driver whose account is pending, blocked, rejected, inactive or deleted can no longer connect.

---

## 2. Secure / Unsecure publish

### 2.1 Concept

| | **Secure** (default) | **Unsecure** |
|---|---|---|
| Wallet check at publish | publisher must have `driver_payout` available | none |
| Escrow at accept | publisher freezes payout, acceptor freezes commission | none |
| Payment method | as booked | **forced to `cash`** |
| Split (`owner_commission + driver_payout = total_fare`) | required | required (it's the agreement both see) |
| Settlement on completion | via wallets, needs `collected_by` | none — drivers settle offline |
| If something goes wrong | escrow dispute | **Report** → support ticket, no money moves |

### 2.2 Publish

`POST /drivers/network/rides/:rideId/publish`

```json
{
  "total_fare": 5000,
  "owner_commission": 2000,
  "driver_payout": 3000,
  "expires_in_minutes": 60,
  "is_secure": false
}
```

- `is_secure` optional, default `true`. `isSecure` also accepted. Strings `"false"`, `"0"` work too.
- `201` → the feed-item shape (§2.4) with `is_secure`.

#### Insufficient wallet → offer a choice

```json
{
  "success": false,
  "code": "INSUFFICIENT_WALLET_FOR_PUBLISH",
  "message": "You need ₹3000 available to publish this ride (you have ₹100)",
  "details": { "required": 3000, "available": 100 }
}
```

Show a bottom sheet:

- **Top up ₹(required − available)** → existing wallet top-up flow, then retry publish.
- **Publish as Unsecure** → repeat the same call with `"is_secure": false`. Mention: *"Cash only. Not protected by escrow — settle with the driver directly."*

```dart
Future<FeedItem> publish(String rideId, Split s, {bool secure = true}) async {
  try {
    final r = await dio.post('/drivers/network/rides/$rideId/publish', data: {
      'total_fare': s.totalFare,
      'owner_commission': s.ownerCommission,
      'driver_payout': s.driverPayout,
      'is_secure': secure,
    });
    return FeedItem.fromJson(r.data['data']);
  } on DioException catch (e) {
    final body = e.response?.data;
    if (body?['code'] == 'INSUFFICIENT_WALLET_FOR_PUBLISH') {
      final choice = await showInsufficientWalletSheet(
        required: (body['details']['required'] as num).toDouble(),
        available: (body['details']['available'] as num).toDouble(),
      ); // returns topUp | unsecure | cancel
      if (choice == WalletChoice.unsecure) return publish(rideId, s, secure: false);
      if (choice == WalletChoice.topUp) { await openTopUp(); return publish(rideId, s, secure: secure); }
    }
    rethrow;
  }
}
```

### 2.3 Accept from feed

`POST /drivers/feed/rides/:rideId/accept` →

```json
{ "accepted": true, "rideId": "…", "escrow": "none", "is_secure": false }
```

`escrow` is `"held"` for secure, `"none"` for unsecure. An unsecure ride can be accepted with an empty wallet.

### 2.4 New fields on feed items

`GET /drivers/feed?tab=driver` → `data.results[]`:

| Field | Type | Notes |
|---|---|---|
| `is_secure` | `bool?` | `null` on customer leads (`tab=customer`) |
| `payment_method` | `String` | always `cash` for unsecure |
| `accept.hold_required` | `num` | `0` for unsecure |
| `accept.allowed` | `bool` | true for unsecure even with ₹0 |
| `publisher.profile_image`, `publisher.banner_image` | `String` | see §5 |

Socket `feed:driver:new` payload now also has `is_secure`.

**UI:** badge **"Unsecure · Cash"** on the card + line *"Settle ₹{driver_payout} / ₹{owner_commission} directly with the publisher."*

### 2.5 Network ride payload

`GET /drivers/network/rides` (and assign/create/reject responses) → `publish.is_secure` (bool), `assignment.target_type` (§6), `publisher` (§5).

### 2.6 Completing an unsecure ride

- **Do not** show "Who collected the fare?" — that prompt is only for `escrow.state == "held"`.
- Completing with `paymentMethod: "online"` → `422 UNSECURE_RIDE_CASH_ONLY`. Offer cash only.
- No wallet change for either driver. The acceptor's earnings = `driver_payout`.

> **Also changed:** fleet/self driver-created rides (not published) take **no platform commission**. Cash → no wallet change. Online → driver credited the full fare.

### 2.7 Report (unsecure only)

`POST /drivers/network/rides/:rideId/report`

```json
{ "reason": "Publisher did not pay my share" }
```

`201` → `{ "reported": true, "rideId": "…", "ticketCode": "TIC_…", "money_moved": false }`

| Code | When |
|---|---|
| `NOT_UNSECURE_RIDE` (409) | ride is secure (use escrow dispute) or was never accepted |
| `NOT_RIDE_PARTY` (403) | caller is neither publisher nor acceptor |
| `REASON_REQUIRED` (422) | empty reason (max 1000 chars) |
| `ALREADY_REPORTED` (409) | this driver already reported this ride (one each) |

**UI:** "Report" button on accepted/completed unsecure rides, for both publisher and acceptor. After success show the ticket code: *"Support will contact you. Nothing is refunded automatically."*

---

## 3. Earnings split

### 3.1 Two kinds of earnings

| Kind | Meaning | Per-ride amount |
|---|---|---|
| **Ride earnings** | trips I drove | app booking: `driverEarnings`; taken from feed / assigned as contact: agreed `driver_payout`; own/fleet driver-created ride: full fare |
| **Commission earnings** | rides I published/assigned that someone else completed | `owner_commission − platform_cut` |

Both include unsecure (offline-settled) rides.

### 3.2 Range parameter (both endpoints)

| `range` | Window (IST calendar days) |
|---|---|
| `today` | today |
| `week` *(default)* | last 7 days incl. today |
| `month` | last 30 days incl. today |
| `custom` | `from` + `to` (max 366 days). Bare dates `2026-10-01` = IST days and `to` is **inclusive**. Full ISO timestamps used as-is (`to` exclusive). |

Errors: `422 INVALID_RANGE`, `422 INVALID_DATE_RANGE`.

### 3.3 `GET /drivers/earnings/summary?range=week`

```json
{
  "range": "week",
  "from": "2026-10-09T18:30:00.000Z",
  "to": "2026-10-16T18:30:00.000Z",
  "ride_earnings": 6000,
  "commission_earnings": 3800,
  "total_earnings": 9800,
  "rides": 2,
  "commission_rides": 2,
  "daily": [
    { "date": "2026-10-10", "ride_earnings": 0, "commission_earnings": 0, "rides": 0, "commission_rides": 0 },
    { "date": "2026-10-16", "ride_earnings": 6000, "commission_earnings": 3800, "rides": 2, "commission_rides": 2 }
  ]
}
```

`daily` has **one entry per day** in the window (zeros included), oldest first → plot directly as a stacked bar chart.

### 3.4 `GET /drivers/earnings/commissions?range=month&page=1&limit=20`

```json
{
  "range": "month",
  "from": "…", "to": "…",
  "totals": { "owner_commission": 4000, "platform_cut": 200, "net_earned": 3800, "rides": 2 },
  "results": [
    {
      "ride_id": "…",
      "date": "2026-10-16T09:12:00.000Z",
      "pickup": "Vijay Nagar, Indore",
      "drop": "MP Nagar, Bhopal",
      "total_fare": 5000,
      "driver_payout": 3000,
      "owner_commission": 2000,
      "platform_cut": 200,
      "net_earned": 1800,
      "acceptor": { "id": "…", "name": "Vikas Singh", "phone": "9000000003" },
      "is_secure": true,
      "settlement": "escrow",
      "settlement_label": "Settled via wallet",
      "escrow_state": "settled",
      "collected_by": "platform"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 }
}
```

- Newest first; `totals` cover the whole range (not just the page). `limit` max 100.
- `platform_cut > 0` only for a secure ride paid online.
- Unsecure rows: `settlement: "offline"`, `settlement_label: "Settled offline"`, `platform_cut: 0` → show the label.
- `escrow_state: "disputed"` → show an "Under review" chip.

### 3.5 Suggested screen

```
┌ Earnings ─────────────── [Today|Week|Month|Custom] ┐
│  Total ₹9,800                                       │
│  Rides ₹6,000 (2)      Commission ₹3,800 (2)        │
│  ▁▂▅█ stacked daily bars (rides / commission)       │
├ Commission rides ───────────────────────────────────┤
│  16 Oct · Vikas Singh · ₹5,000 fare                 │
│  Payout ₹3,000 · Your cut ₹2,000 − ₹200 = ₹1,800    │
│  [Settled via wallet]                               │
└─────────────────────────────────────────────────────┘
```

Wallet history rows for escrow now carry `metadata.kind`: `owner_commission`, `driver_payout`, `cancel_penalty`, `owner_commission_reversal`, `driver_payout_reversal` — use for labels only, not for earnings maths.

---

## 4. Ride history filters & Upcoming rides

### 4.1 `GET /rides` — new filters

| Param | Values | Default | Meaning |
|---|---|---|---|
| `status` | `completed`, `cancelled`, `all` | `all` | outcome |
| `role` *(driver only)* | `driven`, `published`, `all` | `driven` | my side of the ride |

Existing params still work: `page`, `limit` (max 100), `category`, `from`, `to`.

- `driven` → rides I drove (= old behaviour when `role` is omitted).
- `published` → rides I created that someone else drove (feed, fleet, contact), incl. ones cancelled before anyone drove.
- `all` → both.

Errors: `422 INVALID_STATUS`, `422 INVALID_ROLE`.

```
GET /rides?role=published&status=completed&page=1&limit=20
```

New fields per row (driver tokens):

| Field | Type | Notes |
|---|---|---|
| `ride_role` | `driven` / `published` | |
| `origin` | `customer_app` / `driver_created` | |
| `is_secure` | `bool?` | `null` for app bookings |
| `driven_by` | `{id,name,phone,vehicleNumber}?` | on `published` rows someone drove |
| `split` | `{driver_payout, owner_commission}?` | when the ride was taken from feed / by a contact |

**UI:** tabs **Driven | Published**, chips **All | Completed | Cancelled**.

### 4.2 `GET /drivers/rides/upcoming?page=1&limit=20`

Rides **assigned to me that I haven't started yet**:

- scheduled app bookings I accepted → `source: "scheduled"`
- every driver-created ride handed to me (fleet assign, feed accept, contact assign), scheduled or immediate → `source: "network"`

⚠️ Different from `GET /drivers/scheduled-rides`, which lists **open** rides nobody has taken.

Order: immediate rides first, then soonest `scheduledAt`.

```json
{
  "results": [
    {
      "id": "…",
      "origin": "driver_created",
      "source": "network",
      "status": "accepted",
      "liveStatus": "accepted",
      "scheduledAt": "2026-10-18T04:30:00.000Z",
      "is_overdue": false,
      "serviceType": "ride",
      "pickup": { "address": "Vijay Nagar, Indore", "coordinates": [75.8577, 22.7196] },
      "drop": { "address": "MP Nagar, Bhopal", "coordinates": [77.4126, 23.2599] },
      "fare": 5000,
      "amount_for_you": 3000,
      "paymentMethod": "cash",
      "notes": "",
      "customer": { "name": "Rakesh", "phone": "9100000099" },
      "assignment": {
        "mode": "published",
        "assigned_at": "…",
        "acknowledged_at": null,
        "assigned_by": { "driver_id": "…", "name": "Ramesh Verma", "phone": "9000000001", "org_name": "Ram Travels" }
      },
      "is_secure": false,
      "escrow_state": "none",
      "publisher": { "id": "…", "name": "Ramesh Verma", "org_name": "Ram Travels", "category": "prime", "rating": 4.8, "profile_image": "…", "banner_image": "…" }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

- `amount_for_you` = agreed payout when I took it from the feed / as a contact; else `null` → show `fare`.
- `is_overdue: true` → scheduled time passed and still not started; highlight red.
- `assignment.acknowledged_at == null` on a network ride → show **Confirm** (`POST /drivers/network/rides/:id/acknowledge`) and **Decline** (`POST /drivers/network/rides/:id/reject-assignment`).
- `publisher` is `null` for app bookings.

---

## 5. Profile banner, publisher card, organisation name

### 5.1 Banner rules

- JPEG / PNG / WebP, **max 5 MB**, sent as a **data URL** (`data:image/jpeg;base64,…`).
- Server **keeps your aspect ratio** (no crop), re-encodes to WebP, caps width at **1600 px** (never upscales), fixes EXIF rotation.
- Stored value is always a server URL.

### 5.2 Set / change — `PATCH /drivers/me`

```json
{ "bannerImage": "data:image/jpeg;base64,/9j/4AAQ…" }
```

`banner_image` also accepted. Response = full `GET /drivers/me` payload incl. `bannerImage`.

| You send | Result |
|---|---|
| image data URL | uploaded, URL stored |
| the URL from `GET /me` | unchanged (safe to resend the whole form) |
| `""` | banner removed |
| field omitted | unchanged |
| other URL / GIF / video / corrupt bytes | `422 INVALID_BANNER` |
| > 5 MB | `400 IMAGE_TOO_LARGE` |

```dart
Future<String> uploadBanner(File file) async {
  final bytes = await file.readAsBytes();
  if (bytes.length > 5 * 1024 * 1024) throw 'Banner must be 5 MB or smaller';
  final mime = lookupMimeType(file.path) ?? 'image/jpeg'; // package:mime
  final dataUrl = 'data:$mime;base64,${base64Encode(bytes)}';
  final r = await dio.patch('/drivers/me', data: {'bannerImage': dataUrl});
  return r.data['data']['bannerImage'] as String;
}
```

Crop UI is optional — whatever shape you send is what everyone sees. Recommended: let the user pick any wide image; preview in a fixed-height header with `BoxFit.cover`.

### 5.3 At registration — `PATCH /drivers/onboarding/personal`

Add optional `"bannerImage": "<data URL>"` next to `fullName`, `email`, `gender`, `password`. Response `personal.bannerImage` = hosted URL. Re-saving the step without the field keeps it. On completion it becomes the driver's banner. (Ignored for owner registration.)

### 5.4 Publisher card

```json
"publisher": {
  "id": "…",
  "name": "Ramesh Verma",
  "org_name": "Ram Travels",
  "category": "prime",
  "rating": 4.8,
  "profile_image": "https://…/drivers/….webp",
  "banner_image": "https://…/banners/….webp"
}
```

| Endpoint | Where |
|---|---|
| `GET /drivers/feed?tab=driver` | `results[].publisher` (now with images) |
| `GET /drivers/network/rides` | `results[].publisher` (new) |
| `GET /drivers/rides/upcoming` | `results[].publisher` (network rows) |
| `GET /rides/:rideId` | `data.publisher` + `data.is_secure` (driver-created rides only) |

Either image may be `""` → fall back to initials / default header.

### 5.5 Organisation name

`PATCH /drivers/organization`

```json
{ "name": "Ram Tours" }
```

(`company_name` / `companyName` still work.) Previously `name` was silently ignored while returning 200 — now it renames.
Response: `{ "id", "company_name", "name", "owner_name" }`. Blank → `422 INVALID_ORG_NAME`. Shows immediately as `publisher.org_name`.

---

## 6. Saved Contacts

### 6.1 Permission

`GET /drivers/category` → `data.permissions.can_use_contacts`

| Plan | Default |
|---|---|
| Prime / Middle (Elite / Pro) | ✅ on |
| Lower (Basic) | 🔒 locked |

When locked: lists still load with `locked: true` (data is never deleted on downgrade) → show greyed out + **Upgrade** CTA. Add and assign are refused; delete is always allowed.

### 6.2 Worked with — `GET /drivers/contacts/worked-with?page=1&limit=20`

Everyone I shared a ride with (one created it, the other drove it), most recent first.

```json
{
  "locked": false,
  "results": [
    {
      "driver": {
        "id": "…", "name": "Mohan Lal", "phone": "9000000004",
        "profile_image": "", "vehicle_number": "MP09AB1234", "vehicle_type": "car",
        "rating": 4.6, "category": "lower", "active": true
      },
      "rides_together": 3,
      "they_drove_for_me": 2,
      "i_drove_for_them": 1,
      "last_ride_at": "2026-10-16T09:12:00.000Z",
      "last_ride_id": "…",
      "is_saved": false,
      "contact_id": null
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### 6.3 Saved list — `GET /drivers/contacts?page=1&limit=50`

```json
{
  "locked": false,
  "results": [
    { "id": "<contactId>", "nickname": "Mohan bhai", "source_ride_id": "…", "driver": { …same card… }, "createdAt": "…" }
  ],
  "pagination": { … }
}
```

### 6.4 Save — `POST /drivers/contacts`

```json
{ "driver_id": "…", "nickname": "Mohan bhai", "source_ride_id": "…optional…" }
```

- `201` new / `200` already saved (nickname updated if sent) → `{ "created": true|false, "contact": {…} }`
- Only drivers you **shared a ride** with can be saved.

| Code | When |
|---|---|
| `CONTACTS_LOCKED` (403) | plan doesn't include contacts |
| `NO_SHARED_RIDE` (403) | never shared a ride, or `source_ride_id` isn't one you shared |
| `INVALID_CONTACT` (422) | yourself |
| `DRIVER_NOT_FOUND` (404) | driver deleted / unknown |
| `INVALID_ID` (400) | malformed id |

### 6.5 Remove — `DELETE /drivers/contacts/:contactId`

`{ "deleted": true, "id": "…" }` · `404 CONTACT_NOT_FOUND`. Allowed even while locked.

### 6.6 Assign a ride to a contact

Same endpoints as fleet assign:
`POST /drivers/network/rides/:rideId/assign`, `POST …/reassign`, or `assign_to_driver_id` on `POST /drivers/network/rides`.

A contact is outside your organisation, so the body carries a **split** (like publishing):

```json
{
  "driverId": "<contact driver id>",
  "driver_payout": 3000,
  "owner_commission": 2000,
  "is_secure": true
}
```

- `driver_payout` **required** for a contact (`422 SPLIT_REQUIRED`).
- `owner_commission` defaults to `fare − driver_payout`; `total_fare` defaults to the ride fare; must add up (`422 INVALID_SPLIT`).
- **Secure** (default): you freeze the payout, the contact freezes the commission; settled at completion with `collected_by` (same as published).
- **Unsecure**: no holds, cash only, Report available.
- **Self / fleet** assign: unchanged — no split, no escrow.

Response: network ride with `assignment.target_type` = `"self" | "fleet" | "contact"`, `publish` split, `publish.is_secure`, `escrow.state`.

| Error | Meaning | UI |
|---|---|---|
| `402 INSUFFICIENT_WALLET_FOR_PUBLISH` `{required, available}` | **you** can't fund the payout | Top-up / Assign as Unsecure |
| `402 CONTACT_INSUFFICIENT_WALLET` | **contact** can't fund their side (balance hidden) | Assign as Unsecure |
| `403 DRIVER_NOT_IN_FLEET` | you have fleet rights, driver is neither fleet nor contact | — |
| `403 CATEGORY_NOT_ALLOWED` | no fleet rights and not a saved contact | Upgrade |
| `409 DRIVER_BUSY` | contact on another ride / clashing schedule | pick another |

**Assign sheet:** sections **Me · My fleet · Saved contacts**. Choosing a contact opens split fields (payout prefilled e.g. 60% of fare) + Secure/Unsecure toggle.

### 6.7 Contact's side & undo

- Contact sees it in **Upcoming** (`amount_for_you` = payout, `assigned_by` = you) → **Confirm** / **Decline**.
- Decline returns both escrow holds; **no penalty** for a contact.
- You can **unassign / reassign** a secure contact assignment — holds are returned.
- A ride a driver **took from the feed**: you still can't unassign it; if *they* decline it, escrow is released **with the admin's cancellation penalty** (same as cancelling) and the ride comes off the feed so you can publish/assign again.

---

## 7. All error codes

| Code | HTTP | Endpoint(s) | App action |
|---|---|---|---|
| `INSUFFICIENT_WALLET_FOR_PUBLISH` | 402 | publish, contact assign | Top-up / Unsecure sheet |
| `CONTACT_INSUFFICIENT_WALLET` | 402 | contact assign | suggest Unsecure |
| `INVALID_SPLIT` | 422 | publish, contact assign | fix amounts |
| `SPLIT_REQUIRED` | 422 | contact assign | ask payout |
| `UNSECURE_RIDE_CASH_ONLY` | 422 | ride status → completed | cash only |
| `NOT_UNSECURE_RIDE` | 409 | report | use dispute |
| `NOT_RIDE_PARTY` | 403 | report | hide button |
| `REASON_REQUIRED` | 422 | report | validate input |
| `ALREADY_REPORTED` | 409 | report | show "already reported" |
| `INVALID_RANGE` | 422 | earnings | — |
| `INVALID_DATE_RANGE` | 422 | earnings, `/rides` | — |
| `INVALID_STATUS` | 422 | `/rides` | — |
| `INVALID_ROLE` | 422 | `/rides` | — |
| `INVALID_BANNER` | 422 | `/drivers/me`, onboarding personal | "Use a JPG/PNG/WebP" |
| `IMAGE_TOO_LARGE` | 400 | banner | "Max 5 MB" |
| `INVALID_ORG_NAME` | 422 | organization | required field |
| `CONTACTS_LOCKED` | 403 | add contact | Upgrade CTA |
| `NO_SHARED_RIDE` | 403 | add contact | "Only drivers you've ridden with" |
| `INVALID_CONTACT` | 422 | add contact | — |
| `CONTACT_NOT_FOUND` | 404 | delete contact | refresh list |
| `DRIVER_NOT_IN_FLEET` | 403 | assign | — |
| `CATEGORY_NOT_ALLOWED` | 403 | assign, create | Upgrade CTA |

Generic Dio helper:

```dart
String? apiCode(Object e) =>
    e is DioException ? (e.response?.data is Map ? e.response!.data['code'] as String? : null) : null;
Map<String, dynamic>? apiDetails(Object e) =>
    e is DioException && e.response?.data is Map ? e.response!.data['details'] as Map<String, dynamic>? : null;
```

---

## 8. Socket changes

### 8.1 Handshake

Connect as before (`auth: { token }`). The server now re-checks the driver account on **every** connect:

| Driver state | Result |
|---|---|
| approved | connects |
| pending (`approve=false` / `status=pending`) | `connect_error` |
| blocked / rejected / inactive | `connect_error` |
| deleted | `connect_error` |

Messages: `Driver account is not approved or has been blocked` · `Driver account no longer exists`.

```dart
socket.onConnectError((err) async {
  final msg = err is Map ? err['message'] : err.toString();
  if (msg.contains('not approved') || msg.contains('blocked') || msg.contains('no longer exists')) {
    socket.dispose();                        // stop the reconnect loop; recreate after re-login
    final me = await api.getMe().catchError((_) => null); // 401 → logout
    me == null ? logout() : routeToAccountStatus(me);     // pending / blocked screen
  }
});
```

Pending drivers should **poll `GET /drivers/me`** on the waiting screen instead of expecting socket events.

### 8.2 Payload additions

| Event | New field |
|---|---|
| `feed:driver:new` | `is_secure` |
| `network:ride:taken` (to publisher) | `is_secure`; `held` is `0` for unsecure |

---

## 9. Dart models (copy-paste)

```dart
double _d(dynamic v) => v == null ? 0 : (v as num).toDouble();
DateTime? _dt(dynamic v) => v == null ? null : DateTime.parse(v as String).toLocal();

class PublisherCard {
  final String id, name, orgName, category, profileImage, bannerImage;
  final double rating;
  PublisherCard.fromJson(Map<String, dynamic> j)
      : id = j['id'] ?? '',
        name = j['name'] ?? '',
        orgName = j['org_name'] ?? '',
        category = j['category'] ?? 'lower',
        rating = _d(j['rating']),
        profileImage = j['profile_image'] ?? '',
        bannerImage = j['banner_image'] ?? '';
  static PublisherCard? maybe(dynamic j) => j == null ? null : PublisherCard.fromJson(j);
}

class EarningsDay {
  final String date; // YYYY-MM-DD (IST)
  final double rideEarnings, commissionEarnings;
  final int rides, commissionRides;
  EarningsDay.fromJson(Map<String, dynamic> j)
      : date = j['date'],
        rideEarnings = _d(j['ride_earnings']),
        commissionEarnings = _d(j['commission_earnings']),
        rides = j['rides'] ?? 0,
        commissionRides = j['commission_rides'] ?? 0;
}

class EarningsSummary {
  final String range;
  final double rideEarnings, commissionEarnings, totalEarnings;
  final int rides, commissionRides;
  final List<EarningsDay> daily;
  EarningsSummary.fromJson(Map<String, dynamic> j)
      : range = j['range'],
        rideEarnings = _d(j['ride_earnings']),
        commissionEarnings = _d(j['commission_earnings']),
        totalEarnings = _d(j['total_earnings']),
        rides = j['rides'] ?? 0,
        commissionRides = j['commission_rides'] ?? 0,
        daily = (j['daily'] as List).map((e) => EarningsDay.fromJson(e)).toList();
}

class CommissionRow {
  final String rideId, settlement, settlementLabel, escrowState;
  final String? collectedBy;
  final DateTime? date;
  final String pickup, drop, acceptorId, acceptorName, acceptorPhone;
  final double totalFare, driverPayout, ownerCommission, platformCut, netEarned;
  final bool isSecure;
  CommissionRow.fromJson(Map<String, dynamic> j)
      : rideId = j['ride_id'],
        date = _dt(j['date']),
        pickup = j['pickup'] ?? '',
        drop = j['drop'] ?? '',
        totalFare = _d(j['total_fare']),
        driverPayout = _d(j['driver_payout']),
        ownerCommission = _d(j['owner_commission']),
        platformCut = _d(j['platform_cut']),
        netEarned = _d(j['net_earned']),
        acceptorId = j['acceptor']?['id'] ?? '',
        acceptorName = j['acceptor']?['name'] ?? '',
        acceptorPhone = j['acceptor']?['phone'] ?? '',
        isSecure = j['is_secure'] ?? true,
        settlement = j['settlement'] ?? 'escrow',
        settlementLabel = j['settlement_label'] ?? '',
        escrowState = j['escrow_state'] ?? 'none',
        collectedBy = j['collected_by'];
}

class UpcomingRide {
  final String id, origin, source, status, liveStatus, paymentMethod, notes;
  final DateTime? scheduledAt;
  final bool isOverdue;
  final bool? isSecure;
  final double fare;
  final double? amountForYou;
  final String customerName, customerPhone, pickupAddress, dropAddress;
  final DateTime? acknowledgedAt;
  final Map<String, dynamic>? assignedBy;
  final PublisherCard? publisher;
  UpcomingRide.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        origin = j['origin'] ?? '',
        source = j['source'] ?? '',
        status = j['status'] ?? '',
        liveStatus = j['liveStatus'] ?? '',
        scheduledAt = _dt(j['scheduledAt']),
        isOverdue = j['is_overdue'] ?? false,
        pickupAddress = j['pickup']?['address'] ?? '',
        dropAddress = j['drop']?['address'] ?? '',
        fare = _d(j['fare']),
        amountForYou = j['amount_for_you'] == null ? null : _d(j['amount_for_you']),
        paymentMethod = j['paymentMethod'] ?? 'cash',
        notes = j['notes'] ?? '',
        customerName = j['customer']?['name'] ?? '',
        customerPhone = j['customer']?['phone'] ?? '',
        acknowledgedAt = _dt(j['assignment']?['acknowledged_at']),
        assignedBy = j['assignment']?['assigned_by'],
        isSecure = j['is_secure'],
        publisher = PublisherCard.maybe(j['publisher']);
  bool get needsConfirm => source == 'network' && acknowledgedAt == null;
}

class DriverCard {
  final String id, name, phone, profileImage, vehicleNumber, vehicleType, category;
  final double rating;
  final bool active;
  DriverCard.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        name = j['name'] ?? '',
        phone = j['phone'] ?? '',
        profileImage = j['profile_image'] ?? '',
        vehicleNumber = j['vehicle_number'] ?? '',
        vehicleType = j['vehicle_type'] ?? '',
        rating = _d(j['rating']),
        category = j['category'] ?? 'lower',
        active = j['active'] ?? true;
}

class WorkedWith {
  final DriverCard driver;
  final int ridesTogether, theyDroveForMe, iDroveForThem;
  final DateTime? lastRideAt;
  final bool isSaved;
  final String? contactId;
  WorkedWith.fromJson(Map<String, dynamic> j)
      : driver = DriverCard.fromJson(j['driver']),
        ridesTogether = j['rides_together'] ?? 0,
        theyDroveForMe = j['they_drove_for_me'] ?? 0,
        iDroveForThem = j['i_drove_for_them'] ?? 0,
        lastRideAt = _dt(j['last_ride_at']),
        isSaved = j['is_saved'] ?? false,
        contactId = j['contact_id'];
}

class SavedContact {
  final String id, nickname;
  final String? sourceRideId;
  final DriverCard? driver;
  SavedContact.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        nickname = j['nickname'] ?? '',
        sourceRideId = j['source_ride_id'],
        driver = j['driver'] == null ? null : DriverCard.fromJson(j['driver']);
}

/// Wraps list responses that carry a `locked` flag (contacts endpoints).
class LockableList<T> {
  final bool locked;
  final List<T> results;
  LockableList(Map<String, dynamic> j, T Function(Map<String, dynamic>) parse)
      : locked = j['locked'] ?? false,
        results = (j['results'] as List).map((e) => parse(e)).toList();
}
```

Feed item: add to your existing model

```dart
final bool? isSecure = json['is_secure'];            // null on customer leads
final String paymentMethod = json['payment_method'] ?? 'cash';
final PublisherCard? publisher = PublisherCard.maybe(json['publisher']);
```

Network ride: add `json['publish']['is_secure']`, `json['assignment']['target_type']`, `PublisherCard.maybe(json['publisher'])`.
Driver profile (`GET /drivers/me`): add `bannerImage`.
Category: add `permissions.can_use_contacts`.

---

## 10. QA checklist & test scripts

### App acceptance checklist

**Security**
- [ ] Send-OTP screens work with `debugOtp == null`; nothing auto-fills from it.
- [ ] No "Simulate payment success" in release builds.
- [ ] Real Razorpay payment verifies (wallet top-up, ride, subscription).
- [ ] Blocked / pending driver lands on the status screen, no reconnect spinner loop.

**Secure / Unsecure**
- [ ] Publish sheet: Secure/Unsecure toggle (default Secure).
- [ ] `INSUFFICIENT_WALLET_FOR_PUBLISH` → Top-up or Publish as Unsecure.
- [ ] "Unsecure · Cash" badge on feed, My Rides, ride detail.
- [ ] Unsecure accept works with ₹0 wallet.
- [ ] Unsecure completion skips "who collected" and offers cash only.
- [ ] Report button → ticket code shown; second report shows "already reported".

**Earnings**
- [ ] Totals + daily stacked chart for Today / Week / Month / Custom.
- [ ] Commission list with split, acceptor, platform cut; "Settled offline" on unsecure rows.

**History / Upcoming**
- [ ] Driven / Published tabs; Completed / Cancelled chips.
- [ ] Published rows show who drove + split.
- [ ] Upcoming list: immediate first, overdue highlighted, Confirm / Decline where needed.

**Banner / profile**
- [ ] Banner picker on registration personal step and Edit Profile; wide and tall images display uncropped.
- [ ] Publisher card shows photo + banner with fallbacks (feed, network rides, upcoming, ride detail).
- [ ] Rename organisation with `{ name }` → new name shows on cards.

**Contacts**
- [ ] Contacts screen: Worked-with + Saved; locked state with Upgrade CTA.
- [ ] Save / nickname / remove.
- [ ] Assign sheet: Me · Fleet · Contacts; contact → split + Secure/Unsecure.
- [ ] Handles `INSUFFICIENT_WALLET_FOR_PUBLISH` and `CONTACT_INSUFFICIENT_WALLET`.
- [ ] Contact can Confirm / Decline from Upcoming.

### Backend smoke scripts (for backend QA)

| Feature | Script | Checks |
|---|---|---|
| Security | `Backend/scripts/smoke_security_hardening.mjs` | 31 |
| Secure / Unsecure | `Backend/scripts/smoke_secure_unsecure.mjs` | 52 |
| Earnings | `Backend/scripts/smoke_earnings_split.mjs` | 30 |
| History / Upcoming | `Backend/scripts/smoke_history_upcoming.mjs` | 34 |
| Banner / publisher / org | `Backend/scripts/smoke_banner_publisher.mjs` | 28 |
| Saved Contacts | `Backend/scripts/smoke_saved_contacts.mjs` | 48 |

Each script's header explains how to run it against a **local** backend + local test database. Never point them at production.
