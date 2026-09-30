# GoKab Driver App — Create Fleet Ride (Create + Assign in One Call)

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented (commit `fedb152`), not against the original spec.
> **Scope:** the **Network → Create Ride** screen (fleet ride creation). The **Home → + (Post Booking)** flow is untouched — read that section anyway, it explains why.

---

## 1. Two ride-creation flows now have a clear, separate meaning

| Flow | Screen | What it does |
| --- | --- | --- |
| **Post to Network** | Home → **+** (Post Booking) | Creates the ride and publishes it to the network feed. **No change here** — keep calling create, then `/publish`, exactly as today. |
| **Create Fleet Ride** | Network → Create Ride | Creates the ride **and assigns it** — to the owner's own driver, or to themselves — **in one call**. This is the flow this guide is about. |

The reason for the split: a fleet ride created without a driver used to be possible if the follow-up `/assign` call failed or was skipped — it just sat there as an unassigned, orphaned ride cluttering the owner's list. That can't happen anymore for this flow.

---

## 2. What changes: one new field on the existing create call

`POST /drivers/network/rides` — same endpoint, same payload, plus one new optional field:

```json
{
  "customer": { "name": "Varun", "phone": "9966665123" },
  "pickup": { "address": "Indore", "coordinates": [75.8577, 22.7196] },
  "drop":   { "address": "Bhopal", "coordinates": [77.4126, 23.2599] },
  "fare": 5000,
  "paymentMethod": "cash",
  "scheduledAt": "2026-09-30T17:17:00.000Z",
  "vehicleTypeId": "6a52...",
  "notes": "",
  "serviceType": "ride",

  "assign_to_driver_id": "6abced9c9ccebdab3ffc034a"
}
```

`assignToDriverId` (camelCase) works identically if that's more convenient for your request-building code — send either, not both.

- **On the Create Ride screen (Network tab):** the driver picker is no longer optional — always send `assign_to_driver_id`, whether the owner is assigning to one of their fleet drivers or keeping it for themselves (self-assign — send their own driver id).
- **On the Post Booking screen (Home tab):** don't send this field at all. Nothing changes there; that flow still creates unassigned and publishes separately.

**Response** is the same shape `/assign` already returns — no separate response parsing needed, the ride comes back already assigned:
```json
{
  "success": true,
  "data": {
    "id": "...",
    "status": "accepted",
    "liveStatus": "accepted",
    "assignment": {
      "mode": "direct_assign",
      "assigned_at": "...",
      "driver": { "id": "...", "name": "Tarun", "phone": "...", "vehicleNumber": "...", "isOnline": true, "isOnRide": true }
    },
    "publish": { "status": "none", "...": "..." }
  }
}
```

---

## 3. Error handling — same codes `/assign` already uses, now on create too

If assignment fails for any reason, **the ride is never created** — there's nothing left behind to clean up or refetch. Show the error and let the owner retry the whole form.

| HTTP | code | When | Suggested message |
| --- | --- | --- | --- |
| 403 | `CATEGORY_NOT_ALLOWED` | Assigning to someone other than self, but the plan doesn't include fleet management | "Your plan only allows taking rides yourself or publishing them" |
| 404 | `DRIVER_NOT_FOUND` | Target driver id doesn't exist, is deleted, or isn't approved | "Driver not found" |
| 403 | `DRIVER_NOT_IN_FLEET` | Target driver belongs to a different organisation | "That driver is not in your fleet" |
| 409 | `DRIVER_BUSY` | Target is already on a ride right now (immediate ride), has a clashing scheduled trip (`details.conflictingRideId`), **or** was taken by something else in the instant between your request landing and the assignment completing | "That driver is busy — try again" / "That driver already has a trip in this time range" |
| 422 | `CUSTOMER_REQUIRED`, `INVALID_FARE`, etc. | Same validation the form already handles today | existing handling |

**New nuance on `DRIVER_BUSY`:** it can now happen on `create+assign` from a genuine race — two people tried to assign the same free driver at almost the same moment. If you get this error, it's not a bug to report; it means someone else grabbed that driver a split second earlier. Just show "That driver just became unavailable, try again" and let the owner either retry or pick someone else — don't treat it as a form-validation failure.

---

## 4. Nothing else on this screen changes

- Field list, types, and every other validation on Create Ride — unchanged.
- The manual **Unassign → Publish** fallback (if a driver later can't do the trip) still works exactly as before, via the existing `/unassign` and `/publish` endpoints.
- `POST /assign`, `/unassign`, `/reassign` on an already-created ride — all unchanged, still available for the manual-adjustment case.
- The driver feed still only ever shows published rides — a fleet ride created this way never appears there, same as today.

---

## Acceptance checklist

- [ ] Create Ride (Network tab) always sends `assign_to_driver_id` — form can't be submitted without picking a driver (or self).
- [ ] Self-assign (owner picks themselves) — ride comes back `status: accepted`, `assignment.driver.id` matches the owner's own id.
- [ ] Assign to a fleet driver — that driver receives the usual assignment notification, same as after a manual `/assign` call.
- [ ] Post Booking (Home tab) is unaffected — still creates unassigned, still calls `/publish` after.
- [ ] Trigger each error case (a driver on a plan without fleet management, a driver from another org, a busy driver) and confirm the app shows a clear message and does **not** show a half-created ride anywhere in the list — because none was created.
- [ ] Simulate/observe two rapid create-and-assign attempts to the same driver (e.g. two staff tapping create around the same time) — confirm one succeeds and the other shows a clear "driver just became unavailable" message, not a crash or a duplicate ride.
