# GoKab Driver Network — Flutter Integration Guide

**Audience:** Flutter developer building the driver app (and the rider-app additions).
**Backend status:** implemented, tested and merged on `feat/driver-network-module`.
**This document describes the API as it actually exists**, not the original spec — several
paths and field names differ from the spec document, and those differences are called out.

---

## Table of contents

1. [What you are building](#1-what-you-are-building)
2. [Base URL, auth and response envelope](#2-base-url-auth-and-response-envelope)
3. [Error handling — read this before writing any screen](#3-error-handling--read-this-before-writing-any-screen)
4. [Sockets: connecting and the full event list](#4-sockets-connecting-and-the-full-event-list)
5. [Screen 1 — Plan / category](#5-screen-1--plan--category)
6. [Screen 2 — My routes](#6-screen-2--my-routes)
7. [Screen 3 — Create a ride](#7-screen-3--create-a-ride)
8. [Screen 4 — My network rides](#8-screen-4--my-network-rides)
9. [Screen 5 — Assign to a fleet driver](#9-screen-5--assign-to-a-fleet-driver)
10. [Screen 6 — Publish to the network](#10-screen-6--publish-to-the-network)
11. [Screen 7 — The feed (home)](#11-screen-7--the-feed-home)
12. [Screen 8 — Lead chat](#12-screen-8--lead-chat)
13. [Screen 9 — Wallet with frozen balance](#13-screen-9--wallet-with-frozen-balance)
14. [Screen 10 — Completing a ride: who took the money](#14-screen-10--completing-a-ride-who-took-the-money)
15. [Screen 11 — Owner live map](#15-screen-11--owner-live-map)
16. [Rider app additions](#16-rider-app-additions)
17. [Vehicle registration changes](#17-vehicle-registration-changes)
18. [Complete endpoint reference](#18-complete-endpoint-reference)
19. [Suggested model classes](#19-suggested-model-classes)
20. [Things that will bite you](#20-things-that-will-bite-you)

---

## 1. What you are building

Drivers now belong to one of three **categories**, decided by the recharge plan they buy:

| Category | Create rides | Publish to network | Manage own fleet | Routes | Contact fee (customer lead) |
|---|---|---|---|---|---|
| **Lower** | no | no | no | 2 | charged (default ₹20) |
| **Middle** | yes | yes | no | 5 | free |
| **Prime** | yes | yes | **yes** | 10 | free |

Everything a category unlocks comes from `GET /drivers/category`. **Never hardcode these
numbers or branch on the plan's name** — a deployment may sell these categories under its
own names (the live database currently sells them as "Premium" = middle and
"Super Premium" = prime). Always read the permission flags.

The five new surfaces you need to build:

1. **Feed** (driver home) — two tabs: rides published by other drivers, and rides requested by app users
2. **Create + assign rides** — a Prime/Middle driver books for a walk-in customer, then either assigns it to one of their own drivers or publishes it
3. **Lead chat** — messaging a ride's owner *before* taking the ride
4. **Wallet with frozen balance** — money locked against a ride you accepted
5. **Owner live map** — an org owner watching their drivers

---

## 2. Base URL, auth and response envelope

```
Base: {API_HOST}/api/v1
```

Both `/api` and `/api/v1` are mounted; use `/api/v1`.

Auth is the **existing driver JWT** — no new login flow. Send it as usual:

```dart
headers: {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer $token',
}
```

> ⚠️ **Path differs from the spec.** The spec says `/driver/...`. The real prefix is
> **`/drivers/...`** (plural), matching the existing driver routes.

Every response is wrapped:

```json
{ "success": true, "data": { ... } }
```

Errors:

```json
{
  "success": false,
  "message": "Human readable, safe to show the user",
  "code": "MACHINE_CODE",
  "details": { "required": 2000, "available": 500 }
}
```

---

## 3. Error handling — read this before writing any screen

**Branch on `code`, show `message`.** The `code` field is stable; the message wording is not.

```dart
class ApiException implements Exception {
  final int status;
  final String message;   // safe to display
  final String? code;     // branch on this
  final Map<String, dynamic>? details;
  ApiException(this.status, this.message, this.code, this.details);
}

ApiException parseError(int status, Map<String, dynamic> body) => ApiException(
  status,
  body['message'] as String? ?? 'Something went wrong',
  body['code'] as String?,
  body['details'] as Map<String, dynamic>?,
);
```

### Codes you must handle with a specific UI

| Code | HTTP | What it means | What the UI should do |
|---|---|---|---|
| `CATEGORY_NOT_ALLOWED` | 403 | Their plan doesn't include this action | Show an upgrade prompt, not a generic error |
| `PRIME_SLOTS_FULL` | 409 | All Prime seats in their city are taken | Disable the Prime plan card, show "slots full" |
| `NEED_COMMERCIAL_VEHICLE` | 422 | No commercial vehicle registered | Deep-link to add-vehicle |
| `NEED_PRIVATE_VEHICLE` | 422 | No private vehicle registered | Deep-link to add-vehicle |
| `ROUTE_LIMIT_REACHED` | 403 | At their plan's route limit | Show limit + upgrade prompt |
| `INVALID_STOPS` | 422 | Fewer than 2 or more than 10 stops, or bad coordinates | Inline form error |
| `INVALID_SPLIT` | 422 | commission + payout ≠ total | Inline error on the publish form |
| `INSUFFICIENT_WALLET` | 402 | Not enough **available** balance for the hold or fee | Open top-up with `details.required` prefilled |
| `INSUFFICIENT_WALLET_FOR_PUBLISH` | 402 | Publisher can't back the payout | Open top-up |
| `INSUFFICIENT_WALLET_FOR_CONTACT` | 402 | Can't afford the contact fee | Open top-up |
| `RIDE_ALREADY_TAKEN` | 409 | Another driver won the race | Remove the card from the feed, toast |
| `RIDE_NOT_OPEN` | 409 | Lead expired, was unpublished, or already assigned | Refresh the feed |
| `RIDE_ALREADY_STARTED` | 409 | Can't unassign after the OTP | Disable the button once `liveStatus == 'started'` |
| `DRIVER_NOT_IN_FLEET` | 403 | Target driver isn't in their organisation | Shouldn't happen if you only list fleet drivers |
| `DRIVER_BUSY` | 409 | Target is on a ride or has a clashing schedule | Grey out that driver in the picker |
| `COLLECTED_BY_REQUIRED` | 422 | Completing an escrow ride without saying who took the fare | **Block the complete button** until chosen — see §14 |
| `PUBLISH_TOO_LATE` | 422 | Scheduled too close to now to publish | Inline error with `details.required_minutes` |
| `COMMERCIAL_PERMIT_REQUIRED` | 400 | Commercial vehicle added without a permit document | Require the upload |
| `ESCROW_STATE_INVALID` | 409 | Already settled/released | Refresh; no retry |
| `DISPUTE_WINDOW_CLOSED` | 409 | Dispute window has passed | Hide the dispute button |
| `CONVERSATION_CLOSED` | 409 | Ride was taken; chat is read-only | Disable the composer |
| `RATE_LIMITED` | 429 | More than 20 messages a minute | Throttle the composer |

There is also a **retryable** flag on write conflicts:

```json
{ "success": false, "message": "This action collided with another update…", "retryable": true }
```

Retry once automatically when `retryable == true`.

---

## 4. Sockets: connecting and the full event list

Socket.IO 4. The token goes in `auth`, **not** in a query string or header:

```dart
final socket = IO.io(
  socketUrl,
  IO.OptionBuilder()
      .setTransports(['websocket'])
      .setAuth({'token': jwt})          // ← this is what the server reads
      .build(),
);
```

> ⚠️ **Use an IP or a real hostname, not `localhost`.** On IPv6-capable devices `localhost`
> resolves to `::1` while the server binds IPv4, and the handshake is refused while plain
> HTTP still works. This exact bug cost us an afternoon.

### Rooms you are put in automatically

On connect the server joins you to, based on your role:

- `driver:<yourId>` — anything addressed to you personally
- `publisher:<yourId>` — updates about rides *you* published
- `org:<ownerId>` — if you own an organisation (Prime)
- `feed:city:<serviceLocationId>` — new leads in your city

You don't join these yourself. The only room you join manually is a lead conversation.

### Events you receive (server → app)

**Feed**

| Event | Payload | Do this |
|---|---|---|
| `feed:driver:new` | `{ rideId, pickup, drop, amount_for_you, expires_at }` | Insert a card at the top of the Driver tab |
| `feed:driver:removed` | `{ rideId, reason }` — `TAKEN` / `EXPIRED` / `UNPUBLISHED` | Remove that card |
| `feed:customer:new` | `{ rideId, pickup, drop, fare, scheduledAt }` | Insert into the Customer tab |
| `feed:customer:removed` | `{ rideId, reason }` — `TAKEN` / `CANCELLED` / `UNMATCHED` | Remove that card |

**Your rides**

| Event | Payload | Do this |
|---|---|---|
| `network:ride:assigned` | pickup, drop, customer, otp, `assignedBy {name, org_name}` | Full-screen "new ride assigned" |
| `network:ride:unassigned` | `{ rideId, reason }` | Remove from active, toast |
| `network:ride:taken` | `{ rideId, driverId, held }` | "X accepted your ride. ₹held frozen." |
| `network:ride:rejected` | `{ rideId, driverId, driverName, reason }` | Owner: driver declined, reassign |
| `network:ride:expired` | `{ rideId }` | Publisher: lead expired unclaimed |
| `network:ride:cancelled` | `{ rideId, reason, status }` | Close the ride screen |
| `network:ride:driver-changed` | `{ rideId, status, liveStatus }` | Rider-side: driver changed |

**Money**

| Event | Payload | Do this |
|---|---|---|
| `escrow:settled` | `{ rideId, collected_by, publisher_hold, acceptor_hold, dispute_until, can_dispute }` | Show the settlement; if `can_dispute` show a Dispute button until `dispute_until` |
| `escrow:disputed` | `{ rideId, reason }` | Acceptor: "the owner raised a dispute" |
| `escrow:resolved` | `{ rideId, collected_by }` | "Support corrected the settlement" |
| `wallet:updated` | `{ rideId }` | Re-fetch the wallet |

**Plan**

| Event | Payload | Do this |
|---|---|---|
| `driver:category:updated` | `{ category, previous_category, reason }` | Refresh `/drivers/category`, show upgrade/downgrade |
| `driver:category:grace` | `{ grace_ends_at }` | Persistent banner: "add a commercial vehicle by X" |
| `driver:subscription:expiring` | `{ days_left, end_date, tier }` | Renewal nudge |
| `driver:route-mode:updated` | `{ route_mode, active_route_id }` | **Multi-device sync** — update the toggle without a refetch |

**Live map (owner)**

| Event | Payload | Do this |
|---|---|---|
| `org:live-location` | `{ rideId, driverId, driverName, vehicleNumber, coordinates, heading, speed, pickup, drop, liveStatus, at }` | Move the marker. Arrives about once every 4 s per driver |
| `org:ride-started` | `{ rideId, driverId, liveStatus, status }` | Marker becomes live |
| `org:ride-ended` | `{ rideId, ... }` | Remove the marker |
| `org:ride:assigned` | `{ rideId, driverId, driverName, liveStatus }` | Add to the board (no location yet) |

**Chat** — see §12.

### Events you send (app → server)

| Event | Payload |
|---|---|
| `lead:join` | `{ conversationId }` → replies `lead:joined` |
| `lead:message:send` | `{ conversationId, message, clientMessageId }` |
| `lead:read` | `{ conversationId }` |
| `ride:status:update` | `{ rideId, status, paymentMethod?, collectedBy? }` — existing event, **new optional `collectedBy`** |
| `ride:driver-location:update` | `{ rideId, coordinates, heading?, speed? }` — existing |

> ⚠️ Emitting the moment the socket connects is safe now, but **wait for `connect`** before
> emitting anything. Events sent before the handshake completes are dropped by the client.

---

## 5. Screen 1 — Plan / category

> **Updated by a later change** — `driver-network-vehicle-rule-and-taxi-only-flutter-guide.md` §A.2–A.3
> adds `max_vehicles`, `requires_commercial_at_purchase` and a per-tier `vehicle_rule` breakdown, and
> changes when Middle/Prime purchase actually requires a private vehicle. Read that doc's Part A
> before building against the two endpoints below.

### `GET /drivers/category`

This is the screen's single source of truth, and you should also call it on app start and
cache it — nearly every other screen gates on it.

```json
{
  "success": true,
  "data": {
    "category": "prime",
    "tier": { "id": "6aa…", "name": "Super Premium", "badge_color_hex": "#8B5CF6" },
    "expires_at": "2026-10-18T00:00:00.000Z",
    "permissions": {
      "can_create_rides": true,
      "can_publish_rides": true,
      "can_manage_fleet": true,
      "max_routes": 10,
      "routes_used": 2,
      "max_fleet_drivers": 50,
      "customer_lead_contact_fee": 0,
      "driver_lead_contact_fee": 0,
      "customer_ride_accept_fee": 0
    },
    "vehicle_rule": { "required": true, "ok": true, "commercial": 1, "private": 1 },
    "city": { "id": "6aa…", "name": "Indore", "prime_limit": 5, "prime_slots_left": 4 },
    "grace": { "active": false, "ends_at": null, "reason": null }
  }
}
```

**What to render**

- `tier.name` + `badge_color_hex` as the plan badge
- `expires_at` — show a renewal nudge inside 3 days
- `permissions` — drive every menu item's visibility from these, nothing else
- `vehicle_rule.ok == false` → prominent warning with the missing type
- `grace.active == true` → **persistent red banner**: they lose the plan at `grace.ends_at` unless they add the missing vehicle
- `city.prime_slots_left` — show on the Prime plan card

### `GET /drivers/subscription/tiers`

The existing endpoint, now annotated **when called with a token**:

```json
{
  "success": true,
  "data": { "results": [
    { "id": "…", "name": "Super Premium", "driver_category": "prime",
      "price_monthly": 5000, "commission_percent": 0,
      "can_create_rides": true, "can_manage_fleet": true, "max_routes": 10,
      "eligible": false,
      "ineligible_reasons": ["NEED_COMMERCIAL_VEHICLE"],
      "prime_slots_left": 0 }
  ] }
}
```

Render a plan card as **disabled with a reason** when `eligible == false`; map each entry of
`ineligible_reasons` to the copy from §3. Called without a token it still works but has no
`eligible` / `ineligible_reasons` fields — that's the pre-login catalogue.

**Sort and group by `driver_category`, never by name.**

Purchase is the **existing** flow — `/drivers/subscription/checkout` then
`/drivers/subscription/verify-payment`. Nothing changed for you except that checkout can now
fail with `PRIME_SLOTS_FULL` or `NEED_COMMERCIAL_VEHICLE` **before** the Razorpay sheet opens.
Handle that: don't open the payment sheet if checkout 4xx's.

---

## 6. Screen 2 — My routes

A route is an ordered list of 2–10 stops plus a **corridor** (default 10 km). While a route is
active the driver only receives trips whose pickup *and* drop both fall inside that corridor,
in the right direction.

### `GET /drivers/routes`

```json
{ "success": true, "data": {
  "route_mode": "route",
  "active_route_id": "r1",
  "limit": 10,
  "used": 2,
  "routes": [{
    "id": "r1",
    "name": "Indore - Ujjain - Bhopal",
    "stops": [
      { "name": "Indore", "coordinates": [75.8577, 22.7196] },
      { "name": "Ujjain",  "coordinates": [75.7885, 23.1765] },
      { "name": "Bhopal",  "coordinates": [77.4126, 23.2599] }
    ],
    "corridor_km": 10,
    "bidirectional": false,
    "distance_meters": 245000,
    "path_source": "google",
    "is_active": true,
    "created_at": "2026-09-18T…"
  }]
}}
```

### `POST /drivers/routes`

```json
{
  "name": "Bhopal - Bina - Jhansi",
  "stops": [
    { "name": "Bhopal", "coordinates": [77.4126, 23.2599] },
    { "name": "Bina",   "coordinates": [78.2,    24.18] },
    { "name": "Jhansi", "coordinates": [78.57,   25.44] }
  ],
  "corridor_km": 10,
  "bidirectional": true
}
```

**Coordinates are `[longitude, latitude]` — GeoJSON order, not `LatLng` order.** This is the
single most common mistake. If you use `google_maps_flutter`, convert:

```dart
List<double> toGeoJson(LatLng p) => [p.longitude, p.latitude];
LatLng fromGeoJson(List<dynamic> c) => LatLng(c[1] as double, c[0] as double);
```

- `PATCH /drivers/routes/:routeId` — partial; send only what changed
- `DELETE /drivers/routes/:routeId` — soft delete. **If it was the active route the driver
  silently falls back to `all_locations`** — re-read the response's `route_mode`

### `PATCH /drivers/route-mode`

```json
{ "mode": "route", "routeId": "r1" }
```
```json
{ "mode": "all_locations" }
```

Returns `{ route_mode, active_route }`. Also emits `driver:route-mode:updated` to the
driver's other devices — listen for it so a second phone stays in sync.

**UI:** a segmented control "All locations / My route" plus a route picker. Make it very clear
that route mode **reduces** the work they are offered.

### `bidirectional`

Off by default. A one-way Indore→Bhopal route will **not** match a Bhopal→Indore trip. Explain
this in the form; it looks like a bug to drivers otherwise.

---

## 7. Screen 3 — Create a ride

Gated on `permissions.can_create_rides`.

### `POST /drivers/network/rides`

```json
{
  "customer": { "name": "Amit Sharma", "phone": "9876543210" },
  "pickup": { "coordinates": [75.8577, 22.7196], "address": "Vijay Nagar, Indore" },
  "drop":   { "coordinates": [77.4126, 23.2599], "address": "MP Nagar, Bhopal" },
  "fare": 5000,
  "paymentMethod": "cash",
  "serviceType": "intercity",
  "scheduledAt": "2026-09-20T05:30:00.000Z",
  "vehicleTypeId": "66a…",
  "notes": "2 bags"
}
```

Required: `customer.name`, a valid 10-digit `customer.phone`, both coordinate pairs, `fare > 0`.
Everything else is optional.

Response `201`:

```json
{ "success": true, "data": {
  "id": "ride123",
  "status": "searching",
  "otp_masked": "****",
  "customer": { "name": "Amit Sharma", "phone": "9876543210", "is_app_user": false },
  "fare": 5000,
  "assignment": { "mode": "dispatch", "assigned_at": null, "driver": null },
  "publish": { "status": "none", "total_fare": 0, "owner_commission": 0, "driver_payout": 0 }
}}
```

Two things to note:

- **`otp_masked` is always `****`.** The real OTP is never returned on a list or create
  response — it reaches the customer by push or SMS. Don't build UI that shows it to the
  creating driver.
- **`is_app_user`** tells you whether the customer will get an in-app notification (true) or an
  SMS (false). Worth surfacing: "Amit will get an SMS" vs "Amit will be notified in the app".

**Dispatch is NOT started.** The ride sits unassigned until the driver assigns or publishes it.
After creating, take them straight to the assign/publish choice.

---

## 8. Screen 4 — My network rides

### `GET /drivers/network/rides?scope=created&status=all&page=1&limit=20`

`scope`: `created` (default) or `assigned_to_me`
`status`: `all` · `unassigned` · `assigned` · `published` · `ongoing` · `completed` · `cancelled`

```json
{ "success": true, "data": {
  "results": [{
    "id": "ride123",
    "status": "accepted",
    "liveStatus": "arriving",
    "origin": "driver_created",
    "customer": { "name": "Amit Sharma", "phone": "9876543210", "is_app_user": false, "user_id": null },
    "pickup": { "address": "Vijay Nagar, Indore", "coordinates": [75.85, 22.71] },
    "drop":   { "address": "MP Nagar, Bhopal",   "coordinates": [77.41, 23.25] },
    "fare": 5000,
    "paymentMethod": "cash",
    "scheduledAt": null,
    "serviceType": "ride",
    "notes": "2 bags",
    "otp_masked": "****",
    "assignment": {
      "mode": "direct_assign",
      "assigned_at": "2026-09-18T…",
      "driver": { "id": "drv5", "name": "Suresh Kumar", "phone": "9000000002",
                  "vehicleNumber": "MP09AB1234", "isOnline": true, "isOnRide": true }
    },
    "publish": { "status": "none", "total_fare": 0, "owner_commission": 0,
                 "driver_payout": 0, "expires_at": null, "taken_by_driver_id": null },
    "escrow": { "state": "none", "publisher_hold": 0, "acceptor_hold": 0, "collected_by": null },
    "createdAt": "2026-09-18T…"
  }],
  "pagination": { "page": 1, "limit": 20, "total": 7, "totalPages": 1 }
}}
```

**Drive the row's action buttons off `assignment.mode` + `publish.status` + `escrow.state`:**

| State | Buttons |
|---|---|
| `mode: dispatch`, `publish: none` | Assign · Publish · Cancel |
| `mode: direct_assign` | Unassign · Reassign · Cancel |
| `publish: open` | Unpublish · Cancel |
| `publish: taken`, `escrow: held` | Cancel only (releases the holds) |
| `liveStatus: started` | Cancel only — **Unassign must be hidden** |
| `escrow: settled` + inside the dispute window | Dispute |

---

## 9. Screen 5 — Assign to a fleet driver

Gated on `permissions.can_manage_fleet` for assigning to **someone else**. A Middle driver can
still assign a ride to **themselves** (pass their own driver id) — the backend allows self-assign
regardless of `can_manage_fleet`.

### `GET /drivers/network/fleet/availability`

```json
{ "success": true, "data": { "results": [
  { "driverId": "drv1", "name": "Suresh Kumar", "phone": "9000000002",
    "isOnline": true, "isOnRide": false,
    "vehicle": { "number": "MP09AB1234", "type": "car" },
    "location": [75.86, 22.72],
    "activeRides": 0 }
]}}
```

Use this for the picker. Grey out `isOnRide: true` for immediate rides (they'll be rejected
with `DRIVER_BUSY` anyway) but **allow** them for scheduled rides — the backend only checks
for a real time clash.

### `POST /drivers/network/rides/:rideId/assign`

```json
{ "driverId": "drv5" }
```

Also available:

- `POST /drivers/network/rides/:rideId/unassign` — `{ reason }`. Fails with `RIDE_ALREADY_STARTED` once the OTP is in
- `POST /drivers/network/rides/:rideId/reassign` — `{ driverId, reason }`
- `POST /drivers/network/rides/:rideId/cancel` — `{ reason }`
- `POST /drivers/network/rides/:rideId/reject-assignment` — `{ reason }`, called by the **assigned driver**, no category gate

On success the customer and the assigned driver are notified automatically. You don't send
anything yourself.

### The assigned driver's side

They receive `network:ride:assigned` with everything needed for a full-screen prompt:

```json
{
  "rideId": "ride123",
  "status": "accepted",
  "liveStatus": "accepted",
  "otp": "4821",
  "assignedBy": { "name": "Ramesh Verma", "org_name": "Ram Travels" },
  "pickup": { "address": "Vijay Nagar, Indore", "coordinates": [75.85, 22.71] },
  "drop":   { "address": "MP Nagar, Bhopal",   "coordinates": [77.41, 23.25] },
  "customer": { "name": "Amit Sharma", "phone": "9876543210" },
  "scheduledAt": null,
  "amount": 5000
}
```

Note the **assigned driver does get the real `otp`** — they need it to verify at pickup.
Show "Assigned by Ramesh Verma · Ram Travels" prominently; that's the requirement.

From here the ride uses the **existing** lifecycle (`arriving` → `arrived` → OTP → `started`
→ `completed`). Nothing new except §14.

---

## 10. Screen 6 — Publish to the network

Gated on `permissions.can_publish_rides`.

### `POST /drivers/network/rides/:rideId/publish`

```json
{
  "total_fare": 5000,
  "owner_commission": 2000,
  "driver_payout": 3000,
  "expires_in_minutes": 60
}
```

**Validate client-side before sending:** `owner_commission + driver_payout` must equal
`total_fare` exactly, and `driver_payout > 0`. Build the form as a slider that keeps the sum
correct so `INVALID_SPLIT` is unreachable.

Also fails with:
- `INSUFFICIENT_WALLET_FOR_PUBLISH` — they need `driver_payout` **available** (not just balance)
- `PUBLISH_TOO_LATE` — scheduled too close to now; `details.required_minutes` says the minimum

Show a live preview: *"You keep ₹2000 · driver gets ₹3000 · ₹3000 will be frozen from your
wallet when someone accepts."* That last part matters — drivers are surprised otherwise.

`DELETE /drivers/network/rides/:rideId/publish` unpublishes while `publish.status == 'open'`.

---

## 11. Screen 7 — The feed (home)

### `GET /drivers/feed?tab=driver&page=1&limit=20&lat=&lng=`

`tab`: `driver` (rides published by other drivers) or `customer` (app bookings looking for a
driver). **Both tabs are visible to every category** — that's the point of the network.

Pass `lat`/`lng` to sort by distance from the driver's current position.

```json
{ "success": true, "data": {
  "tab": "driver",
  "route_mode": "all_locations",
  "results": [{
    "id": "ride123",
    "lead_type": "driver",
    "pickup": { "address": "Vijay Nagar, Indore", "area": "Vijay Nagar", "coordinates": [75.85, 22.71] },
    "drop":   { "address": "MP Nagar, Bhopal",   "area": "MP Nagar",   "coordinates": [77.41, 23.25] },
    "scheduledAt": null,
    "serviceType": "ride",
    "distance_km": 195,
    "vehicle_type": { "id": "…", "name": "GoKab Sedan" },
    "total_fare": 5000,
    "amount_for_you": 3000,
    "publisher": { "id": "drvP", "name": "Ramesh Verma", "org_name": "Ram Travels",
                   "category": "prime", "rating": 4.7 },
    "customer": { "name_masked": "A***t" },
    "distance_from_me_km": 3.2,
    "route_match": { "route_id": "r1", "route_name": "Indore - Ujjain - Bhopal" },
    "contact": { "fee": 0, "already_contacted": false, "can_chat": true, "can_call": true },
    "accept": { "allowed": true, "fee": 0, "hold_required": 2000, "wallet_available": 4500 },
    "vehicle_mismatch": false,
    "expires_at": "2026-09-18T12:30:00Z",
    "createdAt": "2026-09-18T…"
  }],
  "pagination": { "page": 1, "limit": 20, "total": 12 }
}}
```

**Card design notes**

- **`amount_for_you` is the headline number**, not `total_fare`. On the customer tab it's the
  estimated post-commission earnings.
- **`accept.hold_required`** — show "₹2000 will be frozen" on the accept button. Drivers who
  don't expect this file support tickets.
- **`accept.allowed == false`** → the button is disabled; compare `wallet_available` against
  `hold_required + fee` to write the reason.
- **`contact.fee > 0`** → put the amount on the contact button: "Chat · ₹20".
  **`already_contacted == true` → fee is 0**, they've already paid for this lead.
- **`customer.name_masked`** is all you get before contacting. **There is no phone number in
  this response at all** — that's deliberate.
- **`vehicle_mismatch: true`** → show a subtle "different vehicle type" chip. Don't hide the
  card; a driver with more than one vehicle can still take it.
- **`route_match`** — when present, show "on your route: Indore - Ujjain - Bhopal".
- **`expires_at`** — a countdown makes these convert much better.

Keep the list live with the four `feed:*` socket events from §4.

### `POST /drivers/feed/rides/:rideId/accept`

No body. Two different things happen depending on the lead type, but the call is the same.

**Driver lead** → `{ accepted: true, rideId, escrow: "held" }`. Money is now frozen on both
sides. Failures: `RIDE_ALREADY_TAKEN`, `INSUFFICIENT_WALLET`, `PUBLISHER_INSUFFICIENT_WALLET`.

**Customer lead** → `{ accepted: true, rideId, fee_charged: 20 }`. Normal dispatch stops and
the ride becomes a regular trip with normal commission.

> **Race handling:** `RIDE_ALREADY_TAKEN` is normal, not an error state. Remove the card,
> show a brief toast, move on. Don't show a red error dialog.

---

## 12. Screen 8 — Lead chat

### `POST /drivers/feed/rides/:rideId/contact`

```json
{ "channel": "chat" }
```

```json
{ "success": true, "data": {
  "fee_charged": 20,
  "wallet_balance": 480,
  "wallet_available": 480,
  "conversation_id": "conv1",
  "call": null
}}
```

With `{ "channel": "call" }` the `call` block is populated instead:

```json
"call": { "mode": "reveal", "phone": "9000000001" }
```

**The fee is charged once per ride, not per channel.** After one contact, both chat and call
are unlocked and `fee_charged` comes back as `0`. Show the fee clearly *before* they tap —
it is not refunded if someone else takes the ride.

If `call.mode == "masked"` the response carries
`unavailable_reason: "MASKED_CALLING_NOT_CONFIGURED"` and no number — masked calling isn't
wired to a provider yet. Handle it as "calling unavailable, use chat".

### Chat over REST

- `GET /drivers/lead-conversations?page=1&limit=20`
- `GET /drivers/lead-conversations/:conversationId/messages?before=<ISO>&limit=30`
- `POST /drivers/lead-conversations/:conversationId/messages` — `{ message, clientMessageId }`

Messages come back **oldest-first**, paginate backwards with `before`.

```json
{ "success": true, "data": {
  "closed": false,
  "results": [
    { "id": "m1", "senderRole": "driver", "senderId": "drv9",
      "message": "I can do this trip", "createdAt": "2026-09-18T…" }
  ]
}}
```

### Chat over socket (preferred)

```dart
socket.emit('lead:join', {'conversationId': id});
socket.on('lead:joined', (_) { /* ready */ });

socket.emit('lead:message:send', {
  'conversationId': id,
  'message': text,
  'clientMessageId': localId,     // echoed back — use it to reconcile optimistic sends
});

socket.on('lead:message:new', (data) { /* append, dedupe on clientMessageId */ });
socket.on('lead:closed', (data) { /* reason: RIDE_TAKEN — disable composer */ });
```

The socket path and the REST path run the same code, so they can't drift. Use sockets when
connected and REST as the fallback.

**Rate limit: 20 messages per minute per sender** → `RATE_LIMITED` (429).

**When the ride is taken the conversation closes.** You still receive `lead:closed`; the
composer must become read-only. Posting after that returns `CONVERSATION_CLOSED`.

---

## 13. Screen 9 — Wallet with frozen balance

`GET /drivers/wallet` now returns three numbers instead of one. The wallet sits under
`data.wallet`, alongside `data.transactions`, `data.withdrawalRequests` and `data.settings`
as before:

```json
{ "success": true, "data": {
  "wallet": {
    "balance": 10000,
    "frozenBalance": 3000,
    "available": 7000,
    "cashLimit": 500,
    "minimumBalanceForOrders": 100,
    "availableForOrders": 6900,
    "isWalletEnabled": true,
    "isTransferEnabled": true,
    "minimumTopUpAmount": 500,
    "minimumTransferAmount": 100,
    "isBlocked": false
  },
  "transactions": [ ... ],
  "withdrawalRequests": [ ... ],
  "settings": { ... }
}}
```

- **`balance`** — total, unchanged meaning
- **`frozenBalance`** — locked against rides they've accepted or published
- **`available`** = `balance − frozenBalance` — **this is what they can actually spend**

Every affordability check on the backend uses `available`, including **withdrawals**. A
withdrawal above `available` is refused with a message naming the frozen amount.

**UI:** show `available` as the big number and `frozenBalance` as a secondary line — *"₹3000
held for ongoing rides"* — ideally tappable to list which rides. Showing `balance` as the
headline will produce "why can't I withdraw my money" tickets.

Refresh on `wallet:updated`.

New transaction types you'll see in the ledger:

| Type | Moves balance? | Meaning |
|---|---|---|
| `escrow_hold` | no | Money locked; `frozenBefore`/`frozenAfter` show the change |
| `escrow_release` | no | Lock removed |
| `escrow_transfer_out` | yes (−) | Paid the other driver |
| `escrow_transfer_in` | yes (+) | Received from the other driver or the platform |
| `lead_contact_fee` | yes (−) | Contact fee |
| `feed_accept_fee` | yes (−) | Fee for taking a customer lead |

`escrow_hold` and `escrow_release` rows have `amount: 0`. **Don't render them in a list that
sums amounts** — show them in a separate "holds" view or they'll look like broken ₹0 rows.

---

## 14. Screen 10 — Completing a ride: who took the money

This is the one place the existing ride flow changes, and it is easy to miss.

When a ride's `escrow.state == 'held'` (i.e. it came from the network), **completing it requires
saying who collected the fare.** Without it the backend returns `COLLECTED_BY_REQUIRED` (422)
and **the ride is not completed** — nothing is half-applied.

### REST

```
PATCH /rides/:rideId/status
{ "status": "completed", "collectedBy": "driver" }
```

### Socket

```dart
socket.emit('ride:status:update', {
  'rideId': rideId,
  'status': 'completed',
  'collectedBy': 'driver',
});
```

### The three choices

| Value | Show as | When |
|---|---|---|
| `driver` | "Customer paid me" | The driver took the cash |
| `publisher` | "Customer paid the owner" | The ride's owner took the cash |
| `platform` | "Paid in the app" | Online payment |

`platform` is assumed automatically when `paymentMethod == 'online'`, so you only **have** to
ask on cash rides — but asking always is clearer.

**Build this as a required bottom sheet before the complete button fires.** Only show it when
`escrow.state == 'held'`; a normal ride completes as it always did.

### Dispute

After settlement the **publisher** gets `escrow:settled` with `can_dispute: true` and a
`dispute_until` timestamp.

```
POST /drivers/network/rides/:rideId/escrow/dispute
{ "reason": "Customer paid me directly" }
```

Returns a `ticketCode` — a support ticket is opened automatically. Show it to the driver.
After `dispute_until` passes the call fails with `DISPUTE_WINDOW_CLOSED`; hide the button.

---

## 15. Screen 11 — Owner live map

### `GET /drivers/network/live-map`

```json
{ "success": true, "data": { "drivers": [
  { "rideId": "ride123", "driverId": "drv1", "name": "Suresh Kumar",
    "phone": "9000000002", "vehicleNumber": "MP09AB1234",
    "relation": "fleet",
    "liveStatus": "started",
    "location": [75.9, 22.8],
    "heading": 90,
    "updatedAt": "2026-09-18T…",
    "pickup": "Vijay Nagar", "drop": "MP Nagar, Bhopal",
    "eta_minutes": 140 },
  { "rideId": "ride124", "driverId": "drvX", "name": "Vikas Singh",
    "relation": "published_acceptor",
    "liveStatus": "arriving",
    "location": null, "heading": null, "updatedAt": null, "eta_minutes": null }
]}}
```

**`location` is `null` until the driver enters the pickup OTP.** Before that the owner sees
status only — this is a deliberate privacy boundary, not a bug. Render those as a list row or
a pin on the pickup address, never as a "last known position".

`relation` tells you who the driver is:
- `fleet` — one of the owner's own drivers
- `published_acceptor` — an outside driver who took a ride the owner published

Use the initial snapshot to populate the map, then keep it live with `org:live-location`
(≈ every 4 s per driver), `org:ride-started` and `org:ride-ended`.

---

## 16. Rider app additions

Only two things change for riders.

**1. A driver may contact them about their booking before accepting it.**

- `GET /users/lead-conversations`
- `GET /users/lead-conversations/:conversationId/messages`
- `POST /users/lead-conversations/:conversationId/messages`

Same shapes as the driver side. Sockets are identical (`lead:join`,
`lead:message:send`, `lead:message:new`) — the server knows you're a rider from the token.
They also receive `lead:interest` when a driver first reaches out.

**2. A ride booked for them by a driver.**

`network:ride:assigned` arrives with the organisation, the owner's name, the driver's details
and the OTP:

```json
{
  "rideId": "ride123",
  "otp": "4821",
  "organization": { "name": "Ram Travels", "owner_name": "Ramesh Verma" },
  "driver": { "id": "drv5", "name": "Suresh Kumar", "phone": "9000000002",
              "rating": 4.8, "vehicle": { "number": "MP09AB1234",
              "label": "Maruti Dzire", "color": "White" } },
  "pickupAddress": "Vijay Nagar, Indore",
  "dropAddress": "MP Nagar, Bhopal",
  "scheduledAt": null,
  "fare": 5000
}
```

Show the **organisation name** as the headline ("Your ride is confirmed – Ram Travels"), then
owner, driver and OTP. That's the requirement.

---

## 17. Vehicle registration changes

> **Updated by a later change** — `driver-network-vehicle-rule-and-taxi-only-flutter-guide.md`:
> §A.5 opens `POST /drivers/fleet/vehicles` to every approved driver (not only Middle/Prime) with
> a `max_vehicles` cap, and §B.2 removes the Service Category step from registration entirely.
> The `vehicle_usage_type` / commercial-permit behaviour described just below is unchanged.

Two extra fields, both on existing screens.

**Driver onboarding** — `PATCH /drivers/onboarding/vehicle` accepts:

```json
{ "vehicle_usage_type": "commercial" }
```

Values: `commercial` or `private`. Optional for backwards compatibility, but a driver who
doesn't set it can't qualify for Prime/Middle later. Ask for it.

**Fleet vehicles** — `POST /drivers/fleet/vehicles` now **requires**:

```json
{
  "usage_type": "commercial",
  "documents": { "rc": "…", "commercial_permit": "https://…" }
}
```

A commercial vehicle without a `commercial_permit` document is refused with
`COMMERCIAL_PERMIT_REQUIRED`. Private vehicles don't need it. The list response also returns
`usage_type` and `usage_type_verified` (admin has seen the permit) — show a "verification
pending" chip when it's false.

**Why it matters:** Prime and Middle require **at least one commercial and one private
vehicle**. Removing the last one of either kind starts a grace period (`driver:category:grace`
socket event, and `grace.active` on `/drivers/category`), after which the plan is lost.

---

## 18. Complete endpoint reference

All paths are relative to `{API_HOST}/api/v1`. All need `Authorization: Bearer <driver jwt>`
unless stated.

### Category & plans

| Method | Path | Gate |
|---|---|---|
| GET | `/drivers/category` | — |
| GET | `/drivers/subscription/tiers` | optional token (richer with one) |
| GET | `/drivers/subscription/current` | — |
| POST | `/drivers/subscription/checkout` | — |
| POST | `/drivers/subscription/verify-payment` | — |

### Routes

| Method | Path |
|---|---|
| GET | `/drivers/routes` |
| POST | `/drivers/routes` |
| PATCH | `/drivers/routes/:routeId` |
| DELETE | `/drivers/routes/:routeId` |
| PATCH | `/drivers/route-mode` |

### Organisation & fleet

| Method | Path | Gate |
|---|---|---|
| PATCH | `/drivers/organization` | `can_manage_fleet` |
| GET | `/drivers/network/fleet/availability` | `can_manage_fleet` |
| GET/POST/PATCH/DELETE | `/drivers/fleet/drivers` | existing |
| GET/POST/PATCH/DELETE | `/drivers/fleet/vehicles` | existing |

### Network rides

| Method | Path | Gate |
|---|---|---|
| GET | `/drivers/network/rides` | — |
| POST | `/drivers/network/rides` | `can_create_rides` |
| POST | `/drivers/network/rides/:rideId/assign` | `can_create_rides` |
| POST | `/drivers/network/rides/:rideId/unassign` | `can_create_rides` |
| POST | `/drivers/network/rides/:rideId/reassign` | `can_create_rides` |
| POST | `/drivers/network/rides/:rideId/cancel` | `can_create_rides` |
| POST | `/drivers/network/rides/:rideId/reject-assignment` | — (assigned driver) |
| POST | `/drivers/network/rides/:rideId/publish` | `can_publish_rides` |
| DELETE | `/drivers/network/rides/:rideId/publish` | `can_publish_rides` |
| POST | `/drivers/network/rides/:rideId/escrow/dispute` | — (publisher) |

### Feed & leads

| Method | Path |
|---|---|
| GET | `/drivers/feed?tab=driver\|customer` |
| POST | `/drivers/feed/rides/:rideId/accept` |
| POST | `/drivers/feed/rides/:rideId/contact` |
| GET | `/drivers/lead-conversations` |
| GET | `/drivers/lead-conversations/:conversationId/messages` |
| POST | `/drivers/lead-conversations/:conversationId/messages` |

### Live map

| Method | Path |
|---|---|
| GET | `/drivers/network/live-map` |

### Rider side

| Method | Path |
|---|---|
| GET | `/users/lead-conversations` |
| GET | `/users/lead-conversations/:conversationId/messages` |
| POST | `/users/lead-conversations/:conversationId/messages` |

### Existing, changed

| Method | Path | Change |
|---|---|---|
| PATCH | `/rides/:rideId/status` | optional `collectedBy` |
| GET | `/drivers/wallet` | adds `frozenBalance`, `available` |
| PATCH | `/drivers/onboarding/vehicle` | accepts `vehicle_usage_type` |
| POST | `/drivers/fleet/vehicles` | requires `usage_type` (+ permit if commercial) |

---

## 19. Suggested model classes

```dart
class DriverCategory {
  final String category;              // 'prime' | 'middle' | 'lower'
  final TierBadge? tier;
  final DateTime? expiresAt;
  final CategoryPermissions permissions;
  final VehicleRule vehicleRule;
  final CityInfo? city;
  final GraceInfo grace;

  bool get canCreateRides => permissions.canCreateRides;
  bool get canPublish     => permissions.canPublishRides;
  bool get canManageFleet => permissions.canManageFleet;
  bool get needsVehicleAction => vehicleRule.required && !vehicleRule.ok;
}

class CategoryPermissions {
  final bool canCreateRides, canPublishRides, canManageFleet;
  final int maxRoutes, routesUsed, maxFleetDrivers;
  final num customerLeadContactFee, driverLeadContactFee, customerRideAcceptFee;

  bool get canAddRoute => routesUsed < maxRoutes;
}

class FeedItem {
  final String id;
  final String leadType;              // 'driver' | 'customer'
  final Place pickup, drop;
  final num totalFare;
  final num? amountForYou;
  final Publisher? publisher;
  final String customerNameMasked;
  final double? distanceFromMeKm;
  final RouteMatch? routeMatch;
  final ContactInfo contact;
  final AcceptInfo accept;
  final bool vehicleMismatch;
  final DateTime? expiresAt;
}

class AcceptInfo {
  final bool allowed;
  final num fee, holdRequired, walletAvailable;

  /// Why the accept button is disabled — null when it is enabled.
  String? get blockedReason => allowed
      ? null
      : 'You need ₹${holdRequired + fee} available (you have ₹$walletAvailable)';
}

class DriverWallet {
  final num balance, frozenBalance, available;
  bool get hasFrozen => frozenBalance > 0;
}

enum CollectedBy { driver, publisher, platform }
```

---

## 20. Things that will bite you

These are real problems found while building and testing the backend. Every one of them will
cost you an afternoon if you hit it cold.

**1. Coordinates are `[longitude, latitude]`.**
GeoJSON order, the reverse of `LatLng`. Wrong order doesn't error — it silently puts the point
in the wrong hemisphere and nothing matches.

**2. The path is `/drivers/` not `/driver/`.**
The spec document says `/driver/`. The implementation uses the plural, matching the existing
driver routes. A 404 here means you copied from the spec.

**3. Don't use `localhost` for the socket URL.**
IPv6-capable devices resolve it to `::1`; the server binds IPv4. HTTP works, the socket
handshake is refused, and the error message (`xhr poll error`) tells you nothing.

**4. Wait for `connect` before emitting.**
Socket.IO does not queue events sent before the handshake finishes.

**5. `available`, not `balance`.**
Every "can they afford it" decision — accept, publish, contact, withdraw — uses
`balance − frozenBalance`. Showing `balance` as the spendable number is the single most
likely source of support tickets.

**6. `RIDE_ALREADY_TAKEN` is normal.**
On a busy feed several drivers tap the same lead. Remove the card and move on; don't show a
red error.

**7. Completing a network ride needs `collectedBy`.**
Miss it and the ride silently won't complete — it returns 422 and stays in `started`. Only
required when `escrow.state == 'held'`.

**8. `escrow_hold` / `escrow_release` rows have `amount: 0`.**
They move `frozenBefore` → `frozenAfter`, not balance. Don't sum them into a transaction list.

**9. Never branch on a plan's name.**
The live database sells prime as "Super Premium" and middle as "Premium". Branch on
`driver_category` and the permission flags, and filter tier lists by `is_active`.

**10. A one-way route won't match the return trip.**
`bidirectional: false` is the default. Drivers report this as a bug; explain it in the form.

**11. Deleting the active route silently switches to `all_locations`.**
Read `route_mode` back from the delete response instead of assuming.

**12. `otp_masked` is always `****` on list and create responses.**
Only the assigned driver gets the real OTP, via the `network:ride:assigned` socket event and
push. Don't build a screen expecting it from the REST list.

**13. The contact fee is per ride, not per channel.**
Chat then call costs one fee. `already_contacted: true` means the next contact is free — show
₹0, not the tier fee.

**14. Location on the owner map is `null` before the pickup OTP.**
Intentional. Handle the null; don't fall back to a stale position.

---

## Open items on the backend

Two things are not wired and will return a clear signal rather than failing silently — build
around them:

- **Masked calling** — `call.mode == 'masked'` returns no number and
  `unavailable_reason: 'MASKED_CALLING_NOT_CONFIGURED'`. Treat as "calling unavailable".
- **Offline-customer SMS** carries the **OTP only**, not the organisation/driver/pickup
  details. A second DLT template has to be registered with the SMS provider first. If your UI
  promises the customer "we've sent them the driver details", soften that copy for now.
