# Driver App Master Spec — Flutter Guide

What changed on the backend for the driver app, and what the app has to do.
Base URL: `https://gokab.in/api/v1`. All calls use the driver's Bearer token.

Every response uses the usual envelope:

```json
{ "success": true, "data": { ... } }
{ "success": false, "message": "Human text", "code": "MACHINE_CODE", "details": { ... } }
```

**Always branch on `code`, never on `message`.** Messages may change; codes will not.

| Part | What it is |
|---|---|
| A | Published rides now need the publisher's approval: request → approve |
| B | Choose which vehicle goes on a ride when creating / assigning it |
| C | Bills are saved on the server (numbering, totals, history) |
| D | One "All Rides" list with filters, search, counts and per-ride buttons |
| E | Socket events, push types and error codes for all of the above |

---

## Part A — Request → approve for published rides

### What changed

Before: a driver tapped **Accept** on a feed ride and got it instantly.
Now: the driver **requests** the ride, the publisher sees the list of
applicants and **approves** one. Approval is when the ride is assigned and the
escrow is held.

The old accept call still exists. On a published ride it now returns
`409 APPROVAL_REQUIRED`. If you get that code, switch the button to **Request**.
Admin can turn approval off (`feed_requires_approval` setting); then accept
works as before. Read `accept.requires_approval` on the feed item to know which
button to show.

### A.1 Feed item — new fields

`GET /drivers/feed?tab=driver` items now carry:

```json
{
  "id": "6ae5dd1e4cd4e32415837500",
  "has_requested": true,
  "my_request_status": "pending",
  "applicants_count": 2,
  "accept": { "requires_approval": true, "...": "existing fields" }
}
```

`my_request_status`: `null` | `pending` | `approved` | `rejected` | `withdrawn`

| State | Button |
|---|---|
| `requires_approval == false` | **Accept** (old flow) |
| `my_request_status == null` or `withdrawn` | **Request ride** |
| `pending` | **Requested ✓** + "Withdraw" |
| `rejected` | Disabled "Not selected" |
| `approved` | The ride is now yours — open it |

### A.2 Request a ride (applicant)

```
POST /drivers/feed/rides/:rideId/request
{ "note": "I'm 5 min away" }        // optional, max 300 chars
```

Response `200`:

```json
{ "requested": true, "rideId": "...", "status": "pending", "applicants_count": 2 }
```

Nothing is held from the wallet yet. The server only checks the wallet has
enough **available** balance for the hold (`INSUFFICIENT_WALLET` if not); the
real hold happens at approval.

| Code | HTTP | Show |
|---|---|---|
| `ALREADY_REQUESTED` | 409 | Already requested (or was rejected — `details.status`) |
| `RIDE_NOT_OPEN` | 409 | Ride closed / it is your own ride |
| `RIDE_ALREADY_TAKEN` | 409 | Someone else got it |
| `NOT_A_PUBLISHED_RIDE` | 404 | Remove from list |
| `INSUFFICIENT_WALLET` | 402 | "You need ₹`details.required` available" → wallet top-up |
| `REQUEST_LIMIT_REACHED` | 409 | Ride has 20 pending requests already |
| `RATE_LIMITED` | 429 | Too many requests this hour (limit 30) |
| `DRIVER_NOT_AVAILABLE` | 403 | Account can't take rides |

A driver who was **rejected** cannot request the same publish again. If the
publisher unpublishes and republishes, everyone can request again.

### A.3 Withdraw (applicant)

```
DELETE /drivers/feed/rides/:rideId/request
```

Response: `{ "withdrawn": true, "rideId": "...", "applicants_count": 1 }`.
`REQUEST_NOT_FOUND` (404) if there is no pending request. A withdrawn driver
may request again.

### A.4 List applicants (publisher)

```
GET /drivers/network/rides/:rideId/applicants            // pending only
GET /drivers/network/rides/:rideId/applicants?status=all // include rejected/withdrawn
```

```json
{
  "results": [
    {
      "driverId": "...",
      "name": "Vikas Singh",
      "phone": "9000000003",
      "avatar": "https://gokab.in/api/images/...",
      "rating": 4.8,
      "trips": 132,
      "vehicleModel": "Swift Dzire",
      "vehicleNumber": "MP09AB1234",
      "vehicleType": "sedan",
      "status": "pending",
      "note": "I'm 5 min away",
      "requestedAt": "2026-10-31T09:12:00.000Z"
    }
  ],
  "total": 1
}
```

Sorted first-come first. `rating` may be `null` (no ratings yet). Only the
publisher can call this; anyone else gets `404`.

The publisher's own lists also carry a preview, so you don't need a call per row:

- `GET /drivers/network/rides` (created rides) and `GET /rides` (Part D) rows:
  `applicants_count` and `requests` (first 5 applicants, same shape as above).

### A.5 Approve (publisher)

```
POST /drivers/network/rides/:rideId/applicants/:driverId/approve
```

On success (`200`) the ride is assigned to that driver, their vehicle is put on
the ride, the escrow is held, and every other pending applicant is rejected
with `ride_taken`. The response is the normal network ride object plus:

```json
{ "...ride fields...", "escrow_result": "held", "is_secure": true }
```

(`escrow_result` is `"held"` or `"none"`. It is not called `escrow` because the
ride already has an `escrow` object.)

| Code | HTTP | Meaning / what to do |
|---|---|---|
| `APPLICANT_WALLET_LOW` | 402 | That driver can't fund the hold. They are rejected, **the ride stays open** — refresh applicants and pick another. `details.driverId` |
| `PUBLISHER_INSUFFICIENT_WALLET` | 402 | Your own wallet can't fund your side → top-up |
| `APPLICANT_BUSY` | 409 | Driver now has another trip at that time. `details.conflictingRideId` |
| `APPLICANT_UNAVAILABLE` | 409 | Driver account blocked/deleted |
| `APPLICANT_NOT_PENDING` | 409 | They withdrew or were already rejected — refresh |
| `RIDE_ALREADY_TAKEN` / `RIDE_NOT_OPEN` | 409 | Ride already assigned / closed — refresh |
| `REQUEST_NOT_FOUND` | 404 | That driver never requested |

Two approve taps at once are safe: exactly one wins, the other gets `409`.

### A.6 Reject (publisher)

```
POST /drivers/network/rides/:rideId/applicants/:driverId/reject
{ "reason": "Vehicle not suitable" }      // optional, max 200 chars
```

Response: `{ "rejected": true, "rideId": "...", "applicants_count": 0 }`.

### A.7 When requests close on their own

| Event | Pending requests become | `reason` |
|---|---|---|
| Publisher approves someone else | rejected | `ride_taken` |
| Publisher rejects | rejected | `publisher_rejected` |
| Publisher unpublishes / ride cancelled (by anyone, incl. admin) | rejected | `ride_cancelled` |
| Listing expires | rejected | `ride_expired` |
| Applicant can't fund hold at approval | rejected | `insufficient_wallet` |
| Applicant account blocked | rejected | `driver_unavailable` |

The applicant gets a socket event and a push for each (see Part E).

---

## Part B — Choosing the vehicle

A ride now carries its own vehicle. Before, the app always showed the driver's
profile vehicle. Now the creator can pick **the driver's own vehicle**, **a
fleet vehicle**, or **type one in**.

### B.1 Sending it

On `POST /drivers/network/rides` (with `assign_to_driver_id`),
`POST /drivers/network/rides/:id/assign` and `/reassign`, add:

```json
"vehicle": { "source": "driver_default" }

"vehicle": { "source": "fleet", "fleet_vehicle_id": "..." }

"vehicle": { "source": "custom", "number": "MP09 XY 9999", "model": "Bajaj Pulsar 150", "type": "bike", "color": "Black" }
```

Leave `vehicle` out → the assigned driver's own vehicle is used (same as before).
The old flat `vehicleNumber` / `vehicleModel` body fields still work and are
treated as `custom`.

- Plates are cleaned: `mp09 xy-9999` → `MP09XY9999`. Normal Indian plates and
  BH-series are accepted.
- `fleet` needs the **Prime** tier (fleet permission) and the vehicle must belong
  to **your** organisation and be approved.

| Code | HTTP | Show |
|---|---|---|
| `INVALID_VEHICLE_NUMBER` | 422 | Bad plate format |
| `INVALID_VEHICLE_DETAILS` | 422 | Missing model / bad fields |
| `INVALID_VEHICLE_SOURCE` | 422 | Unknown `source` |
| `DRIVER_HAS_NO_VEHICLE` | 422 | `driver_default` but the driver has no vehicle on profile |
| `INVALID_FLEET_VEHICLE` | 422 | Not your fleet / no fleet permission |
| `VEHICLE_NOT_APPROVED` | 422 | Fleet vehicle still pending |

If the vehicle check fails, **nothing changes** — the ride is not assigned (and
on reassign the old driver stays).

### B.2 Warnings (not errors)

The ride is saved, but the response has `vehicle_warnings`:

```json
"vehicle_warnings": [
  { "code": "TYPE_MISMATCH", "message": "..." },
  { "code": "VEHICLE_BUSY", "message": "...", "rideId": "..." }
]
```

Show them as a yellow snackbar. Always an array (empty when fine).

### B.3 Reading it

Every ride object now has:

```json
"vehicle": { "source": "fleet", "fleet_vehicle_id": "...", "number": "MP09AB1234", "model": "Swift Dzire", "type": "sedan", "color": "White" }
```

On `GET /rides/:id` and the active-ride call, `driverId.vehicleNumber` /
`vehicleModel` on the driver card **already show the ride's vehicle**, so old
screens show the right car without changes. Prefer `data.vehicle` in new code.

The vehicle is also in the "ride assigned" push body and socket payload.

### B.4 Picking a fleet vehicle

`GET /drivers/network/fleet/availability` now also returns:

```json
"vehicles": [
  { "vehicle_id": "...", "number": "MP09AB1234", "model": "Swift Dzire", "color": "White",
    "status": "approved", "selectable": true, "on_ride": false, "booked_until": null }
]
```

Grey out `selectable == false`. Show a "On a ride" badge when `on_ride`.

### B.5 Bug fix

Creating a ride with a label like `"vehicleTypeId": "bike"` used to fail. It now
falls back to the driver's real vehicle type.

---

## Part C — Bills on the server

The app still makes the PDF and the WhatsApp text. The server now stores the
bill, **gives the bill number** and **recomputes the totals**.

### C.1 Create

```
POST /drivers/bills
```

```json
{
  "clientRef": "3f1c2a9e-....",          // UUID made by the app per save attempt
  "rideId": "...",                        // optional, must be your ride
  "customerName": "Rahul Sharma",
  "customerPhone": "+91 98765 43210",
  "companyGst": "ABC Travels",
  "pickupAddress": "Vijay Nagar, Indore",
  "dropAddress": "Ujjain Railway Station",
  "distanceKm": 55.5,
  "tripType": "One Way",                  // One Way | Round Trip | Local | Outstation
  "tripDate": "2026-10-31T09:00:00",      // IST if no timezone
  "driverName": "Vikas Singh",
  "vehicleNumber": "MP09 AB 1234",
  "vehicleModel": "Swift Dzire",
  "baseFare": 500, "ratePerKm": 12,
  "toll": 80, "parking": 0, "waiting": 100, "nightDa": 0, "extra": 0, "discount": 50,
  "paymentMethod": "Cash",                // Cash | Online (UPI)
  "paymentStatus": "Paid"                 // Paid | Pending
}
```

`201` new bill · `200` same `clientRef` sent again (returns the same bill —
safe to retry on timeout).

Response (`data`): the same fields back, cleaned, plus `id`, `billNo`
(`GK-000123`), `distanceCharge`, `subtotal`, `grandTotal`, `createdAt`.

**Use the server's `billNo` and `grandTotal` on the PDF**, not the app's.

```
distanceCharge = ratePerKm × distanceKm
subtotal       = baseFare + distanceCharge + toll + parking + waiting + nightDa + extra
grandTotal     = subtotal − discount
```

Errors:

| Code | HTTP | |
|---|---|---|
| `VALIDATION_FAILED` | 422 | `fields` map → show under each input, e.g. `{"customerPhone": "Phone must be exactly 10 digits"}` |
| `DISCOUNT_EXCEEDS_SUBTOTAL` | 422 | |
| `ZERO_TOTAL` | 422 | |
| `BILL_RIDE_FORBIDDEN` | 403 | `rideId` isn't your ride |
| `RATE_LIMITED` | 429 | 60/min, 500/day |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 100 KB (create) / 2 MB (import) — split the import into smaller calls |

`fields` is at the **top level** of the error body, next to `code`.

### C.2 List / get / delete

```
GET /drivers/bills?page=1&limit=20&q=rahul&paymentStatus=Pending&from=2026-10-01&to=2026-10-31&rideId=...
```

```json
{ "success": true,
  "data": { "results": [ ...bills newest first... ], "total": 42,
            "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } },
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }
```

`q` searches bill number, customer name, phone and vehicle number. `from`/`to`
are IST dates.

```
GET    /drivers/bills/:id        // 404 BILL_NOT_FOUND
DELETE /drivers/bills/:id        // soft delete, safe to repeat
```

Bills are never edited. Deleted numbers are never reused.

### C.3 One-time import of bills already on the phone

```
POST /drivers/bills/import
{ "bills": [ { ...same fields..., "clientRef": "legacy:<local id>", "legacyBillNo": "GK-482913", "createdAt": "2026-09-30T11:02:00.000Z" } ] }
```

Max 200 per call. Response:

```json
{ "imported": 1, "skipped": 1,
  "items": [ { "clientRef": "legacy:1730000000000", "status": "imported", "billNo": "GK-482913", "recomputedMismatch": true },
             { "clientRef": "legacy:1730000009999", "status": "skipped", "reason": "..." } ] }
```

- Keeps the old bill number (adds `-L` if it clashes) and the old total.
- `recomputedMismatch: true` = the old total differs from the server formula. Just informational.
- Running it again is safe: already-saved bills come back as `status: "exists"` (with `id`, `billNo`). Use a stable `clientRef` per local bill.
- After a successful import, read bills from the server only.

---

## Part D — One "All Rides" list

```
GET /rides?status=upcoming&role=all&origin=driver_created&q=vijay&page=1&limit=20
```

| Param | Values | Default |
|---|---|---|
| `status` | `all` `upcoming` `ongoing` `completed` `cancelled` | `all` |
| `role` | `all` `driven` `published` `created` `assigned` | driven (old behaviour) |
| `origin` | `customer_app` `driver_created` | both |
| `q` | text, max 60 chars (name, phone, address, last digits of id) | — |
| `from` / `to` | dates; filter **finished** rides only | — |
| `include_counts` | `0` to skip counts | on |

- `upcoming` = searching or accepted. `ongoing` = started / arrived.
- With no params the list is exactly as before (newest first). When you use the
  new params, **live rides come first**, then upcoming, then finished.
- Bad values → `422` `INVALID_STATUS` / `INVALID_ROLE` / `INVALID_ORIGIN` / `INVALID_QUERY`.

Response adds `counts` for the tab badges:

```json
"counts": { "all": 58, "upcoming": 4, "ongoing": 1, "completed": 50, "cancelled": 3,
            "customer_app": 20, "driver_created": 38 }
```

Every row adds:

```json
{
  "id": "...",
  "my_side": "created",              // driven | published | created | assigned
  "is_overdue": false,
  "customer": { "name": "...", "phone": "..." },
  "assignment": { "...": "...", "assigned_by": { "id": "...", "name": "..." } },
  "publish": { "status": "open", "...": "..." },
  "escrow": { "state": "held", "awaiting_payment": false },
  "assigned_driver": { "id": "...", "name": "...", "phone": "..." },
  "publisher": { "id": "...", "name": "..." },
  "amount_for_you": 3000,
  "vehicle": { "...": "Part B shape" },
  "applicants_count": 2,
  "requests": [ ],
  "permissions": {
    "can_assign": false, "can_unassign": false, "can_reassign": false,
    "can_publish": false, "can_unpublish": true, "can_review_requests": true,
    "can_cancel": true, "can_acknowledge": false, "can_decline": false
  }
}
```

**Show action buttons from `permissions` only.** The server works out who may
do what on each ride; don't re-implement the rules in the app.

The **OTP** is only sent to the driver actually driving the ride (and the
rider). A publisher looking at a ride someone else drives gets `otp: ""`.

Riders can call the same URL; driver-only params are ignored for them.

---

## Part E — Events, push and codes

### Socket events (driver room)

| Event | Who gets it | Payload |
|---|---|---|
| `feed:request:received` | publisher | `{ rideId, applicant{driverId,name,avatar,rating,trips,vehicleModel,vehicleNumber}, note, applicants_count }` |
| `feed:request:withdrawn` | publisher | `{ rideId, driverId, applicants_count }` |
| `feed:request:approved` | applicant | `{ rideId }` → open the ride |
| `feed:request:rejected` | applicant | `{ rideId, reason, reason_text }` |
| `network:ride:taken` | publisher | existing event, also fired on approve |
| `feed:driver:removed` | feed | ride left the feed (taken / cancelled / expired) → remove the card |

### Push `data.type`

| type | Extra data (all strings) |
|---|---|
| `ride_request_received` | `rideId`, `driverId`, `applicantsCount` |
| `ride_request_approved` | `rideId` |
| `ride_request_rejected` | `rideId`, `reason` |

`reason_text` you can show directly:

| reason | text |
|---|---|
| `publisher_rejected` | The publisher chose someone else. |
| `ride_taken` | The ride was given to another driver. |
| `ride_expired` | The ride expired before anyone was chosen. |
| `ride_cancelled` | The ride was cancelled. |
| `insufficient_wallet` | Your wallet did not have enough balance for the escrow hold. |
| `driver_unavailable` | Your account is not available to take rides right now. |

### Other fixes the app will notice

- A bad id in any URL now returns `400 INVALID_ID` instead of `500`.
- A ride cancelled by admin or the rider now also leaves the published feed.
- The rider's deliveries list no longer crashes.

---

## Checklist for the app

- [ ] Feed: Request / Requested / Withdraw buttons from `my_request_status`; handle `APPROVAL_REQUIRED` on old accept
- [ ] Publisher: applicants screen, approve / reject, badge from `applicants_count`
- [ ] Handle `APPLICANT_WALLET_LOW` by refreshing the list (ride is still open)
- [ ] Listen to the four `feed:request:*` events and three push types
- [ ] Vehicle picker on create / assign (own / fleet / custom) and show `vehicle_warnings`
- [ ] Show `data.vehicle` on ride screens
- [ ] Bills: send `clientRef`, use server `billNo` + `grandTotal`, show `fields` errors
- [ ] One-time bill import, then read bills from the server
- [ ] All Rides tab: `status` / `role` / `origin` / `q`, badges from `counts`, buttons from `permissions`
