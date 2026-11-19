# GoKab Driver App — Backend Spec V2: What's Live

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented (commit `de7a789`).
> **Scope:** everything in `BACKEND_SPEC_V2` (idle location, selfie, profile, ride history, fleet confirm, reminders, scheduled start window, referrals, ratings, rider feedback, feed notes).

The app was built against the V2 contract ahead of the backend. This guide is the **verification sheet**: for each item, what the server now does, the exact shapes/codes, and the small places where the implementation is stricter or wider than the original spec. Nothing here needs an app release if the app already follows the spec — treat it as a checklist to confirm against.

Items 1–4 and 7 change behaviour for drivers today; 5, 6, 8, 9 turn on features the app hides until they exist.

---

## 1. Idle driver location — `driver:location:update`

Over the existing driver socket (same auth as every other event):

```
event:   driver:location:update
payload: { "coordinates": [lng, lat], "heading": 87.5, "speed": 6.2 }
```

Server behaviour:

- Driver only. Updates `Driver.location` + `locationUpdatedAt` **only while the driver is online**; an offline driver's beat is silently ignored.
- **Throttle: 1 accepted beat per 10 s per driver.** Anything faster is dropped silently (no error). Your 20 s / 50 m cadence is well inside this.
- The zone is re-resolved only when the point leaves the zone the driver was last placed in. Fleet drivers stay pinned to their organisation's zone.
- No ack. A malformed `coordinates` value does **not** break the connection; the server just emits `errorMessage` (see §10) and carries on.
- `heading` / `speed` are accepted but not stored (nothing reads them yet).

During a ride keep sending `ride:driver-location:update` exactly as before. Don't send both.

**Dispatch staleness (server-side, off by default):** dispatch will only skip drivers with an old `locationUpdatedAt` once the backend team sets `DRIVER_LOCATION_STALE_SECONDS`. Until then nothing changes for any driver. Route-booking drivers are exempt (they match on their saved anchor point).

---

## 2. Daily selfie

When `PATCH /drivers/online` is refused because a selfie is needed:

```json
{ "success": false, "message": "A selfie is required before going online today", "code": "SELFIE_REQUIRED" }
```

Branch on `code == "SELFIE_REQUIRED"` (the word "selfie" is still in the message, so the existing text match keeps working too). Retry with:

```json
{ "location": [lng, lat], "selfieImageUrl": "data:image/jpeg;base64,..." }
```

The server uploads the data URL and stores the **hosted URL** in `onlineSelfie.imageUrl` (it used to store raw base64). Going online again the same day needs no new selfie. A bad/oversized image returns a normal 4xx with a readable `message`.

---

## 3. `PATCH /drivers/me` returns the full profile

The response is now **exactly the `GET /me` payload** (same keys: `account_type`, `driver_category`, `createdAt`, `wallet`, vehicle fields, `documents`, …). You can drop the follow-up `GET /me` after saving and use the `PATCH` response directly.

### Payout QR — `bankDetails.qrCodeImage`

- Send a **data URL** when the driver picks a new QR; **omit the key** when unchanged (the stored QR is kept).
- The server uploads it and returns the hosted URL in `bankDetails.qrCodeImage`.
- **Max 2 MB** (decoded). Larger → `400` with `code: "IMAGE_TOO_LARGE"` and a readable message. Check size client-side first.
- `bankDetails.branchName` is saved and returned (fill it from the IFSC lookup as you do now).
- UPI/IFSC/account-number format errors are checked **before** the upload, so a refused save never uploads the image.

---

## 4. Ride history date range — `GET /api/v1/rides`

| Param | Meaning |
|---|---|
| `from` | UTC ISO. Includes rides where `completedAt ?? createdAt >= from` |
| `to` | UTC ISO, **exclusive** (`< to`). Optional |

- Cancelled / unfinished rides have no `completedAt`, so their `createdAt` is used.
- `pagination.total` (and `data.total`) reflect the **filtered** set.
- Bad input → `422` with `code: "INVALID_DATE_RANGE"`: an unparseable date, or `from >= to`.
- Composes with `category=` and `limit`/`page`. With no `from`/`to` the endpoint behaves exactly as before.

So "Last 3 Months / All Time" can now reach beyond the latest 100 rides — just send `from`.

---

## 5. Fleet assignment confirmation

### The key
Every network-ride object now has `assignment.acknowledged_at` **as a key, always** (value `null` until confirmed). This covers both scopes of `GET /drivers/network/rides` and the create / assign / reassign / unassign / acknowledge responses. Your "show Confirm only if the key exists" rule therefore holds for every network ride.

> Note for the card logic: the key exists for **all** network rides, including ones taken from the feed. If Confirm should only appear for rides the owner assigned to the driver, also check `assignment.mode == "direct_assign"` (already in the same object).

It is reset to `null` on every assign, reassign, unassign and reject — a confirmation belongs to one driver's hold on the ride.

### The endpoint

```
POST /drivers/network/rides/:rideId/acknowledge      (empty body)
```

| Case | Result |
|---|---|
| Assigned driver confirms | `200`, ride object with `assignment.acknowledged_at` set |
| Already confirmed | `200`, unchanged (idempotent — owner is **not** notified twice) |
| Caller is not the assigned driver | `403` `NOT_RIDE_DRIVER` |
| Trip started / completed / cancelled | `409` `RIDE_NOT_OPEN` |
| Unknown / non-network ride | `404` `RIDE_NOT_FOUND` |

Any driver category may call it (it is not tier-gated).

### What the owner gets
- Socket → org room: `org:ride:acknowledged` `{ rideId, driverId, driverName }` (refresh the owner's list).
- Push to whoever created/assigned the ride: `data.type = network_ride_acknowledged`, `data.rideId`.

---

## 6. Reminder pushes (server cron, runs every minute)

All `data` values are strings. Each push is sent **once** per ride/document.

| `data.type` | To | When | Extra data | App opens |
|---|---|---|---|---|
| `scheduled_ride_reminder` | assigned driver | scheduled ride 30–45 min away, status `accepted` | `rideId` | Network Rides → Assigned to me |
| `scheduled_ride_reminder_owner` | owner (creator/assigner) | same moment, **only if not acknowledged** | `rideId` | Network Rides |
| `network_ride_unacknowledged` | owner | immediate ride 10 min after assigning, or scheduled ride within 2 h of pickup (never sooner than 10 min after assigning) and still unconfirmed | `rideId` | Network Rides |
| `vehicle_document_expiring` | vehicle owner | a fleet vehicle document's expiry is within 15 days | `vehicle_id`, `key`, `expires_at` | My Vehicles |

Details worth knowing:
- Reminders apply to **driver-created (network) rides** only, not ordinary rider-app bookings.
- Reassigning or unassigning a ride **re-arms** its reminders for the next driver.
- A self-assigned ride never nudges the owner about the same person.
- Document reminders are once per document **and expiry value**: renewing a document (new expiry) re-arms it. They only exist for documents saved with an expiry date; the owner may also get one for documents already expired within the last day.
- A document with no expiry date never produces a reminder.

---

## 7. Scheduled-ride start window

Moving a ride to **`arriving`** or **`started`** more than **30 minutes** before `scheduledAt` is refused:

```json
{
  "success": false,
  "message": "This ride is scheduled for later. You can start it from 01 Oct, 05:30 pm.",
  "code": "TOO_EARLY_TO_START",
  "details": { "starts_at": "2026-10-01T12:00:00.000Z", "scheduled_at": "2026-10-01T12:30:00.000Z", "window_minutes": 30 }
}
```

- Show `message` as-is. `details.starts_at` (UTC ISO) is when the button becomes usable — use it for a countdown if you like.
- Applies to **every** scheduled ride (network or rider-app), through both `PATCH /rides/:id/status` and the socket `ride:status:update`.
- Re-sending the status the ride is already in is not refused. Rides with no `scheduledAt` are never affected.
- The window length is a backend setting (`scheduled_start_window_minutes`, default 30) — don't hardcode 30; read it from `details.window_minutes` if you display it.

### `/rides/active/me`
A scheduled ride is **not** returned as the active trip before its window opens, and **is** returned once it opens — so "Open Trip" can reach it in time to start it. (Previously a scheduled ride only became "active" at its exact `scheduledAt`.)

---

## 8. Referrals — `GET /drivers/referrals`

```json
{
  "success": true,
  "data": {
    "stats": { "total_referrals": 12, "rides_completed": 28, "total_earned": 3500 },
    "results": [
      { "name": "Amit Sharma", "joined_at": "2026-08-12T10:00:00Z", "active": true, "rides_completed": 8 }
    ]
  }
}
```

- `results`: drivers who signed up with my code, **newest first** (up to 200). `stats` covers all of them.
- `total_earned`: referral credits to **my** wallet only (a welcome bonus I got for being referred is not counted).
- `active`: approved **and** (online now, or seen in the last 30 days, or completed a ride in the last 30 days).
- A driver with no referrals gets `200` with zeros and an empty list — not a 404. Your 404 feature-detect no longer triggers; show the empty state from the data instead.

---

## 9. Rider reviews — `GET /drivers/ratings`

```json
{
  "success": true,
  "data": {
    "total": 320,
    "distribution": { "5": 220, "4": 68, "3": 20, "2": 8, "1": 4 },
    "results": [
      { "rider_name": "Rahul S.", "rating": 5, "comment": "Very polite", "createdAt": "2026-09-12T08:00:00Z", "service_type": "ride" }
    ]
  }
}
```

- `distribution` always has all five keys (0 when none). `total` counts rated rides only.
- `results`: latest **20** reviews, newest first. `comment` may be `""`.
- `rider_name` is masked ("Rahul S."); a single-word name is shown as is; no rider account → `"Rider"`. Don't expect the full name anywhere.
- A driver with no reviews gets `200` with zeros — not a 404.

---

## 10. Smaller changes

### Driver's feedback on the rider — `PATCH /rides/:id/rider-rating`
```json
{ "rating": 4, "comment": "Kept me waiting 10 min", "tags": ["Polite", "On time"] }
```
- `comment` and `tags` are optional; `rating` alone still works.
- `comment`: trimmed, max 500 chars (longer is **truncated**, not rejected).
- `tags`: must be an array of strings (else `400` `INVALID_TAGS`); blanks dropped, duplicates removed, each ≤ 40 chars, max 10.
- A ride can still only be rated once (`409` on a repeat).

### Feed item details
Home-feed items now carry `notes` (string, `""` when none) — the text a Post Booking wrote, e.g. `"Persons: 2 • Luggage: 1 • Vehicle: SUV"`. Parse your Persons / Luggage / Vehicle cells from it.

### Socket `errorMessage` now carries `code` / `details`
When a socket action fails with a known server error, `errorMessage` is now `{ message, code?, details? }` (previously just `message`). This lets e.g. the socket status-update path branch on `TOO_EARLY_TO_START` exactly like the REST path. Old handlers that only read `message` keep working.

---

## Error codes (all carry a readable `message` — show it as-is)

| Code | Where |
|---|---|
| `SELFIE_REQUIRED` | `PATCH /drivers/online` |
| `IMAGE_TOO_LARGE` | `PATCH /drivers/me` (QR > 2 MB) |
| `INVALID_DATE_RANGE` | `GET /rides` |
| `TOO_EARLY_TO_START` | ride status → arriving/started |
| `NOT_RIDE_DRIVER`, `RIDE_NOT_OPEN`, `RIDE_NOT_FOUND` | acknowledge |
| `INVALID_TAGS` | rider-rating |

Unchanged and still relevant: `DRIVER_BUSY`, `DRIVER_NOT_FOUND`, `DRIVER_NOT_IN_FLEET`, `CATEGORY_NOT_ALLOWED`, `RIDE_ALREADY_STARTED`, `DOCUMENTS_REQUIRED`, `DOCUMENT_DETAILS_REQUIRED`, `DOCUMENT_EXPIRED`, `COMMERCIAL_PERMIT_REQUIRED`, `VEHICLE_DOCUMENT_DETAILS_REQUIRED`, `INSUFFICIENT_WALLET_FOR_PUBLISH`.

---

## Not a backend change (still on the team's to-do list)

These were in the spec's config table and cannot be fixed from code — they block parts of the app until done:

- **C1** Firebase service account on the server for project `gokab-ff502` (no push is sent without it — this affects every push above).
- **C2** Admin: RC template required; Insurance template created.
- **C3** Google Cloud: allow `com.gokab.driver` + release SHA-1 on the Maps/Places key.
- **C4** iOS Firebase app + `GoogleService-Info.plist` + APNs key.
- **C5** Real support phone and About / Terms / Privacy URLs (`--dart-define`s).
- **C6** Release keystore → `android/key.properties` (never commit it).

---

## Acceptance checklist

- [ ] Online driver moving 200 m is reflected in dispatch within ~30 s; app keeps sending `driver:location:update` only while online and **not** on a ride.
- [ ] Selfie flow keys off `code == "SELFIE_REQUIRED"`; retry stores a hosted URL.
- [ ] After saving the profile, the screen uses the `PATCH /me` response (no extra `GET /me`); QR > 2 MB is blocked client-side and `IMAGE_TOO_LARGE` is handled.
- [ ] History "Last 3 Months / All Time" sends `from` and shows rides older than the latest 100.
- [ ] Confirm button appears for directly-assigned rides, calls `/acknowledge`, flips to "Confirmed"; owner sees "Waiting for driver → Confirmed" after `org:ride:acknowledged`.
- [ ] Each reminder `data.type` opens the right screen.
- [ ] Starting a scheduled ride early shows the server's message; "Open Trip" works once the window opens.
- [ ] Referrals and Ratings screens render real data and a proper empty state (zeros / empty list), not "not available".
- [ ] Rider feedback sends `comment` + `tags`; feed card cells fill from `notes`.
