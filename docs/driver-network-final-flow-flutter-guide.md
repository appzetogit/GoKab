# GoKab Driver App — Final Driver Flow (Basic / Prime / Elite) Update

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented (commit `976850f`), not against the original spec.
> **Supersedes:** parts of `driver-network-vehicle-rule-and-taxi-only-flutter-guide.md` (Part A) — the grace-period-on-purchase behaviour described there no longer applies **if and once** the backend team runs `scripts/consolidate_to_basic_prime_elite.js`. Until they do, that doc is still accurate. Ask them which state the environment you're pointed at is in before assuming either.
> Everything in `driver-network-flutter-integration.md` (sockets, routes, network rides, feed, leads, wallet, live map) is unaffected.

This is the biggest practical change for the app: the vehicle-usage-type choice at registration **actually saves now** (it silently didn't before), and buying Prime/Elite works cleanly end to end with no leftover grace-period nagging.

---

## 1. Registration: the commercial/private choice now works — and must be asked

**The bug this fixes:** the app has presumably been sending `vehicle_usage_type` at the vehicle step for a while already (per the earlier integration doc's advice). It had **no effect** — the backend was silently dropping it before saving, so every driver ended up with an empty usage type regardless of what the app sent, permanently blocking them from ever buying Prime/Elite. That's fixed now; whatever the app sends is what gets saved.

**What the app must do:**

- Make the Commercial/Private choice on the vehicle step **mandatory in the UI**, with no pre-selected default — this is now a real, final product decision, not a nice-to-have. The backend is still lenient about receiving nothing (to avoid breaking an app build already in review), but don't rely on that; always send one.
- Request field, unchanged: `PATCH /drivers/onboarding/vehicle` with `{ "vehicle_usage_type": "commercial" }` or `"private"`.
- If the backend ever starts rejecting a missing value, it will be `400` with `code: "USAGE_TYPE_REQUIRED"` — handle that code defensively even though it isn't live yet.

**Verify this specifically before shipping:** register a fresh test driver choosing Commercial, complete registration, then check `GET /drivers/me` (or `/drivers/category`) shows the driver actually has a commercial vehicle. Before this fix, it always came back empty no matter what was chosen — this is exactly the kind of thing that looks fine in the UI (the picker works, the request succeeds) while silently saving nothing.

---

## 2. Buying Prime/Elite: no more leftover "add a private vehicle" nagging

**If the backend has run the plan consolidation** (`scripts/consolidate_to_basic_prime_elite.js` — ask them), Prime and Elite no longer have an ongoing private-vehicle requirement at all. Practically, for the app:

- Buying Prime/Elite still needs a commercial vehicle (unchanged from the previous update — see `driver-network-vehicle-rule-and-taxi-only-flutter-guide.md` §A.4).
- **After purchase, `grace.active` on `GET /drivers/category` will simply stay `false` forever for these plans.** The grace banner UI already built for the previous update doesn't need removing — it just won't fire for Prime/Elite anymore. It's still real code for any future tier that does set `requires_commercial_and_private: true`, so leave it in place.
- No downgrade-for-missing-private-vehicle will ever happen on these plans. A Prime/Elite driver's category is stable until the subscription itself expires.

**If the backend has NOT run the consolidation yet**, nothing here applies and the previous doc's grace-period behaviour (15-day window, possible downgrade) is still what happens. This is a per-environment thing — confirm which one you're testing against.

**New, and this part is unconditional regardless of consolidation:** buying Prime/Elite now creates the driver's organisation **immediately**, as part of the purchase. Previously it only got created the first time the driver happened to add a vehicle or a network ride — a driver who bought Prime and went straight to "Add a fleet driver" got a bare 403 with nothing explaining why. That's fixed; no app change needed, but if you built a workaround (e.g. silently calling some other endpoint first to "warm up" the organisation before letting the driver into the fleet screens), it can come out.

---

## 3. Fleet screens: "no organisation yet" is not an error anymore

`GET /drivers/fleet/vehicles` and `GET /drivers/fleet/drivers` used to return `403` for a driver who hadn't added a vehicle yet (no organisation created). **They now return `200` with `{ "results": [] }`.**

If the app currently treats a 403 from either of these as an error state (error toast, retry button, "something went wrong" screen), **remove that** — an empty list is a completely normal state for a driver who just bought a plan and hasn't added anything yet. Show the normal empty-state UI (whatever you already show for "no vehicles/drivers added yet"), not an error.

`POST /drivers/fleet/drivers` (hiring a fleet driver) is unaffected — you still need an organisation to hire into it, so that one still fails if there isn't one yet. Only the two `GET` list endpoints changed.

---

## 4. Add Vehicle: only asks for documents about the vehicle now

**The bug this fixes:** `POST /drivers/fleet/vehicles` used to demand every one of the driver's own identity documents (licence, ID photo, etc.) be re-submitted on every single vehicle add — documents the driver already uploaded at registration, with nothing to do with the vehicle being added. Depending on what your deployment's admin panel has configured as "required," this could have made Add Vehicle **completely unusable**. This is fixed: only documents an admin has explicitly scoped to vehicles apply here now.

**What the app should do:**

- Fetch the required document set for the Add Vehicle screen with `GET /drivers/document-templates?role=fleet` (this already existed; the only change is what it returns is now the right, smaller set). Build the upload form from whatever comes back — don't hardcode a fixed list of fields, since admin can add or remove vehicle document requirements over time.
- The Commercial Permit requirement is unchanged in mechanics: sending `usage_type: "commercial"` with no `commercial_permit` document still gets `400 COMMERCIAL_PERMIT_REQUIRED`. Private vehicles never need it.
- **New, optional but recommended:** `GET /drivers/document-templates?role=fleet&usage_type=commercial` (or `private`) filters out any document template scoped to the other usage type. Right now that's just Commercial Permit (scoped to `commercial`), but if admin adds more usage-type-specific vehicle documents later, this keeps the form correct automatically. If you don't pass `usage_type`, nothing changes from today.

**Document upload — a real fix, not just a filter:** if the app was sending a raw base64 image (a data URL) for a vehicle document, it used to get stored as-is — a multi-megabyte string sitting in the database, never actually uploaded anywhere, and never displayable as an image URL. That's fixed: a data URL sent here now gets uploaded the same way a registration document does, and the field ends up holding a real hosted image URL. If the app already uploads the image itself first and only sends a hosted URL (the more common pattern), nothing changes for you. If it was sending a raw data URL directly in this call, it will now work correctly instead of silently corrupting the field — no app change is required either way, but it's worth knowing the field will now actually contain what you expect if you ever inspect it.

---

## 5. Vehicle approval/rejection now actually tells the driver

Previously, approving or rejecting an added vehicle was completely silent — no push, no socket event, nothing. The only way to notice was to keep refreshing the vehicle list and see the status had changed on its own.

**New socket event**, delivered to the driver's own room (same room every other `driver:*` event uses):

```json
// event: driver:vehicle:status
{
  "vehicle_id": "6ab5…",
  "status": "approved",   // or "rejected"
  "reason": ""            // populated on rejection
}
```

**New push notification**, alongside it:

```json
{
  "type": "vehicle_status_changed",
  "vehicle_id": "6ab5…",
  "status": "approved",
  "reason": ""
}
```

**What to build:** listen for `driver:vehicle:status` the same way the app already listens for `driver:category:updated` / `driver:category:grace` (per `driver-network-flutter-integration.md` §4), and refresh the vehicle list / plan-eligibility screen when it fires. Show the `reason` on a rejection — it's now guaranteed to be present (admin can't reject without giving one, enforced server-side).

If a commercial vehicle's permit was already uploaded when admin approves it, `usage_type_verified` on that vehicle now automatically becomes `true` at the same time (previously a separate, easy-to-miss admin action) — the vehicle list response already includes `usage_type_verified` per the earlier integration doc; nothing new to read, it will just start turning `true` more reliably.

---

## 6. New eligibility reason: `COMMERCIAL_VEHICLE_PENDING_APPROVAL`

If a driver has already added a commercial vehicle but admin hasn't approved it yet, `GET /drivers/subscription/tiers`'s `ineligible_reasons` for Prime/Elite will now contain **both**:

```json
"ineligible_reasons": ["NEED_COMMERCIAL_VEHICLE", "COMMERCIAL_VEHICLE_PENDING_APPROVAL"]
```

`NEED_COMMERCIAL_VEHICLE` is kept for backward compatibility — if you haven't updated `describeIneligibleReason` yet, the plan card will still correctly show as ineligible, just with the less precise "add a commercial vehicle" copy.

**Recommended:** check for `COMMERCIAL_VEHICLE_PENDING_APPROVAL` first and show *"Your commercial vehicle is waiting for admin approval"* instead of *"Add a commercial vehicle"* — telling a driver to add something they already added is a bad, confusing experience, and this reason exists specifically so the app doesn't have to.

---

## 7. Plan names are not stable — never hardcode them

The backend team may rename the driver-network tiers (e.g. "Middle" → "Prime", "Prime" → "Elite") as part of this rollout, reusing the same underlying tier records so nothing breaks structurally — `tier.id`, `driver_category`, and every permission field stay exactly where they are; only `tier.name` (and possibly `badge_color_hex`) changes. This has always technically been true (`driver-network-flutter-integration.md` already says the catalogue is fully data-driven), but it's worth restating here: **if anything in the app branches on a plan's name string** ("Prime", "Middle", copy lookups keyed by name, etc.) instead of `driver_category` or the feature flags in `permissions`, this is the moment that breaks. Audit for that before this ships.

---

## What did **not** change

- The plan-purchase checkout/verify-payment calls, request/response shapes — unchanged.
- The vehicle-mix eligibility mechanics from the previous update (`requires_commercial_at_purchase`, `vehicle_rule`, `max_vehicles`, `VEHICLE_LIMIT_REACHED`) — unchanged, still exactly as documented in the previous guide.
- Registration document upload for the driver's own identity documents (licence, ID, photo) — unchanged; this update only touched what's required for a **vehicle**, not the driver.
- `driver-network-flutter-integration.md`'s sockets, routes, network rides, feed, leads, wallet, and live-map sections — untouched by any of this.

---

## Acceptance checklist

- [ ] Register a new driver choosing **Commercial** — confirm (via `/drivers/category` or a direct DB check the backend team can run) it actually saved, not just that the screen advanced.
- [ ] Register choosing **Private** — same check, confirm it saved as `private`.
- [ ] That commercial driver buys Prime/Elite — organisation exists immediately after purchase (try "Add a fleet driver" right away, no separate step needed first).
- [ ] Ask the backend team whether `consolidate_to_basic_prime_elite.js` has run on the environment you're testing against, before asserting anything about grace periods one way or the other.
- [ ] A brand-new driver (no vehicles added) opens the fleet vehicles/drivers screens — empty state, not an error screen.
- [ ] Add Vehicle screen — only asks for vehicle-relevant documents (RC, permit-if-commercial), not the driver's own licence/ID again.
- [ ] Add a commercial vehicle, have admin approve it (outside the app) — driver receives the push/socket event, plan eligibility updates without needing to force-quit the app.
- [ ] Add a commercial vehicle, have admin reject it with a reason — driver sees that reason somewhere in the UI.
- [ ] Before that vehicle is approved, the plan screen shows `COMMERCIAL_VEHICLE_PENDING_APPROVAL`-driven copy, not "add a vehicle."
- [ ] Search the app for any string comparison against a plan's `name` ("Prime", "Middle", "Elite", "Basic", ...) and confirm none of it drives actual feature gating.
