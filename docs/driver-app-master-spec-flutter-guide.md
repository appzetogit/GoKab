# Driver App Master Spec — Flutter Developer Guide

Everything the Flutter driver app needs to use the new backend for the
"Driver App Master Spec". Every JSON example below matches the real server
responses, not the spec draft. Where the server differs from the spec draft,
follow this guide (see [Differences from the spec draft](#8-differences-from-the-spec-draft)).

| Part | Feature | App work |
|---|---|---|
| A | Published rides need the publisher's approval (request → approve) | Feed buttons, applicants screen, sockets, push |
| B | Choose which vehicle goes on a ride | Vehicle picker on create / assign, show `vehicle` |
| C | Bills saved on the server | Replace SharedPreferences with the API, one-time import |
| D | One "All Rides" list | Replace the phone-side merge with one call |
| E | Socket events, push types, error codes | Handlers in `realtime_sync.dart` / `notification_routes.dart` |

---

## Contents

1. [Basics: base URL, envelope, errors](#1-basics)
2. [Part A — Request → approve](#2-part-a--request--approve-for-published-rides)
3. [Part B — Vehicle on a ride](#3-part-b--vehicle-on-a-ride)
4. [Part C — Bills](#4-part-c--bills-on-the-server)
5. [Part D — All Rides list](#5-part-d--one-all-rides-list)
6. [Part E — Sockets and push](#6-part-e--socket-events-and-push)
7. [Error code reference](#7-error-code-reference)
8. [Differences from the spec draft](#8-differences-from-the-spec-draft)
9. [Release order and old app builds](#9-release-order-and-old-app-builds)
10. [QA checklist for the app](#10-qa-checklist-for-the-app)

---

## 1. Basics

**Base URL:** `https://gokab.in/api/v1`
Driver endpoints are under `/drivers/...`. The All Rides list is `/rides`.
Every call sends the driver token: `Authorization: Bearer <token>`.

### Success envelope

```json
{ "success": true, "message": "optional text", "data": { } }
```

### Error envelope

```json
{
  "success": false,
  "message": "Human readable text — safe to show in a snackbar",
  "code": "MACHINE_CODE",
  "details": { "any": "extra info, may be null" }
}
```

Bill validation errors also carry a top-level `fields` map (see §4.3).

> **Rule:** branch on `code`, never on `message`. Messages may be reworded;
> codes will not change.

### A small Dart helper for errors

```dart
class ApiException implements Exception {
  final int status;
  final String code;
  final String message;
  final Map<String, dynamic>? details;
  final Map<String, String>? fields; // only on bill validation errors

  ApiException(this.status, this.code, this.message, {this.details, this.fields});

  factory ApiException.fromResponse(int status, Map<String, dynamic> body) {
    final rawFields = body['fields'];
    return ApiException(
      status,
      (body['code'] ?? 'UNKNOWN') as String,
      (body['message'] ?? 'Something went wrong') as String,
      details: body['details'] as Map<String, dynamic>?,
      fields: rawFields is Map
          ? rawFields.map((k, v) => MapEntry(k.toString(), v.toString()))
          : null,
    );
  }
}
```

A malformed id anywhere in a URL now returns `400 INVALID_ID` (it used to be a 500).

---

## 2. Part A — Request → approve for published rides

### 2.1 What changed

**Before:** driver B tapped **Accept** on a published ride in the feed and got it instantly.

**Now:**
1. Driver B taps **Request ride** (with an optional short note).
2. Publisher A gets a socket event and a push, opens the ride, and sees every
   applicant (photo, rating, trips, vehicle, note).
3. A taps **Approve** on one applicant. Only now is the ride assigned and the escrow held.
4. Every other pending applicant is automatically rejected and told why.

This applies to **driver-published rides only** (feed tab `driver`).
**Customer leads** (feed tab `customer`) still use the old instant Accept.

### 2.2 Flow

```
 Driver B (applicant)                 Server                          Driver A (publisher)
 ───────────────────                  ──────                          ────────────────────
 POST /feed/rides/:id/request  ──▶  request saved (pending)   ──▶  socket feed:request:received
                                                                      push ride_request_received
                                                                      GET /network/rides/:id/applicants
                                     claim + escrow hold      ◀──  POST .../applicants/:B/approve
 socket feed:request:approved  ◀──   others rejected          ──▶  socket network:ride:taken
 push ride_request_approved          feed:driver:removed (TAKEN) to the feed room
 Driver C: feed:request:rejected (reason ride_taken)
```

### 2.3 Is approval on?

Admin can switch approval off (setting `feed_requires_approval`, default **on**).
Every driver-tab feed item tells you which flow to use:

```json
"accept": { "...existing fields...": "...", "requires_approval": true }
```

- `requires_approval == true` → show the **Request** flow (this guide).
- `requires_approval == false` → show the old **Accept** button.

If you call the old accept on a published ride while approval is on, you get
`409 APPROVAL_REQUIRED`. Treat it as "refresh the feed and show the Request button".

### 2.4 Feed item — new fields

`GET /drivers/feed?tab=driver` — each item now has:

```json
{
  "id": "6ae5dd1e4cd4e32415837500",
  "lead_type": "driver",
  "has_requested": true,
  "my_request_status": "pending",
  "applicants_count": 2,
  "accept": { "requires_approval": true }
}
```

| `my_request_status` | Meaning | Button to show |
|---|---|---|
| `null` | Never requested | **Request ride** |
| `"pending"` | Waiting for the publisher | **Requested ✓** (disabled) + **Withdraw** |
| `"withdrawn"` | Driver withdrew | **Request ride** (allowed again) |
| `"rejected"` | Publisher said no / someone else got it | **Not selected** (disabled) |

An approved request means the ride is now yours; it leaves the feed and shows
up in Upcoming.

`applicants_count` is the number of **pending** requests. Show it only on the
publisher's own posts.

### 2.5 Request a ride (applicant)

```
POST /drivers/feed/rides/:rideId/request
Content-Type: application/json

{ "note": "I'm 5 min away" }
```

- `note` is optional, max 300 characters. Control characters are removed.
- Nothing is taken from the wallet yet. The server only checks that the driver
  has enough **available** balance for the hold they will need at approval.

**200 response**

```json
{
  "success": true,
  "data": { "requested": true, "rideId": "6ae5dd1e4cd4e32415837500", "status": "pending", "applicants_count": 2 }
}
```

**Errors**

| HTTP | `code` | What to show / do |
|---|---|---|
| 409 | `ALREADY_REQUESTED` | Already requested, or was rejected (`details.status`). Refresh the item. |
| 409 | `RIDE_ALREADY_TAKEN` | "Another driver already has this ride" → remove the card |
| 409 | `RIDE_NOT_OPEN` | Ride closed, expired, or it's your own ride → refresh |
| 409 | `NOT_A_PUBLISHED_RIDE` | It's a customer lead → use Accept instead |
| 402 | `INSUFFICIENT_WALLET` | "You need ₹`details.required` available" → open wallet top-up |
| 409 | `REQUEST_LIMIT_REACHED` | The ride already has 20 pending requests |
| 429 | `RATE_LIMITED` | More than 30 requests this hour — try later |
| 403 | `DRIVER_NOT_AVAILABLE` | The account can't take rides right now |
| 404 | `RIDE_NOT_FOUND` | Remove the card |

### 2.6 Withdraw a request (applicant)

```
DELETE /drivers/feed/rides/:rideId/request
```

**200 response**

```json
{ "success": true, "data": { "withdrawn": true, "rideId": "6ae5…", "applicants_count": 1 } }
```

`404 REQUEST_NOT_FOUND` → there is no pending request (it was already
approved, rejected or withdrawn). Refresh the item. A withdrawn driver may
request again.

### 2.7 List applicants (publisher)

```
GET /drivers/network/rides/:rideId/applicants              // pending only (default)
GET /drivers/network/rides/:rideId/applicants?status=all   // also rejected / withdrawn / approved
```

**200 response**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "driverId": "6ae5dd00a6c6538c0835a213",
        "name": "Vikas Singh",
        "phone": "9000000003",
        "avatar": "https://gokab.in/api/images/drivers/2026/10/abc.webp",
        "rating": 4.8,
        "trips": 132,
        "vehicleModel": "Maruti Suzuki Swift Dzire",
        "vehicleNumber": "MP09AB1234",
        "vehicleType": "sedan",
        "status": "pending",
        "note": "I'm 5 min away",
        "requestedAt": "2026-10-31T09:12:00.000Z"
      }
    ],
    "total": 1
  }
}
```

- Sorted **first come first** (oldest request on top).
- `rating` is `null` when the driver has no ratings yet — show "New".
- `avatar` may be `""` — show the initials placeholder.
- Name, vehicle, rating and trips are a **snapshot taken when they requested**.
- Drivers who were blocked or deleted after requesting are hidden.
- Anyone who is not the publisher gets `404 RIDE_NOT_FOUND`.

You often don't need this call: the publisher's lists already include a
preview (see §2.10).

### 2.8 Approve an applicant (publisher)

```
POST /drivers/network/rides/:rideId/applicants/:driverId/approve
```

What the server does, all in one transaction:
1. Assigns the ride to that driver (status `accepted`).
2. Puts the applicant's own vehicle on the ride (`vehicle.source = "driver_default"`).
3. Holds the escrow for both sides (secure rides only).
4. Rejects every other pending applicant with reason `ride_taken`.

**200 response** — the normal network ride object (same shape as
`GET /drivers/network/rides` items) plus two fields:

```json
{
  "success": true,
  "data": {
    "id": "6ae5dd1e4cd4e32415837500",
    "status": "accepted",
    "vehicle": { "source": "driver_default", "fleet_vehicle_id": null, "number": "MP09AB1234", "model": "Swift Dzire", "type": "sedan", "color": "White" },
    "applicants_count": 0,
    "requests": [],
    "escrow_result": "held",
    "is_secure": true
  }
}
```

`escrow_result` is `"held"` or `"none"`. It is **not** called `escrow`,
because the ride object already has an `escrow` object.

**Errors**

| HTTP | `code` | What happened | What to do |
|---|---|---|---|
| 402 | `APPLICANT_WALLET_LOW` | That applicant can't fund the hold any more. They are rejected. **The ride stays open.** `details.driverId` | Snackbar "Vikas doesn't have enough balance", refresh the list, pick another |
| 402 | `PUBLISHER_INSUFFICIENT_WALLET` | **Your** wallet can't fund your side | Open wallet top-up |
| 409 | `APPLICANT_BUSY` | The applicant now has another trip at that time. `details.conflictingRideId` | Pick another |
| 409 | `APPLICANT_UNAVAILABLE` | The applicant's account is blocked / deleted | Refresh the list |
| 409 | `APPLICANT_NOT_PENDING` | They withdrew or were already rejected | Refresh the list |
| 409 | `RIDE_ALREADY_TAKEN` / `RIDE_NOT_OPEN` | Ride already assigned / expired / cancelled | Refresh the ride |
| 404 | `REQUEST_NOT_FOUND` | That driver never requested this listing | Refresh the list |

Two Approve taps at the same moment are safe: exactly one succeeds, the other
gets 409. Still, disable the buttons while a call is running.

### 2.9 Reject an applicant (publisher)

```
POST /drivers/network/rides/:rideId/applicants/:driverId/reject
{ "reason": "Vehicle not suitable" }     // optional, max 200 chars
```

```json
{ "success": true, "data": { "rejected": true, "rideId": "6ae5…", "applicants_count": 0 } }
```

The ride stays open. The rejected driver **cannot request again** for this
listing. If the publisher types a reason, the applicant sees that text;
otherwise they see the default text for `publisher_rejected`.

Errors: `409 APPLICANT_NOT_PENDING`, `404 REQUEST_NOT_FOUND`.

### 2.10 Applicants preview in the publisher's lists

Both of these carry `applicants_count` (pending only) and `requests` (the first
5 pending applicants, same objects as §2.7) on the publisher's own open rides:

- `GET /drivers/network/rides` (created rides)
- `GET /rides` (All Rides, Part D)

Use them for a "3 requests" badge on the card without an extra call.

### 2.11 When requests close on their own

| Event | Pending requests become | `reason` |
|---|---|---|
| Publisher approves someone else | rejected | `ride_taken` |
| Publisher rejects | rejected | `publisher_rejected` |
| Publisher unpublishes | rejected | `ride_cancelled` |
| Ride cancelled (by the publisher, admin or rider) | rejected | `ride_cancelled` |
| Listing expires | rejected | `ride_expired` |
| Applicant can't fund the hold at approval | rejected | `insufficient_wallet` |
| Applicant's account blocked | rejected | `driver_unavailable` |

The applicant always gets the socket event and the push (§6).

**Republish:** if the publisher unpublishes and publishes again, it is a new
listing. Everyone, including previously rejected drivers, may request again.

**Direct assign while published:** not allowed. The server returns
`409 RIDE_NOT_OPEN` "Unpublish this ride before assigning it". Unpublishing
closes the requests first.

### 2.12 Suggested state handling (applicant side)

```dart
enum RequestState { none, pending, rejected, withdrawn }

RequestState requestStateFrom(Map<String, dynamic> feedItem) {
  switch (feedItem['my_request_status']) {
    case 'pending':   return RequestState.pending;
    case 'rejected':  return RequestState.rejected;
    case 'withdrawn': return RequestState.withdrawn;
    default:          return RequestState.none;
  }
}

bool requiresApproval(Map<String, dynamic> feedItem) =>
    (feedItem['accept'] as Map?)?['requires_approval'] == true;
```

Update the state **from the API response** after request / withdraw (don't
just flip it locally), and again when socket events arrive.

### 2.13 Remove the mock fallback

`fetchRideApplicants`, `approveRideApplicant` and `rejectRideApplicant` must
**not** fall back to fake applicants in a release build. A 404 / 409 must
show an error. Use mock data only when `MOCK=true`.

---

## 3. Part B — Vehicle on a ride

A ride now carries **its own vehicle**. Before, the app always showed the
driver's profile vehicle. Now the creator can choose:

| `source` | Meaning |
|---|---|
| `driver_default` | The assigned driver's own profile vehicle (old behaviour) |
| `fleet` | A vehicle from the creator's fleet (Prime tier) |
| `custom` | A vehicle typed in by plate and model (spare bike, borrowed car) |

This **never changes** the driver's profile vehicle — it is a per-ride choice.

### 3.1 Sending the vehicle

Add an optional `vehicle` object to:

- `POST /drivers/network/rides` (when you also send `assign_to_driver_id`)
- `POST /drivers/network/rides/:rideId/assign`
- `POST /drivers/network/rides/:rideId/reassign`

```json
{ "vehicle": { "source": "driver_default" } }
```

```json
{ "vehicle": { "source": "fleet", "fleet_vehicle_id": "66aa0c1f2b3e4d5f6a7b8c9d" } }
```

```json
{
  "vehicle": {
    "source": "custom",
    "number": "MP09 XY 9999",
    "model": "Bajaj Pulsar 150",
    "type": "bike",
    "color": "Black"
  }
}
```

Rules:
- No `vehicle` at all → `driver_default` (same as today).
- The server cleans plates: `mp09 xy-9999` → `MP09XY9999`. Normal Indian
  plates and BH-series plates are accepted.
- `fleet` needs the Prime tier, and the vehicle must belong to **your**
  organisation and be **approved**.
- The old flat body fields `vehicleNumber` / `vehicleModel` still work and are
  read as `custom`. New code should send the `vehicle` object.
- **Stop sending a top-level `vehicleTypeId` label like `"bike"`.** The server
  now ignores a label there instead of crashing, but the label belongs in
  `vehicle.type`.
- **Stop appending "Assigned Vehicle: …" to the ride notes.** The vehicle is
  now a real field.

### 3.2 Vehicle errors

If the vehicle check fails, **nothing changes**: the ride is not created or
assigned, and on reassign the old driver stays.

| HTTP | `code` | Show |
|---|---|---|
| 422 | `INVALID_VEHICLE_NUMBER` | "Enter a valid vehicle number" under the plate field |
| 422 | `INVALID_VEHICLE_DETAILS` | Model / type / colour too long or invalid |
| 422 | `INVALID_VEHICLE_SOURCE` | Unknown `source` (an app bug) |
| 422 | `DRIVER_HAS_NO_VEHICLE` | "This driver has no vehicle on their profile — choose a fleet or custom vehicle" |
| 422 | `INVALID_FLEET_VEHICLE` | Not your fleet, or your plan has no fleet access |
| 422 | `VEHICLE_NOT_APPROVED` | "This vehicle is still pending approval" |

### 3.3 Vehicle warnings (the ride is still saved)

Create / assign / reassign responses include `vehicle_warnings`, an **array of
strings**:

```json
"vehicle_warnings": ["TYPE_MISMATCH", "VEHICLE_BUSY"]
```

| Warning | Show (yellow snackbar) |
|---|---|
| `TYPE_MISMATCH` | "This vehicle type doesn't match the ride's vehicle type" |
| `VEHICLE_BUSY` | "This vehicle is already on another active ride" |

An empty array `[]` means no warnings. Never block on these.

### 3.4 Reading the vehicle

Every ride object (network rides, upcoming, the All Rides list, ride detail,
the approve response) now has:

```json
"vehicle": {
  "source": "fleet",
  "fleet_vehicle_id": "66aa0c1f2b3e4d5f6a7b8c9d",
  "number": "MP09AB1234",
  "model": "Swift Dzire",
  "type": "sedan",
  "color": "White"
}
```

`vehicle` is `null` when the ride has no driver yet.

- `GET /rides/:id` and the active-ride call also return `data.vehicle`, and
  the driver card fields `driverId.vehicleNumber` / `vehicleModel` **already
  show the ride's vehicle**, so old screens are correct without changes.
- The "ride assigned" push now includes the vehicle ("Vehicle: Swift Dzire (MP09AB1234)").
- The owner live map and the history field `driven_by.vehicleNumber` use the ride's vehicle too.

```dart
class RideVehicle {
  final String? source;          // driver_default | fleet | custom
  final String? fleetVehicleId;
  final String number;
  final String model;
  final String type;
  final String color;

  RideVehicle.fromJson(Map<String, dynamic> j)
      : source = j['source'] as String?,
        fleetVehicleId = j['fleet_vehicle_id'] as String?,
        number = (j['number'] ?? '') as String,
        model = (j['model'] ?? '') as String,
        type = (j['type'] ?? '') as String,
        color = (j['color'] ?? '') as String;

  String get label => [model, number].where((s) => s.isNotEmpty).join(' · ');
}
```

### 3.5 Fleet vehicle picker

`GET /drivers/network/fleet/availability` now also returns `vehicles`:

```json
"vehicles": [
  {
    "vehicle_id": "66aa0c1f2b3e4d5f6a7b8c9d",
    "number": "MP09AB1234",
    "model": "Swift Dzire",
    "color": "White",
    "status": "approved",
    "selectable": true,
    "on_ride": false,
    "booked_until": null
  }
]
```

- `selectable == false` → grey it out (not approved yet).
- `on_ride == true` → show an "On a ride" badge. It is still selectable; the server will warn `VEHICLE_BUSY`.
- `booked_until` → ISO date of the vehicle's latest booked ride, or `null`.

### 3.6 Picker layout suggestion

```
Vehicle for this ride
 (•) Driver's own vehicle      Swift Dzire · MP09AB1234
 ( ) Fleet vehicle  ▸          [list from /fleet/availability → vehicles]
 ( ) Other vehicle  ▸          [plate] [model] [type ▾]
```

Hide the "Fleet vehicle" option when the driver's plan has no fleet permission.

---

## 4. Part C — Bills on the server

The app **still builds the PDF and the WhatsApp text**. The server now stores
the bill, **assigns the bill number** and **recomputes the totals**. Bills
survive reinstalling the app.

### 4.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/drivers/bills` | Save a bill (on Share WhatsApp / Share PDF / Print) |
| GET | `/drivers/bills` | List, search, filter, paginate |
| GET | `/drivers/bills/:id` | One bill |
| DELETE | `/drivers/bills/:id` | Soft delete |
| POST | `/drivers/bills/import` | One-time upload of bills stored on the phone |

A driver only ever sees their own bills.

### 4.2 Create

```
POST /drivers/bills
```

```json
{
  "clientRef": "b3f1c2a0-5d6e-4f55-9a3c-1d2e3f4a5b6c",
  "rideId": "66f1a2b3c4d5e6f708192a3b",
  "customerName": "Rahul Sharma",
  "customerPhone": "9876543210",
  "companyGst": "ABC Travels / 23ABCDE1234F1Z5",
  "pickupAddress": "Vijay Nagar, Indore",
  "dropAddress": "Ujjain Railway Station",
  "distanceKm": 55.5,
  "tripType": "One Way",
  "tripDate": "2026-10-29T14:30:00+05:30",
  "driverName": "Varun Rajpoot",
  "vehicleNumber": "MP09AB1234",
  "vehicleModel": "Swift Dzire",
  "baseFare": 500,
  "ratePerKm": 12,
  "toll": 80,
  "parking": 0,
  "waiting": 100,
  "nightDa": 0,
  "extra": 0,
  "discount": 50,
  "paymentMethod": "Cash",
  "paymentStatus": "Paid"
}
```

| Field | Required | Notes |
|---|---|---|
| `clientRef` | strongly recommended | A UUID made **when the form opens**; reuse it on every retry of the same save |
| `rideId` | no | Only when the bill is made from a ride; it must be a ride you drove, created or were assigned |
| `customerPhone` | no | 10 digits starting with 6–9. `+91` and spaces are stripped |
| `tripType` | yes | Exactly `One Way`, `Round Trip`, `Local` or `Outstation` (case-sensitive). The UI label "Local / City" sends `Local` |
| `tripDate` | yes | Send it with an offset (`+05:30`). Without an offset the server reads it as IST. It must be within the last year / next 30 days |
| `paymentMethod` | yes | `Cash` or `Online (UPI)` |
| `paymentStatus` | yes | `Paid` or `Pending` |
| `grandTotal`, `billNo`, `id`, `createdAt` | — | Don't send them. They are ignored if sent |

**Responses**

- `201` — a new bill was saved.
- `200` — a bill with this `clientRef` already exists; you get the same bill back (safe retry).

```json
{
  "success": true,
  "message": "Bill saved",
  "data": {
    "id": "6720a1b2c3d4e5f607182930",
    "billNo": "GK-000042",
    "rideId": "66f1a2b3c4d5e6f708192a3b",
    "customerName": "Rahul Sharma",
    "customerPhone": "9876543210",
    "companyGst": "ABC Travels / 23ABCDE1234F1Z5",
    "pickupAddress": "Vijay Nagar, Indore",
    "dropAddress": "Ujjain Railway Station",
    "distanceKm": 55.5,
    "tripType": "One Way",
    "tripDate": "2026-10-29T09:00:00.000Z",
    "driverName": "Varun Rajpoot",
    "vehicleNumber": "MP09AB1234",
    "vehicleModel": "Swift Dzire",
    "baseFare": 500,
    "ratePerKm": 12,
    "distanceCharge": 666,
    "toll": 80,
    "parking": 0,
    "waiting": 100,
    "nightDa": 0,
    "extra": 0,
    "discount": 50,
    "subtotal": 1346,
    "grandTotal": 1296,
    "paymentMethod": "Cash",
    "paymentStatus": "Paid",
    "imported": false,
    "createdAt": "2026-10-29T09:05:11.000Z"
  }
}
```

- `tripDate` and `createdAt` come back in UTC (`Z`). Convert to local time for display: `DateTime.parse(s).toLocal()`.
- **Use `billNo` and `grandTotal` from this response** on the PDF, the WhatsApp text and the "Bill Generated & Saved!" sheet.
- Bill numbers are per driver: `GK-000001`, `GK-000002`, … They are never reused, even after a delete.

The server's maths (for reference; the server is the source of truth):

```
distanceCharge = ratePerKm × distanceKm          (0 if either is 0)
subtotal       = baseFare + distanceCharge + toll + parking + waiting + nightDa + extra
grandTotal     = subtotal − discount
```

### 4.3 Validation errors

```json
{
  "success": false,
  "message": "Please fix the highlighted fields",
  "code": "VALIDATION_FAILED",
  "fields": {
    "customerPhone": "Phone must be exactly 10 digits",
    "dropAddress": "Pickup and drop cannot be the same"
  },
  "details": { "codes": { "customerPhone": "INVALID_PHONE", "dropAddress": "PICKUP_DROP_SAME" } }
}
```

- `fields` is at the **top level**, next to `code`. Its keys are the request field names, so show each message under its input.
- `details.codes` has a per-field code if you need one.

| HTTP | `code` | When |
|---|---|---|
| 422 | `VALIDATION_FAILED` (+ `fields`) | Any field rule fails |
| 422 | `DISCOUNT_EXCEEDS_SUBTOTAL` | The discount is larger than the subtotal |
| 422 | `ZERO_TOTAL` | The grand total is 0 |
| 403 | `BILL_RIDE_FORBIDDEN` | `rideId` is not your ride |
| 409 | `BILL_NUMBER_CONFLICT` | A very rare race — retry with the **same** `clientRef` |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 100 KB (create) / 2 MB (import) |
| 429 | `RATE_LIMITED` | More than 60 bills a minute or 500 a day |

A base fare of 0 is fine when `ratePerKm` and `distanceKm` are both given.
With no base fare and no rate × km, you get `fields.baseFare`.

### 4.4 List and search

```
GET /drivers/bills?page=1&limit=20&q=rahul&paymentStatus=Pending&from=2026-10-01&to=2026-10-31&rideId=...
```

| Param | Meaning |
|---|---|
| `page`, `limit` | Default 1 / 20; `limit` max 100 |
| `q` | Contains-search on bill number, customer name, phone and vehicle number (case-insensitive) |
| `paymentStatus` | `Paid` / `Pending` |
| `from`, `to` | IST dates, filtering on `tripDate` |
| `rideId` | Bills made from one ride |

```json
{
  "success": true,
  "data": {
    "results": [ { "...full bill, same shape as create...": "" } ],
    "total": 42,
    "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
  },
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

- Newest first. Deleted bills are not included.
- **Bill Hub:** one call `GET /drivers/bills?limit=3` gives the 3 most recent bills **and** `total` for the "N Saved" badge.
- List items are full bills, so History can rebuild the PDF / text without another call.
- Debounce search input (about 300 ms) before sending `q`.

### 4.5 Get one / delete

```
GET    /drivers/bills/:id       → 200 bill, or 404 BILL_NOT_FOUND
DELETE /drivers/bills/:id       → 200 { "success": true, "message": "Bill deleted", "data": {...} }
```

- Delete is a soft delete and is safe to repeat.
- History currently deletes by `billNo`; switch it to `id`.
- There is **no edit**. A wrong bill means delete it and create a new one (it gets a new number).

### 4.6 One-time import of bills already on the phone

Run this once, on the first launch of the new version, for drivers who have
bills in SharedPreferences (`gokab_driver_saved_bills`).

```
POST /drivers/bills/import
```

```json
{
  "bills": [
    {
      "clientRef": "legacy:1730000000000",
      "legacyBillNo": "GK-482913",
      "createdAt": "2026-09-30T11:02:00.000Z",
      "grandTotal": 1300,
      "customerName": "Rahul Sharma",
      "pickupAddress": "Vijay Nagar, Indore",
      "dropAddress": "Ujjain Railway Station",
      "tripType": "One Way",
      "tripDate": "2026-09-30T16:00:00+05:30",
      "driverName": "Varun Rajpoot",
      "vehicleNumber": "MP09AB1234",
      "vehicleModel": "Swift Dzire",
      "baseFare": 500,
      "paymentMethod": "Cash",
      "paymentStatus": "Paid"
    }
  ]
}
```

- `clientRef` = `"legacy:" + <old local id>`. It must be **stable** so a re-run never creates duplicates.
- Send the old bill number as `legacyBillNo` and the old `grandTotal`. Imported bills keep both, because they were already sent to customers.
- Max **200** bills per call — send them in chunks.

**200 response**

```json
{
  "success": true,
  "data": {
    "imported": 1,
    "skipped": 1,
    "items": [
      { "clientRef": "legacy:1730000000000", "status": "imported", "id": "6720…", "billNo": "GK-482913", "recomputedMismatch": true },
      { "clientRef": "legacy:1730000005555", "status": "exists", "id": "6720…", "billNo": "GK-482777" },
      { "clientRef": "legacy:1730000009999", "status": "skipped", "reason": "Customer name is required" }
    ]
  }
}
```

| `status` | Meaning | Remove from the phone? |
|---|---|---|
| `imported` | Saved now | Yes |
| `exists` | Already imported earlier | Yes |
| `skipped` | Invalid; see `reason` | No — keep it locally and don't retry forever |

- `renamed: true` → the old number clashed with an existing one, so it was saved as `GK-482913-L`.
- `recomputedMismatch: true` → the old total differs from the server formula. This is informational only; the old total is kept.

```dart
Future<void> migrateLocalBills(BillsApi api, LocalBillStore local) async {
  final legacy = await local.readAll();
  if (legacy.isEmpty) return;
  for (var i = 0; i < legacy.length; i += 200) {
    final chunk = legacy.sublist(i, (i + 200).clamp(0, legacy.length));
    final result = await api.importBills(chunk.map((b) => b.toImportJson()).toList());
    final done = result.items
        .where((it) => it.status == 'imported' || it.status == 'exists')
        .map((it) => it.clientRef)
        .toSet();
    await local.removeWhere((b) => done.contains('legacy:${b.id}'));
  }
}
```

### 4.7 Offline / failure behaviour

- If the save fails, show a retry snackbar and **don't share a bill that has
  no server `billNo`**.
- Retry with the **same** `clientRef`. If the first call actually reached the
  server, you get `200` with that bill.
- Change the success text "Saved securely to your offline Bill History." to "Saved to your account".

---

## 5. Part D — One "All Rides" list

Replace the phone-side merge of 4 endpoints with one paginated call.

```
GET /rides?status=upcoming&role=all&origin=driver_created&q=vijay&page=1&limit=20
```

### 5.1 Query params

| Param | Values | Default | Notes |
|---|---|---|---|
| `status` | `all` `upcoming` `ongoing` `completed` `cancelled` | `all` | `upcoming` = waiting for a driver or accepted, not started yet |
| `role` | `all` `driven` `published` `created` `assigned` | `driven` | **Send `all` explicitly** in the new app |
| `origin` | `customer_app` `driver_created` | both | Type chips: Customer / Fleet |
| `q` | text, max 60 chars | — | Pickup, drop, customer name / phone, the last characters of the ride id |
| `from`, `to` | dates | — | Only filter **finished** rides; the period never hides upcoming / ongoing rides |
| `category` | `all` `rides` `parcels` `outstation` `scheduled` | `all` | Unchanged |
| `include_counts` | `0` to skip | on | Chip badges |
| `page`, `limit` | | 1 / 50 | Max 100 |

**What each role returns (driver):**

| `role` | Rides returned |
|---|---|
| `driven` | I am the driver |
| `published` | I created it and someone else drove it |
| `created` | I created it (any driver, including unassigned / published / expired rides) |
| `assigned` | Someone else's network ride that I drive (an owner assigned it, or I got it from the feed) |
| `all` | I drive it or I created it |

**Bad values** → `422` with `INVALID_STATUS`, `INVALID_ROLE`, `INVALID_ORIGIN`
or `INVALID_QUERY` (q over 60 characters). Never a 500.

### 5.2 Order

- **No new params at all** (old builds): newest first, exactly as before.
- With the new params: **ongoing first**, then **upcoming** (immediate rides
  first, then by soonest `scheduledAt`), then **finished** (newest first).
  Pagination is stable: page 2 continues without repeats.

### 5.3 Response

```json
{
  "success": true,
  "data": {
    "results": [ { "...ride row...": "" } ],
    "total": 37,
    "pagination": { "page": 1, "limit": 20, "total": 37, "totalPages": 2, "hasNextPage": true, "hasPrevPage": false },
    "counts": {
      "all": 120, "upcoming": 6, "ongoing": 1, "completed": 108, "cancelled": 5,
      "customer_app": 90, "driver_created": 30
    }
  }
}
```

**`counts` rules:** the status counts ignore the current `status` param, and
the origin counts ignore the current `origin` param, so each chip shows what
you would get by tapping it. `upcoming + ongoing + completed + cancelled == all`.

### 5.4 Ride row — new fields

All the old history fields stay (`_id`, `serviceType`, `status`, `liveStatus`,
`fare`, `pickupAddress`, `dropAddress`, `paymentMethod`, `createdAt`,
`completedAt`, `driverEarnings`, `origin`, `otp`, …). The new fields are:

```json
{
  "id": "6ae5dd1e4cd4e32415837500",
  "my_side": "created",
  "is_overdue": false,
  "notes": "",
  "customer": { "name": "Walk-in Customer", "phone": "9100000077" },
  "assignment": {
    "mode": "direct_assign",
    "target_type": "fleet",
    "assigned_at": "2026-10-31T08:00:00.000Z",
    "acknowledged_at": null,
    "assigned_by": { "driver_id": "6ae5…", "name": "Ram", "phone": "9000000001", "org_name": "Ram Travels" }
  },
  "publish": {
    "status": "open",
    "is_secure": true,
    "total_fare": 5000,
    "driver_payout": 3000,
    "owner_commission": 2000,
    "expires_at": "2026-10-31T20:00:00.000Z"
  },
  "escrow": { "state": "held", "awaiting_payment": false },
  "assigned_driver": { "id": "6ae5…", "name": "Vikas Singh", "phone": "9000000003", "vehicleNumber": "MP09AB1234" },
  "publisher": { "id": "6ae5…", "name": "Ramesh Verma", "org_name": "Ram Travels", "category": "prime", "rating": 4.7, "profile_image": "https://…", "banner_image": "" },
  "amount_for_you": null,
  "vehicle": { "source": "fleet", "fleet_vehicle_id": "66aa…", "number": "MP09AB1234", "model": "Swift Dzire", "type": "sedan", "color": "White" },
  "applicants_count": 2,
  "requests": [ { "...same as §2.7...": "" } ],
  "permissions": {
    "can_assign": false,
    "can_unassign": false,
    "can_reassign": false,
    "can_publish": false,
    "can_unpublish": true,
    "can_review_requests": true,
    "can_cancel": true,
    "can_acknowledge": false,
    "can_decline": false
  }
}
```

| Field | Notes |
|---|---|
| `my_side` | `created` (I made it — this wins even if I also drive it), `assigned` (someone else's network ride that I drive), `driven` (a customer ride I drive) |
| `is_overdue` | The scheduled time has passed and the ride hasn't started |
| `assignment.mode` | `dispatch`, `direct_assign`, `published`, `feed_accept` |
| `assignment.target_type` | `self`, `fleet`, `contact` or `null` |
| `publish`, `escrow`, `publisher` | `null` on customer-app rides |
| `assigned_driver` | Only when someone **else** drives it |
| `amount_for_you` | Only when I took it from the feed; otherwise `null` |
| `applicants_count`, `requests` | Only on my own open published rides |
| `otp` | Only for the driver who actually drives the ride. A publisher looking at a ride someone else drives gets `""` |

### 5.5 Buttons come from `permissions`

**Show action buttons from `permissions` only.** Don't re-derive them from
`status` / `publish` / `assignment`. The server applies the plan, escrow and
ride-state rules.

| Permission | Button | Endpoint |
|---|---|---|
| `can_assign` | Assign | `POST /drivers/network/rides/:id/assign` |
| `can_unassign` | Unassign | `POST /drivers/network/rides/:id/unassign` |
| `can_reassign` | Reassign | `POST /drivers/network/rides/:id/reassign` |
| `can_publish` | Publish | `POST /drivers/network/rides/:id/publish` |
| `can_unpublish` | Unpublish | `DELETE /drivers/network/rides/:id/publish` |
| `can_review_requests` | View requests (badge = `applicants_count`) | `GET /drivers/network/rides/:id/applicants` |
| `can_cancel` | Cancel | `POST /drivers/network/rides/:id/cancel` |
| `can_acknowledge` | Confirm | `POST /drivers/network/rides/:id/acknowledge` |
| `can_decline` | Decline | `POST /drivers/network/rides/:id/reject-assignment` |

### 5.6 Mapping the Rides tab UI

| UI control | Param |
|---|---|
| Type: All / Customer / Fleet | `origin` = none / `customer_app` / `driver_created` |
| Status chips: All / Upcoming / Ongoing / Completed / Cancelled | `status` |
| Role: All / Driven by me / Created by me / Assigned to me | `role` = `all` / `driven` / `created` / `assigned` |
| Search box | `q` (debounced) |
| Period picker | `from` / `to` |
| Chip badges | `data.counts` |

Refetch the current page when any `org:ride:*`, `network:ride:*`, `ride:*` or
`feed:request:*` socket event arrives.

The older endpoints (`/drivers/rides/upcoming`, `/drivers/network/rides`)
still work, so you can switch over whenever you are ready.

---

## 6. Part E — Socket events and push

### 6.1 Socket events (driver room)

| Event | Who gets it | Payload | App reaction |
|---|---|---|---|
| `feed:request:received` | Publisher | `{ rideId, applicant: { driverId, name, rating, vehicleModel, vehicleNumber }, note, applicants_count }` | Toast "New request from Vikas", update the badge, refresh applicants if that screen is open |
| `feed:request:withdrawn` | Publisher | `{ rideId, driverId, applicants_count }` | Update the badge / remove from the list |
| `feed:request:approved` | Applicant | `{ rideId }` | Toast "Request approved!", refresh Upcoming and the feed, open the ride |
| `feed:request:rejected` | Applicant | `{ rideId, reason, reason_text }` | Set the button to "Not selected", toast `reason_text` |
| `network:ride:taken` | Publisher | existing payload | Already handled — it also fires on approve |
| `feed:driver:removed` | Feed room | `{ rideId, reason }` — `TAKEN` / `UNPUBLISHED` / `CANCELLED` / `EXPIRED` | Remove the card from the feed |

`rating` in `feed:request:received` may be `null`.

```dart
socket.on('feed:request:received', (data) {
  final rideId = data['rideId'] as String;
  final count = data['applicants_count'] as int? ?? 0;
  ridesController.setApplicantsCount(rideId, count);
  final name = (data['applicant']?['name'] ?? 'A driver') as String;
  showToast('$name requested your ride');
});

socket.on('feed:request:rejected', (data) {
  feedController.setMyRequestStatus(data['rideId'] as String, 'rejected');
  showToast((data['reason_text'] ?? 'Your request was not accepted.') as String);
});

socket.on('feed:request:approved', (data) {
  feedController.remove(data['rideId'] as String);
  ridesController.refreshUpcoming();
  showToast('Request approved — the ride is yours');
});
```

### 6.2 Push (FCM) types

All `data` values are strings. Route by `data.type`.

| `data.type` | To | Data | Opens |
|---|---|---|---|
| `ride_request_received` | Publisher | `rideId`, `driverId`, `applicantsCount` | The ride's applicants screen |
| `ride_request_approved` | Applicant | `rideId` | The ride |
| `ride_request_rejected` | Applicant | `rideId`, `reason` | The network feed |
| `network_ride_assigned` (existing) | Assigned driver | unchanged; the body now includes the vehicle | Rides tab |

### 6.3 Rejection reasons

`reason_text` comes with the socket event. For a push, map `reason` yourself:

| `reason` | Text |
|---|---|
| `publisher_rejected` | The publisher chose someone else. *(or the publisher's own text — socket only)* |
| `ride_taken` | The ride was given to another driver. |
| `ride_expired` | The ride expired before anyone was chosen. |
| `ride_cancelled` | The ride was cancelled. |
| `insufficient_wallet` | Your wallet did not have enough balance for the escrow hold. |
| `driver_unavailable` | Your account is not available to take rides right now. |

---

## 7. Error code reference

| Code | HTTP | Area | Meaning |
|---|---|---|---|
| `APPROVAL_REQUIRED` | 409 | Feed | Old accept on a published ride — use Request |
| `ALREADY_REQUESTED` | 409 | Feed | Already requested / rejected |
| `REQUEST_LIMIT_REACHED` | 409 | Feed | 20 pending requests on this ride |
| `RATE_LIMITED` | 429 | Feed / Bills | Too many calls |
| `REQUEST_NOT_FOUND` | 404 | Feed / Applicants | No such request |
| `NOT_A_PUBLISHED_RIDE` | 409 | Feed | A customer lead — use Accept |
| `DRIVER_NOT_AVAILABLE` | 403 | Feed | The account can't take rides |
| `APPLICANT_NOT_PENDING` | 409 | Applicants | Already withdrawn / rejected |
| `APPLICANT_WALLET_LOW` | 402 | Approve | The applicant can't fund the hold; the ride stays open |
| `APPLICANT_BUSY` | 409 | Approve | The applicant has an overlapping trip |
| `APPLICANT_UNAVAILABLE` | 409 | Approve | The applicant is blocked / deleted |
| `PUBLISHER_INSUFFICIENT_WALLET` | 402 | Approve | Your wallet is too low |
| `INSUFFICIENT_WALLET` | 402 | Feed | Your wallet is too low (`details.required`, `details.available`) |
| `RIDE_ALREADY_TAKEN` | 409 | Feed / Approve | Someone else has the ride |
| `RIDE_NOT_OPEN` | 409 | Feed / Approve / Assign | Closed, expired, your own ride, or still published |
| `RIDE_NOT_FOUND` | 404 | Any | Not found, or not yours |
| `INVALID_VEHICLE_NUMBER` | 422 | Vehicle | Bad plate |
| `INVALID_VEHICLE_DETAILS` | 422 | Vehicle | Bad model / type / colour |
| `INVALID_VEHICLE_SOURCE` | 422 | Vehicle | Unknown source |
| `DRIVER_HAS_NO_VEHICLE` | 422 | Vehicle | No profile vehicle |
| `INVALID_FLEET_VEHICLE` | 422 | Vehicle | Not your fleet / no fleet access |
| `VEHICLE_NOT_APPROVED` | 422 | Vehicle | The fleet vehicle is pending |
| `VALIDATION_FAILED` | 422 | Bills | See `fields` |
| `DISCOUNT_EXCEEDS_SUBTOTAL` | 422 | Bills | |
| `ZERO_TOTAL` | 422 | Bills | |
| `BILL_RIDE_FORBIDDEN` | 403 | Bills | `rideId` is not yours |
| `BILL_NOT_FOUND` | 404 | Bills | |
| `BILL_NUMBER_CONFLICT` | 409 | Bills | Retry with the same `clientRef` |
| `IMPORT_TOO_LARGE` | 422 | Bills | More than 200 bills in one import |
| `PAYLOAD_TOO_LARGE` | 413 | Bills | The body is too big |
| `INVALID_STATUS` / `INVALID_ROLE` / `INVALID_ORIGIN` / `INVALID_QUERY` | 422 | All Rides | Bad filter |
| `INVALID_DATE_RANGE` | 422 | All Rides / Bills | Bad `from` / `to` |
| `INVALID_ID` | 400 | Any | A malformed id in the URL |

Existing codes the app must keep handling: `INSUFFICIENT_WALLET_FOR_CONTACT`,
and `RETRYABLE` (a write conflict — retry once).

---

## 8. Differences from the spec draft

The server follows the spec except for these points. Build against **this** list.

| The spec draft said | The server actually does | Why |
|---|---|---|
| Approve response `"escrow": "held"` | `"escrow_result": "held"` | `escrow` is already an object on the ride |
| `vehicle_warning: "TYPE_MISMATCH"` (one string) | `vehicle_warnings: ["TYPE_MISMATCH", ...]` (an array) | A ride can have two warnings |
| Fleet availability `busy_until` | `booked_until` | Same meaning |
| Bill errors as top-level codes like `INVALID_BASE_FARE` | `VALIDATION_FAILED` + `fields` (+ `details.codes`) | Matches spec §C5.3: one code for all field errors |
| Assigning directly while published rejects the requests | `409 RIDE_NOT_OPEN` "Unpublish first" | An existing rule; unpublishing rejects the requests |
| `assigned_by.id` | `assigned_by.driver_id` | The existing field name |
| The org owner can also approve | Only the driver who created the ride | Owner accounts can't manage network rides yet |

---

## 9. Release order and old app builds

1. **The backend ships first.** Every new field is additive, so old builds keep working.
2. Old builds that call Accept on a published ride get `409 APPROVAL_REQUIRED`
   with the message "Send a request instead — the publisher approves who gets
   this ride." Make sure old builds show the error `message` (they already do
   for unknown codes).
3. If the new app is not ready when the backend goes live, admin can turn
   approval **off** (`feed_requires_approval = false`) so old builds keep the
   instant Accept. Turn it back on once the new build is the minimum version.
4. Customer leads, `/drivers/rides/upcoming` and `/drivers/network/rides`
   are unchanged; drop them from the app at your own pace.

---

## 10. QA checklist for the app

**Part A**
- [ ] The feed shows Request / Requested / Not selected from `my_request_status`
- [ ] Request with a note → the publisher gets a toast and a push, the badge shows 1
- [ ] Withdraw → the badge drops; requesting again works
- [ ] The publisher opens applicants and sees photo / rating / trips / vehicle / note; `rating: null` shows "New"
- [ ] Approve → the applicant gets "approved", the others get "not selected", the card leaves the feed
- [ ] Approving an applicant with a low wallet → 402 message, the list refreshes, the ride is still open
- [ ] Reject with a reason → the applicant sees that reason
- [ ] Unpublish / cancel / expiry → applicants get "not selected" with the right text
- [ ] The old Accept on a published ride shows the server message
- [ ] No fake applicants in a release build

**Part B**
- [ ] Create + assign with the driver's own / a fleet / a custom vehicle
- [ ] Custom plate `mp09 xy 9999` comes back as `MP09XY9999`
- [ ] A bad plate shows the error under the field, and nothing was assigned
- [ ] `vehicle_warnings` show as a yellow snackbar
- [ ] Ride detail, the upcoming card and All Rides show `vehicle`
- [ ] Notes no longer contain "Assigned Vehicle: …"

**Part C**
- [ ] Save → the server `billNo` and `grandTotal` appear on the PDF, the text and the success sheet
- [ ] Retrying after a timeout with the same `clientRef` → the same bill, no duplicate
- [ ] Field errors appear under the right inputs
- [ ] History search by name / phone / bill number; pagination works
- [ ] Delete uses `id`
- [ ] After a reinstall the bills are still there
- [ ] First-launch import: local bills are uploaded, and only `imported` / `exists` ones are removed locally

**Part D**
- [ ] All chips and badges match `counts`
- [ ] The Fleet filter shows only network rides on every page
- [ ] Upcoming shows rides scheduled next month even with "This month" selected
- [ ] Buttons follow `permissions`
- [ ] A publisher doesn't see the OTP of a ride someone else drives
