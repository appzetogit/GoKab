# GoKab Driver App: Backend Gaps P1–P7, Payment Changes and Profile Photos (Flutter Guide)

> **Audience:** Flutter developer (driver app).
> **Status:** live on `gokab.in` since 19 Oct 2026 (`master` @ `3141acb`). Every flow below is covered by a smoke script in `Backend/scripts/` (see §12).
> **Base URL:** `/api/v1` (`/api` also works). Driver endpoints need `Authorization: Bearer <driver token>`.
> **Response envelope (unchanged):** success → `{ "success": true, "data": … }`; error → `{ "success": false, "message": "…", "code": "SOME_CODE", "details": {…} | null }`. **Always branch on `code`, never on `message`.**

This guide covers the "Backend changes needed by the driver app" list (P1–P7), the profile-photo fix, and the payment rules that changed alongside them. It adds to `driver-app-backend-update-oct-2026-flutter-guide.md`. Where the two disagree, **this guide wins**; the places are called out with **Changed:**.

---

## Contents

0. [What changed at a glance](#0-what-changed-at-a-glance)
1. [Profile photo: URLs, never base64](#1-profile-photo-urls-never-base64)
2. [P1: Publisher is told when their ride is taken](#2-p1-publisher-is-told-when-their-ride-is-taken)
3. [P2: Push when a published ride expires](#3-p2-push-when-a-published-ride-expires)
4. [P3: Notification read state](#4-p3-notification-read-state)
5. [P4: Escrow on the active ride, and completing a ride](#5-p4-escrow-on-the-active-ride-and-completing-a-ride)
6. [P5: Profile photo at registration](#6-p5-profile-photo-at-registration)
7. [P6: Lead chats inbox](#7-p6-lead-chats-inbox)
8. [P7: Profile, documents, vehicles, earnings](#8-p7-profile-documents-vehicles-earnings)
9. [Push `type` values](#9-push-type-values)
10. [All new error codes](#10-all-new-error-codes)
11. [Dart models (copy-paste)](#11-dart-models-copy-paste)
12. [QA checklist & test scripts](#12-qa-checklist--test-scripts)

---

## 0. What changed at a glance

| Area | Endpoint / event | App work |
|---|---|---|
| Profile photo | `PATCH /drivers/me` → `profileImage` is now always a URL | none required; handle `INVALID_PROFILE_IMAGE` |
| P1 | push `network_ride_taken`; socket `network:ride:taken` + `acceptor` | add push route; show acceptor in toast |
| P2 | push `network_ride_expired` | add push route |
| P3 | `PATCH /drivers/notifications/:id/read`, `PATCH /drivers/notifications/read-all`; `isRead`/`readAt` on list | wire read state |
| P4 | `GET /rides/active/me` → `origin`, `is_secure`, `escrow` | show "who collected?" from `escrow.state` |
| Payments | payment method locked after accept; platform payout waits for rider payment | send the ride's own method; read `details.options` |
| P5 | `PATCH /drivers/onboarding/personal` → `profileImage` | add photo picker to registration |
| P6 | `GET /drivers/lead-conversations` new fields; `sender` on lead events | unread dots, names in toasts |
| P7 | `total_rides`, `gender`, document re-upload, vehicle details, `online_minutes`, weekly goal | show the hidden fields |

Nothing was removed. All new response fields are additive.

---

## 1. Profile photo: URLs, never base64

### 1.1 The bug

`PATCH /drivers/me` used to store whatever string the app sent as `profileImage`, including a full `data:image/jpeg;base64,…` string. `GET /drivers/me` then returned that base64:
- every profile load downloaded the whole photo, and
- Android's `ImageDecoder` failed on some of these JPEGs ("Failed to create image decoder … unimplemented"), for example driver Rudra.

### 1.2 Now

`profileImage` (and `bannerImage`) in `GET /drivers/me` is **always** an http(s) URL or `""`:

```json
"profileImage": "https://gokab.in/api/images/drivers/2026/10/3f6c2a9e-8b1d-4c7a-9e2f-5d4b1a7c6e90.webp"
```

Load it with `Image.network` / `CachedNetworkImage`. **No app change is needed** for showing it.

> **Image URLs are under `/api/images/`.** `https://gokab.in/images/…` returned the website's HTML page instead of the image (nginx sends only `/api/*` to the backend), which is why every uploaded image failed to decode. All uploads (photos, documents, vehicle images) are now served and returned as `https://gokab.in/api/images/…`, and URLs already stored are rewritten on the server. Don't build image URLs in the app; always use the URL the API returns.

### 1.3 Setting the photo: `PATCH /drivers/me`

```json
{ "profileImage": "data:image/jpeg;base64,/9j/4AAQ…" }
```

| What you send | Result |
|---|---|
| JPEG / PNG / WebP **data URL**, ≤ 5 MB | decoded, re-encoded to WebP, hosted; the URL is stored and returned |
| the URL you got from `GET /drivers/me` | kept as-is (safe to echo back) |
| `""` | photo cleared |
| any other URL, GIF, a truncated/corrupt image | `422 INVALID_PROFILE_IMAGE`; **the previous photo stays** |
| > 5 MB | `400 IMAGE_TOO_LARGE` with `details.max_bytes` |

- Response: the full profile (same shape as `GET /drivers/me`), with the new `profileImage` URL.
- Compress before upload (e.g. `image_picker` with `imageQuality: 80`, `maxWidth: 1024`). The server crops to a 500×500 square.
- The app may keep sending base64. **Don't send URLs from other hosts.**

### 1.4 Old photos

Drivers whose photo was saved as base64 before this fix are converted on the server by a one-off migration. Unreadable ones are cleared to `""`. Until a driver is converted, `profileImage` may still start with `data:`. Keep a fallback: if `Image.memory`/`Image.network` fails, show the initials avatar instead of crashing.

---

## 2. P1: Publisher is told when their ride is taken

Fires when another driver accepts a ride you published to the feed.

### 2.1 Push (to the publisher)

| Field | Value |
|---|---|
| title | `Your ride was accepted` |
| body | `<acceptor name> accepted <pickup> → <drop>` |
| `data.type` | `network_ride_taken` |
| `data.rideId` | ride id |
| `data.acceptorDriverId` | acceptor's driver id |
| `data.acceptorName` | acceptor's name |
| `data.isSecure` | `"true"` / `"false"` (**string**: FCM data values are strings) |

Tap → **Network Rides**.

### 2.2 Socket `network:ride:taken` (room `publisher:<yourId>`)

```json
{
  "rideId": "…",
  "driverId": "…",
  "held": 3000,
  "is_secure": true,
  "acceptor": { "id": "…", "name": "Vikas Singh", "phone": "9000000003", "vehicleNumber": "MP09AB1234" }
}
```

`held` is the payout frozen from your wallet (0 for unsecure). Any `acceptor` field can be `""`.

---

## 3. P2: Push when a published ride expires

| Field | Value |
|---|---|
| title | `Your published ride expired` |
| body | `Your published ride expired with no taker. Republish or assign it.` |
| `data.type` | `network_ride_expired` |
| `data.rideId` | ride id |

Socket `network:ride:expired` → `{ "rideId": "…" }` (unchanged). Tap → **Network Rides**.

---

## 4. P3: Notification read state

Read state is stored **per driver** on the server, so it survives reinstalls and device changes. Owner accounts use the same routes.

### 4.1 List: `GET /drivers/notifications`

```json
{
  "results": [
    {
      "id": "…",
      "isRead": false,
      "readAt": null,
      "title": "Diwali bonus",
      "body": "…",
      "image": "",
      "sendTo": "drivers",
      "serviceLocationName": "Indore",
      "sentAt": "2026-10-18T10:00:00.000Z",
      "createdAt": "2026-10-18T10:00:00.000Z"
    }
  ]
}
```

Newest first, at most 100. Unread badge = count of `isRead == false`.

### 4.2 Mark one read: `PATCH /drivers/notifications/:id/read`

No body. Response: `{ "id": "…", "readAt": "2026-10-19T07:15:00.000Z" }`.
Calling it again keeps the **first** `readAt`. Unknown or invalid id → `404 NOTIFICATION_NOT_FOUND`.

### 4.3 Mark all read: `PATCH /drivers/notifications/read-all`

No body. Response: `{ "updated": 3 }` (how many were newly marked; `0` if all were already read).

> These are admin broadcasts. Ride and escrow pushes (§9) are not stored in this list.

---

## 5. P4: Escrow on the active ride, and completing a ride

### 5.1 `GET /rides/active/me` (driver)

For a **driver-created** ride (`origin: "driver_created"`), the response now also has:

```json
{
  "origin": "driver_created",
  "is_secure": true,
  "escrow": { "state": "held", "publisher_hold": 3000, "acceptor_hold": 2000 }
}
```

Customer-app rides are unchanged (no `origin`/`escrow` keys). `GET /rides/:rideId` already returned the full `escrow` object.

### 5.2 Completing: `PATCH /rides/:rideId/status`

(or socket `ride:status:update`, same fields)

```json
{ "status": "completed", "collectedBy": "driver" }
```

If `escrow.state == "held"`, ask **"Who collected the fare?"** before sending `completed`.

**Changed: payment method is locked.** From acceptance on, `paymentMethod` cannot change except to `"cash"`. Either omit `paymentMethod`, or send the ride's own method or `"cash"`. Anything else → `409 PAYMENT_METHOD_LOCKED`, with `details.paymentMethod` = the locked method.

**Build the "who collected?" choices from the server.** If you complete without `collectedBy`, you get:

```json
{ "code": "COLLECTED_BY_REQUIRED", "details": { "options": ["publisher", "driver"] } }
```

Show exactly `details.options`:

| option | label | when offered |
|---|---|---|
| `publisher` | "The ride owner collected it" | always |
| `driver` | "I collected it" | always |
| `platform` | "Customer paid online in the app" | **only on online rides** |

`collectedBy: "platform"` on a cash ride → `422 PLATFORM_COLLECTION_NOT_ALLOWED` (same `details.options`).

### 5.3 Changed: platform payouts wait for the payment

When a ride is completed as `platform`, **nobody is paid yet**:
- the ride is `completed`
- `escrow.state` stays `"held"`, and `escrow.awaiting_payment` is `true` in `GET /drivers/network/rides`

Both drivers are paid automatically once the money actually arrives:
- the rider pays in the app (Razorpay or wallet), or
- the driver's payment QR (`POST /drivers/payments/qr`, then `GET /drivers/payments/qr/status?rideId=…`) reports paid, for an amount that covers the fare.

Then `escrow.state` becomes `"settled"` and the usual `escrow:settled` socket event and `escrow_settled` push arrive.

**UI:** for `escrow.awaiting_payment == true`, show "Waiting for customer payment" instead of "Settled". For an offline customer, offer the payment QR.

---

## 6. P5: Profile photo at registration

`PATCH /drivers/onboarding/personal`

```json
{
  "registrationId": "…",
  "phone": "9876543210",
  "fullName": "Rudra Sharma",
  "email": "rudra@example.com",
  "gender": "Male",
  "password": "…",
  "bannerImage": "data:image/jpeg;base64,…",
  "profileImage": "data:image/jpeg;base64,…"
}
```

- `profileImage` is optional, with the same rules as §1.3: data URL → hosted URL; echoing the returned URL keeps it; omitting it keeps the previous one; `""` clears.
- Response `personal.profileImage` is the hosted URL. Keep it and send it back unchanged if the user goes back and saves the step again.
- On completion it becomes `Driver.profileImage`.
- Errors: `422 INVALID_PROFILE_IMAGE`, `400 IMAGE_TOO_LARGE`.

---

## 7. P6: Lead chats inbox

### 7.1 `GET /drivers/lead-conversations?page=1&limit=20`

```json
{
  "results": [
    {
      "id": "…",
      "ride_id": "…",
      "closed": false,
      "last_message": "Kitna time lagega?",
      "last_message_at": "2026-10-19T07:10:00.000Z",
      "my_last_read_at": "2026-10-19T07:00:00.000Z",
      "unread_count": 2,
      "other_party": { "role": "driver", "id": "…", "name": "Vikas Singh", "profile_image": "https://…" },
      "ride": { "id": "…", "pickup": "Vijay Nagar", "drop": "MP Nagar", "fare": 5000, "amount": 3000, "status": "searching" }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 7 }
}
```

- `unread_count` = messages from the other person since you last opened the thread.
- Opening the thread (`GET /drivers/lead-conversations/:id/messages`) marks it read, and `unread_count` goes to 0.
- `my_last_read_at` is `null` until you open it once.
- `ride.fare` is the customer fare; `ride.amount` is the driver payout for a published ride (else the fare).
- `other_party.role` is `driver` or `user`. `name` and `profile_image` can be `""`.

### 7.2 Socket `lead:interest` and push `lead_interest`

Socket payload:

```json
{
  "type": "lead_interest",
  "rideId": "…",
  "conversationId": "…",
  "name": "Vikas Singh",
  "senderId": "…",
  "senderRole": "driver",
  "sender": { "id": "…", "role": "driver", "name": "Vikas Singh" }
}
```

FCM data has the same flat keys (`type`, `rideId`, `conversationId`, `name`, `senderId`, `senderRole`), all strings, **without** the nested `sender` (FCM can't carry objects).

Toast: `"$name is interested in your ride"`. Tap → open chat `conversationId`.

### 7.3 Socket `lead:message:new`

```json
{
  "id": "…",
  "conversationId": "…",
  "senderRole": "driver",
  "senderId": "…",
  "sender": { "id": "…", "role": "driver", "name": "Vikas Singh" },
  "message": "Kitna time lagega?",
  "createdAt": "…",
  "clientMessageId": "…"
}
```

Toast: `"New message from ${sender.name}: $message"`. If `sender.name` is empty, use "a driver".

---

## 8. P7: Profile, documents, vehicles, earnings

### 8.1 `GET /drivers/me`: `total_rides`

New field `total_rides`: the lifetime count of trips this driver completed.

### 8.2 Gender: `PATCH /drivers/me`

```json
{ "gender": "female" }
```

Accepts `Male` / `Female` / `Other` in any case and is stored as `Male` / `Female` / `Other`. Anything else → `422 INVALID_GENDER` with `details.options`. Omitting `gender` leaves it unchanged.

### 8.3 Document re-upload: `PATCH /drivers/documents/:documentKey`

`documentKey` = the template field key (e.g. `driving_license_front`). Allowed characters: letters, digits, `_`, `-`.

```json
{
  "document": {
    "dataUrl": "data:image/jpeg;base64,…",
    "fileName": "licence-front.jpg",
    "identifyNumber": "MP09 20240001",
    "expiryDate": "2030-01-31"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `dataUrl` | yes* | JPEG/PNG/WebP data URL, ≤ 5 MB. Hosted by the server. `data_url` also accepted |
| `url` / `previewUrl` | instead of `dataUrl` | **only** an image already hosted by `gokab.in` (e.g. from an earlier upload) |
| `fileName` | no | shown to admin |
| `identifyNumber` | no | `identify_number` also accepted |
| `expiryDate` | no | any parseable date; `expiry_date` also accepted |

Response: `{ "document": {…}, "documents": {…all documents} }`. The document always goes back to `status: "pending"` (admin re-review). **Changed:** review status and any other fields you send are ignored.

Errors: `400 FIELD_REQUIRED` (no image), `422 INVALID_DOCUMENT_IMAGE` (not an image / outside URL / unreadable), `400 IMAGE_TOO_LARGE`, `422 INVALID_DATE`, `422 INVALID_DOCUMENT_KEY`.

Pending drivers can call this too (fixing a rejected document before approval).

### 8.4 My Vehicles: `GET /drivers/fleet/vehicles`

```json
{
  "results": [
    {
      "id": "…",
      "car_brand": "Maruti",
      "car_model": "Dzire",
      "license_plate_number": "MP09CM0001",
      "fuel_type": "cng",
      "model_year": 2021,
      "fitness_valid_till": "2027-03-31T00:00:00.000Z",
      "status": "approved"
    }
  ],
  "max_vehicles_allowed": 2,
  "vehicles_count": 1
}
```

Each result also keeps all the fields it had before; only the new ones are shown above.

- `fuel_type`: `petrol | diesel | cng | electric | hybrid | lpg`, or `""` if not set.
- `model_year`: number or `null`.
- `fitness_valid_till`: ISO date or `null`. A fitness-certificate document's expiry (when one is uploaded) wins over the typed date.
- `max_vehicles_allowed`: your plan's cap; **`null` means no cap**. Show "1 of 2 vehicles" only when it's a number.

**Set them:** `POST /drivers/fleet/vehicles` and `PATCH /drivers/fleet/vehicles/:vehicleId` accept `fuel_type`, `model_year`, `fitness_valid_till` (camelCase `fuelType`, `modelYear`, `fitnessValidTill` also work).
- Omit a field to keep it; send `""`/`null` to clear it.
- Changing only these does **not** send an approved vehicle back to review.
- Errors: `422 INVALID_FUEL_TYPE` (with `details.options`), `422 INVALID_MODEL_YEAR` (1980 to next year), `422 INVALID_DATE`.

### 8.5 Earnings: online time and weekly goal

`GET /drivers/earnings/summary?range=week` (ranges as before: `today | week | month | custom`)

New fields:

```json
{
  "online_minutes": 1260,
  "weekly_goal": {
    "target_amount": 10000,
    "achieved_amount": 6250,
    "remaining_amount": 3750,
    "progress_percent": 63,
    "week_start": "2026-10-18T18:30:00.000Z",
    "week_end": "2026-10-25T18:30:00.000Z"
  },
  "daily": [
    { "date": "2026-10-19", "ride_earnings": 900, "commission_earnings": 0, "rides": 3, "commission_rides": 0, "online_minutes": 245 }
  ]
}
```

- `online_minutes` (total and per day) includes the session still running. Days are IST calendar days; online history is kept for 120 days.
- `weekly_goal` is for the **current** week, Monday 00:00 to Monday 00:00 IST, whatever `range` you asked for. It is `null` when no goal is set.

**Set the goal:** `PUT /drivers/earnings/goal`

```json
{ "target_amount": 10000 }
```

Response: `{ "weekly_goal": {…} }`. `0` or `null` clears the goal (`weekly_goal: null`). Negative or non-numeric → `422 INVALID_TARGET_AMOUNT`.

---

## 9. Push `type` values

| `type` | Opens | Data keys |
|---|---|---|
| `lead_interest` | lead chat | `conversationId`, `rideId`, `name`, `senderId`, `senderRole` |
| `lead_message` | lead chat | `conversationId` |
| `network_ride_assigned` | the assigned ride | `rideId` |
| `network_ride_taken` **(new)** | Network Rides | `rideId`, `acceptorDriverId`, `acceptorName`, `isSecure` |
| `network_ride_expired` **(new)** | Network Rides | `rideId` |
| `escrow_disputed` | escrow wallet | `rideId` |
| `escrow_settled` | escrow wallet | `rideId`, `collected_by` |

All FCM data values are strings (`isSecure` is `"true"`/`"false"`).

---

## 10. All new error codes

| HTTP | `code` | Where | What to show / do |
|---|---|---|---|
| 422 | `INVALID_PROFILE_IMAGE` | `PATCH /drivers/me`, onboarding personal | "Couldn't use this photo. Pick another (JPG/PNG/WebP)." |
| 400 | `IMAGE_TOO_LARGE` | photos, documents | "Photo must be under 5 MB." Compress and retry |
| 404 | `NOTIFICATION_NOT_FOUND` | notification read | drop it from the local list |
| 409 | `PAYMENT_METHOD_LOCKED` | ride status | resend with `details.paymentMethod` or `cash` |
| 422 | `COLLECTED_BY_REQUIRED` | ride status | show "who collected?" from `details.options` |
| 422 | `PLATFORM_COLLECTION_NOT_ALLOWED` | ride status | re-ask using `details.options` |
| 422 | `INVALID_GENDER` | `PATCH /drivers/me` | pick from `details.options` |
| 422 | `INVALID_DOCUMENT_IMAGE` | document re-upload | "Upload a clear photo of the document" |
| 422 | `INVALID_DOCUMENT_KEY` | document re-upload | app bug: wrong key |
| 400 | `FIELD_REQUIRED` | document re-upload | no image attached |
| 422 | `INVALID_DATE` | documents, vehicles | fix the date field |
| 422 | `INVALID_FUEL_TYPE` | vehicles | pick from `details.options` |
| 422 | `INVALID_MODEL_YEAR` | vehicles | year 1980 to next year |
| 422 | `INVALID_TARGET_AMOUNT` | earnings goal | must be ≥ 0 |

---

## 11. Dart models (copy-paste)

```dart
double _d(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
DateTime? _t(dynamic v) => v == null ? null : DateTime.tryParse('$v');

class DriverNotification {
  final String id, title, body, image;
  final bool isRead;
  final DateTime? readAt, sentAt;
  DriverNotification.fromJson(Map<String, dynamic> j)
      : id = j['id'] ?? '',
        title = j['title'] ?? '',
        body = j['body'] ?? '',
        image = j['image'] ?? '',
        isRead = j['isRead'] == true,
        readAt = _t(j['readAt']),
        sentAt = _t(j['sentAt']);
}

class RideEscrow {
  final String state; // none | held | settled | released | disputed
  final double publisherHold, acceptorHold;
  final String? collectedBy;
  final bool awaitingPayment;
  RideEscrow.fromJson(Map<String, dynamic>? j)
      : state = j?['state'] ?? 'none',
        publisherHold = _d(j?['publisher_hold']),
        acceptorHold = _d(j?['acceptor_hold']),
        collectedBy = j?['collected_by'],
        awaitingPayment = j?['awaiting_payment'] == true;
  bool get needsCollectorChoice => state == 'held';
}

class LeadConversation {
  final String id, rideId, lastMessage;
  final bool closed;
  final int unreadCount;
  final DateTime? lastMessageAt, myLastReadAt;
  final String otherRole, otherId, otherName, otherImage;
  final String pickup, drop;
  final double fare;
  LeadConversation.fromJson(Map<String, dynamic> j)
      : id = j['id'] ?? '',
        rideId = j['ride_id'] ?? '',
        lastMessage = j['last_message'] ?? '',
        closed = j['closed'] == true,
        unreadCount = (j['unread_count'] as num?)?.toInt() ?? 0,
        lastMessageAt = _t(j['last_message_at']),
        myLastReadAt = _t(j['my_last_read_at']),
        otherRole = j['other_party']?['role'] ?? 'driver',
        otherId = j['other_party']?['id'] ?? '',
        otherName = j['other_party']?['name'] ?? '',
        otherImage = j['other_party']?['profile_image'] ?? '',
        pickup = j['ride']?['pickup'] ?? '',
        drop = j['ride']?['drop'] ?? '',
        fare = _d(j['ride']?['fare']);
}

class WeeklyGoal {
  final double target, achieved, remaining;
  final int progressPercent;
  final DateTime? weekStart, weekEnd;
  WeeklyGoal.fromJson(Map<String, dynamic> j)
      : target = _d(j['target_amount']),
        achieved = _d(j['achieved_amount']),
        remaining = _d(j['remaining_amount']),
        progressPercent = (j['progress_percent'] as num?)?.toInt() ?? 0,
        weekStart = _t(j['week_start']),
        weekEnd = _t(j['week_end']);
}

class FleetVehicleSpecs {
  final String fuelType; // '' when unset
  final int? modelYear;
  final DateTime? fitnessValidTill;
  FleetVehicleSpecs.fromJson(Map<String, dynamic> j)
      : fuelType = j['fuel_type'] ?? '',
        modelYear = (j['model_year'] as num?)?.toInt(),
        fitnessValidTill = _t(j['fitness_valid_till']);
}
```

---

## 12. QA checklist & test scripts

| # | Check | Expected |
|---|---|---|
| 1 | Set a profile photo from the gallery | `GET /drivers/me` → `profileImage` starts with `https://` and the photo shows |
| 2 | Rudra (`6aa5c3995b081b792ba554eb`) opens Profile | photo shows (after the server migration), no decoder error |
| 3 | Publish as A, close A's app, accept as B | A gets "Your ride was accepted" and tapping opens Network Rides |
| 4 | Publish with a short expiry, nobody accepts | publisher gets "Your published ride expired" |
| 5 | Open a notification, reinstall, open list | it is still read |
| 6 | Accept a secure feed ride, complete from the trip screen | "who collected?" appears with options from the server, and completion succeeds |
| 7 | Complete an online secure ride as "platform" | ride shows "Waiting for customer payment"; after the rider pays, both wallets are credited |
| 8 | Register with a profile photo | photo shows after approval |
| 9 | B messages A about a lead | A's inbox shows unread dot and B's name; the toast shows B's name |
| 10 | Edit gender, re-upload a document, add fuel/year/fitness, set a weekly goal | each saves and shows after reload |

Backend smoke scripts (run by backend):
- `smoke_driver_app_gaps.mjs`: P1–P6 and payment rules
- `smoke_driver_app_p7.mjs`: P7
- `smoke_profile_image_urls.mjs`: profile photos and the migration
- `smoke_secure_unsecure.mjs`, `smoke_earnings_split.mjs`, `smoke_network_qa_checklist.mjs`, `audit_money_invariants.mjs`
