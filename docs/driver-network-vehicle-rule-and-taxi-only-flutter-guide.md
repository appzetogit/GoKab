# GoKab Driver App — Vehicle Rule / Plan Purchase & Taxi-Only Platform Update

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented and deployed on `master` (commits `6e76f98`, `e3c716a`, `f044cb7`), not against the original spec — a few points in the spec were decided one way during implementation; this doc says which way.
> **Supersedes:** parts of `docs/driver-network-flutter-integration.md` — specifically §5 (`GET /drivers/category`, `GET /drivers/subscription/tiers`) and §17 (Vehicle registration changes). Where this doc and that one disagree, this one is current. Everything else in that doc (sockets, routes, network rides, feed, leads, wallet, live map) is untouched by this change and still applies as written.

This covers two backend changes, delivered together:

- **Part A — Vehicle rule & plan purchase.** A Lower driver can now actually reach Middle/Prime. Buying Middle/Prime needs a commercial vehicle only; the private vehicle can follow within a grace window. Any approved driver can add a second vehicle now, not only Middle/Prime.
- **Part B — Taxi-only platform.** Registration no longer asks for a service category — every driver in this app is a taxi driver, and "taxi" now genuinely means both local and intercity rides. Nothing here needs new UI beyond removing what's obsolete.

---

## Part A — Vehicle rule & plan purchase

> **Updated by a later change** — `driver-network-final-flow-flutter-guide.md` §2 changes what happens
> after A.4's purchase **if and once** the backend runs its plan-consolidation script: Prime/Elite lose
> the ongoing private-vehicle requirement entirely (no grace period, ever, on those plans). That doc
> also covers organisation-on-purchase, real Add Vehicle document handling, and vehicle
> approval/rejection notifications — all new. Read it before building against this section.

### A.1 The product flow, as built

1. A driver registers with **one** vehicle — `commercial` or `private` — same as before.
2. **Lower** (the free default) has no vehicle-mix rule. Any one vehicle works.
3. **Buying Middle or Prime** requires the driver to have a **commercial** vehicle. That's it, at checkout. A private-only driver is refused.
4. Once bought, the category is granted immediately. If the driver still doesn't have a **private** vehicle, a grace window starts automatically (no action needed from the app) — **15 days**, longer than the 7-day grace that applies later if a vehicle is removed. If the private vehicle isn't added by the deadline, a cron downgrades the driver back to Lower and a notification is sent — this part already existed and is unchanged.
5. **Any approved driver** — Lower included — can now add a second vehicle to their own organisation via the existing fleet-vehicle screen. This is what makes step 4 possible: a Lower driver adds a commercial vehicle, buys Middle, then adds the private vehicle within the grace window. Lower is capped at **2 vehicles** total under their organisation so this doesn't become a way to run a free fleet; Middle/Prime are uncapped here (Prime's fleet size is governed separately by `max_fleet_drivers`).

Nothing about fleet **drivers** (hiring other people) changed — that's still Prime-only, gated by `can_manage_fleet` and `max_fleet_drivers`, same as `driver-network-flutter-integration.md` §17 already documents.

### A.2 `GET /drivers/subscription/tiers` — response changed

Same endpoint, same auth behaviour (annotated when a token is present, plain catalogue without one). Two things are new per tier:

```json
{
  "success": true,
  "data": { "results": [
    {
      "id": "…",
      "name": "Middle",
      "driver_category": "middle",
      "price_monthly": 999,
      "requires_commercial_and_private": true,
      "requires_commercial_at_purchase": true,
      "eligible": true,
      "ineligible_reasons": [],
      "vehicle_rule": {
        "required_at_purchase": { "commercial": 1, "private": 0 },
        "ongoing":              { "commercial": 1, "private": 1 },
        "current":              { "commercial": 1, "private": 0 }
      }
    }
  ] }
}
```

- **`requires_commercial_at_purchase`** (new field): `true` on Middle and Prime, `false` on Lower. This is the flag that actually decides what checkout demands — see A.4.
- **`vehicle_rule`** (new object, on every tier, not just driver-network ones): explains itself for the plan card.
  - `required_at_purchase` — what you need **today**, to buy this plan right now.
  - `ongoing` — what you need to **keep** this plan afterwards (used by the grace-period logic).
  - `current` — the driver's actual vehicle counts, so you can render "you have 1 commercial, 0 private" against the requirement without a second call.
- `requires_commercial_and_private` is unchanged in meaning — it's still the **ongoing** rule. Don't use it alone to decide whether a purchase will succeed; use `requires_commercial_at_purchase` (or just `eligible`/`ineligible_reasons`, which already account for both).

**Suggested plan-card copy**, using `vehicle_rule`:

- Eligible, `required_at_purchase.private == 0` and `ongoing.private == 1`: *"Add a private vehicle within 15 days of purchase."* (a soft heads-up, not a blocker)
- Ineligible with `NEED_COMMERCIAL_VEHICLE`: *"Add a commercial vehicle to unlock this plan."*
- The old reason `NEED_PRIVATE_VEHICLE` still exists in the API for any tier that sets `requires_commercial_and_private: true` **without** `requires_commercial_at_purchase: true` — none of the seeded tiers currently do this, but handle it; don't assume it's dead.

### A.3 `GET /drivers/category` — two new fields, nothing removed

```json
{
  "success": true,
  "data": {
    "category": "middle",
    "tier": { "id": "…", "name": "Middle", "badge_color_hex": "#F59E0B" },
    "expires_at": "2026-10-18T00:00:00.000Z",
    "permissions": {
      "can_create_rides": true,
      "can_publish_rides": true,
      "can_manage_fleet": false,
      "max_routes": 5,
      "routes_used": 1,
      "max_fleet_drivers": 0,
      "max_vehicles": 0,
      "requires_commercial_at_purchase": true,
      "customer_lead_contact_fee": 0,
      "driver_lead_contact_fee": 0,
      "customer_ride_accept_fee": 0
    },
    "vehicle_rule": { "required": true, "ok": false, "commercial": 1, "private": 0 },
    "city": { "id": "…", "name": "Indore", "prime_limit": 5, "prime_slots_left": 4 },
    "grace": { "active": true, "ends_at": "2026-10-09T00:00:00.000Z", "reason": "VEHICLE_RULE_BROKEN" }
  }
}
```

- **`permissions.max_vehicles`** (new): how many vehicles this driver's tier allows under their own organisation. `0` means unlimited. Lower is `2`; show a driver-facing message once they hit it (`VEHICLE_LIMIT_REACHED`, see A.5) rather than only after the API refuses.
- **`permissions.requires_commercial_at_purchase`** (new): informational, mirrors the tier's flag. Not usually needed once already subscribed — it matters at the plan-selection screen (A.2), not here.
- **`vehicle_rule`** here is unchanged in shape (`{required, ok, commercial, private}`) — this is still the **ongoing** rule, same as before. A Middle driver who bought on commercial-only will show `vehicle_rule.ok: false` until the private vehicle is added — that's expected, not a bug, and it's exactly what should drive the grace banner.
- **`grace.active` / `grace.ends_at`** — unchanged shape, but now this can become `true` **immediately after a successful purchase**, not only after a vehicle is later removed. The existing "persistent red banner" UI from `driver-network-flutter-integration.md` §5 already handles this correctly with no changes — the grace *reason* (`VEHICLE_RULE_BROKEN`) and the countdown are the same either way. The only practical difference the app should know about: the countdown may start at up to 15 days instead of 7 — don't hardcode 7 days anywhere for this banner; always read `grace.ends_at`.

### A.4 Buying Middle/Prime — what actually changed at checkout

`POST /drivers/subscription/checkout` and `POST /drivers/subscription/verify-payment` are the same calls as before, same request/response shape. What changed is **when checkout succeeds**:

| Driver has | Middle/Prime checkout |
|---|---|
| 1 commercial vehicle only | **Succeeds.** Category granted immediately. Grace period starts automatically (15 days) for the missing private vehicle. |
| 1 private vehicle only | Still refused — `422 NEED_COMMERCIAL_VEHICLE`. |
| Both | Succeeds, no grace period needed. |

No new call, no new payload field. If checkout used to be blocked and you showed `NEED_COMMERCIAL_VEHICLE` **and** `NEED_PRIVATE_VEHICLE` together for a private-only driver — that behaviour hasn't changed, they're still both missing. What changed is a **commercial-only** driver, who used to also see `NEED_PRIVATE_VEHICLE` and is now `eligible: true`.

### A.5 Adding a vehicle — now open to every approved driver

`POST /drivers/fleet/vehicles` (the existing fleet-vehicle screen) previously returned `403 "Vehicle addition is only available for owner accounts"` for any driver who wasn't already Middle/Prime. **That gate is gone.** Any approved driver, on any plan, can now call this successfully — it creates their organisation on first use, exactly like it already did for Middle/Prime.

Nothing about the request body changed (`make`, `model`, `number`, `color`, `usage_type`, `documents`, still `COMMERCIAL_PERMIT_REQUIRED` for a commercial vehicle with no permit — see `driver-network-flutter-integration.md` §17, unchanged).

**New failure mode to handle — `VEHICLE_LIMIT_REACHED`:**

```json
{
  "success": false,
  "message": "Your plan allows up to 2 vehicle(s)",
  "code": "VEHICLE_LIMIT_REACHED",
  "details": { "limit": 2, "used": 2 }
}
```

- HTTP 403.
- Only reachable by a driver whose tier sets a nonzero `max_vehicles` (Lower today; check `GET /drivers/category`'s `permissions.max_vehicles` before showing the "Add Vehicle" button as available, and disable it with a message once `used >= limit` — you can get `used` from your own fleet-vehicles list count, no new endpoint needed).
- Middle/Prime have `max_vehicles: 0` (unlimited) and will never hit this.

This is the entry point that makes A.1 step 5 work: a Lower driver taps "Add Vehicle" from the same screen Middle/Prime already use, adds a commercial vehicle (with permit), then goes and buys Middle. **If the app currently hides "Add Vehicle" behind `can_create_rides` (Middle/Prime only), that gate must come out** — that was exactly the bug this fix closes. Replace it with the `max_vehicles` cap check above, which is real and enforced server-side regardless of what the client does.

There's also a `DRIVER_NOT_APPROVED` (403) response from this same endpoint, for an unapproved driver trying to open a first organisation — in practice this can't be reached through the app today, since login itself already refuses an unapproved driver a token. Handle it defensively (generic error toast) but don't build a dedicated screen for it.

### A.6 What did **not** change

- The commercial-vehicle claim is still **self-declared** — no permit verification is enforced before it counts toward eligibility, at purchase or ongoing. This was a deliberate product decision (zero friction for the client), not an oversight. The backend now keeps an internal audit log when a category is granted on an unverified claim, but that's server-side only and needs no client change.
- Fleet vehicles still only count once `status: 'approved'` — a `pending` vehicle (including one added under the new open-to-everyone path) doesn't yet satisfy any rule. Keep showing the existing "pending approval" state from `driver-network-flutter-integration.md` §17.
- Fleet **driver** hiring (as opposed to vehicles) is still Prime-only, unchanged.
- The full error-code table in `driver-network-flutter-integration.md` §3 is still accurate — this doc only adds `VEHICLE_LIMIT_REACHED` to it (and confirms `DRIVER_NOT_APPROVED` exists but is effectively unreachable from the app, as above).

---

## Part B — Taxi-only platform

### B.1 The product decision

This app has one driver product: **Taxi**. There is no Delivery, no Pooling, and no separate Outstation category for drivers — "Taxi" covers both short local rides and long intercity trips. A driver never picks a category; the backend enforces `taxi` regardless of what's sent.

### B.2 Registration — remove the Service Category step

`PATCH /drivers/onboarding/vehicle` still accepts `serviceCategories` / `registerFor` for backward compatibility, but **for an individual driver session it now silently ignores whatever is sent** and always saves `serviceCategories: ["taxi"]`, `registerFor: "taxi"`. It never produces `"both"` any more, even if the app sends `["taxi", "outstation"]`.

**What to do:**

- Remove the Service Category chips/step from `register_vehicle_screen.dart` (or wherever they live) — they have no effect and will only confuse a driver into thinking they're choosing something.
- Either stop sending the field entirely, or keep sending the constant `["taxi"]` if that's less disruptive to the request builder — both produce the identical result server-side.
- `GET /drivers/vehicle-field-templates` no longer lists a Service Category field at all (it's hidden server-side, not just unused) — if the registration form builds itself dynamically from this endpoint, this field will simply stop appearing; no special-casing needed.
- This does **not** apply to owner/vendor onboarding (the self-drive-owner / fleet-owner flow) — that flow is untouched and still has its own meaning for these fields. It's a separate screen the driver app doesn't call for a normal driver signup, so this shouldn't affect anything you already have.

### B.3 Matching — no app change, but a real fix underneath

Every taxi driver's plan (Lower, Middle, Prime, and the older Basic/Premium/Super Premium tiers) now genuinely includes both local (`city`) and intercity (`outstation`) rides. Previously the free/entry tier only had `city`, which meant those drivers were silently skipped for every intercity ride request — no error, they just never saw it. That's fixed at the data level; **there is nothing for the app to build here.** If you've previously worked around this (e.g. hiding or graying out an "accept outstation rides" toggle for Lower drivers because it never seemed to work), that workaround can come out — it should work correctly now for every plan.

No taxi driver's tier includes parcel or carpool delivery modules — that was already true for most tiers and is now true for all of them, so a taxi driver should never receive a delivery/pooling-style request either way.

### B.4 Vehicle type catalog — optional filter, fully backward compatible

`GET /users/vehicle-types` (the same endpoint you already call for the vehicle-selection list) now accepts two optional query params:

```
GET /users/vehicle-types?transport_type=taxi&active=true
```

- **No params** → identical response to today, unchanged. Nothing breaks if you don't touch this.
- `transport_type=taxi` → only vehicle types marked `taxi` or `both` in admin.
- `active=true` → only vehicle types the admin currently has switched on.

**Recommended:** call it with both params on the registration/vehicle-selection screen, so a deactivated or non-taxi vehicle type (something admin is trialing for a different product) never shows up as a choice — previously this endpoint returned everything with no filter, so a driver could pick a vehicle type that was actually inactive or meant for delivery. If your app currently filters this list client-side on `transport_type`/`active` as a workaround, you can now delete that client-side filter and rely on the query params instead — same result, one round trip instead of filtering a bigger payload.

`image` and `map_icon` are always present on each entry (empty string if genuinely not set) — no change there, just confirming it's safe to bind directly.

### B.5 What did **not** change

- No new vehicle-type fields, no change to the vehicle-selection card shape.
- The rider/customer side of vehicle types, and parcel/pooling features on the *rider* app, are untouched — this change is scoped to the driver app's registration and matching.
- The endpoint path, auth requirement (none — it's public), and response envelope for `GET /users/vehicle-types` are all unchanged; only the two optional query params are new.

---

## Updated error-code reference (delta only)

Add these to the table in `driver-network-flutter-integration.md` §3; everything already listed there is unchanged.

| Code | HTTP | Where | What to show |
|---|---|---|---|
| `VEHICLE_LIMIT_REACHED` | 403 | `POST /drivers/fleet/vehicles` | "Your plan allows up to N vehicles" — `details.limit` / `details.used` are provided; disable "Add Vehicle" proactively using `permissions.max_vehicles` from `GET /drivers/category` rather than waiting for this |
| `DRIVER_NOT_APPROVED` | 403 | `POST /drivers/fleet/vehicles` | Generic error toast; not reachable in normal app use (see A.5) |

`NEED_COMMERCIAL_VEHICLE` and `NEED_PRIVATE_VEHICLE` are unchanged codes, just fired under updated conditions per A.4.

---

## Suggested model changes (Dart)

Additions to whatever model backs `GET /drivers/category` and `GET /drivers/subscription/tiers` in `lib/features/subscription/domain/subscription_models.dart` (per the original doc's file reference):

```dart
class DriverPermissions {
  // ...existing fields unchanged...
  final int maxVehicles; // 0 = unlimited
  final bool requiresCommercialAtPurchase;
}

class VehicleRuleBreakdown {
  final VehicleCount requiredAtPurchase;
  final VehicleCount ongoing;
  final VehicleCount current;
}

class VehicleCount {
  final int commercial;
  final int private;
}

class SubscriptionTierOption {
  // ...existing fields unchanged...
  final bool requiresCommercialAtPurchase;
  final VehicleRuleBreakdown vehicleRule;
}
```

`describeIneligibleReason` needs no new branch — the reason set (`NEED_COMMERCIAL_VEHICLE`, `NEED_PRIVATE_VEHICLE`, `PRIME_SLOTS_FULL`, `CITY_REQUIRED`, `DRIVER_NOT_APPROVED`) is unchanged, only *when* each fires changed.

---

## Acceptance checklist

Test these against a real server (staging or the deployed backend) before shipping:

- [ ] Register a new driver, don't touch the Service Category step (or confirm it's gone from the UI) → driver ends up as a normal taxi driver, receives both city and intercity ride requests.
- [ ] A Lower driver with only their onboarding vehicle (private) sees Middle/Prime as **ineligible**, reason `NEED_COMMERCIAL_VEHICLE`.
- [ ] That same driver taps "Add Vehicle" (previously hidden/disabled for Lower) — it works, creates their organisation, vehicle goes to pending.
- [ ] Admin approves that vehicle as commercial (outside the app) → driver now shows Middle as **eligible**.
- [ ] Driver buys Middle with only the commercial vehicle → checkout succeeds, category becomes Middle immediately, `GET /drivers/category` shows `grace.active: true` with `grace.ends_at` roughly 15 days out.
- [ ] Driver adds a private vehicle (gets approved) within the grace window → `grace.active` returns to `false`, category stays Middle.
- [ ] A Lower driver adds a 2nd fleet vehicle successfully, a 3rd is refused with `VEHICLE_LIMIT_REACHED`.
- [ ] Any taxi driver (any plan) receives an intercity ride request in testing, not just city ones.
- [ ] Vehicle-type list on registration, called with `?transport_type=taxi&active=true`, excludes anything admin has marked inactive or non-taxi.
