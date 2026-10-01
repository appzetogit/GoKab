# GoKab Driver App — "Assigned by" on Network Rides

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented (commit `cf02436`).
> **Scope:** `GET /drivers/network/rides` (both scopes), the create+assign and assign/reassign responses, and `GET /drivers/scheduled-rides`. Nothing else changes.

## 1. The problem this fixes

The **Network Rides → "Assigned to me"** tab already exists. Until now, the only place a driver could see *who* handed them a ride ("From: Ram Travels · Ram") was a one-time toast on the `network:ride:assigned` socket event — if the app was closed when it fired, or the list was simply refreshed later, that information was gone for good. It's now part of the ride object itself, so it survives a refresh or app restart.

## 2. New field: `assignment.assigned_by`

Every ride object returned by the network-rides endpoints now carries this inside `assignment`:

```json
"assignment": {
  "mode": "direct_assign",
  "assigned_at": "2026-09-30T13:18:22.537Z",
  "assigned_by": {
    "driver_id": "6ab646dc85f84ee64d9eeb68",
    "name": "Ram",
    "phone": "9879879870",
    "org_name": "Ram Travels"
  },
  "driver": { "...": "unchanged" }
}
```

| Field | Meaning |
| --- | --- |
| `driver_id` | Whoever actually made the assignment call (self-assign, fleet-assign, or a later reassign) |
| `name` | The organisation owner's display name — same name the assignment toast already showed, so the two never disagree |
| `phone` | The assigner's phone number |
| `org_name` | The organisation name ("Ram Travels") |

**`assigned_by` is `null` whenever the ride isn't currently direct-assigned** — an unassigned/published ride, or one sitting in the open dispatch pool. Only check this field, don't infer it from anything else:

```dart
final assignedBy = ride['assignment']?['assigned_by'];
if (assignedBy != null) {
  // show "From: ${assignedBy['org_name']} · ${assignedBy['name']}"
}
```

## 3. Where it shows up

- `GET /drivers/network/rides?scope=assigned_to_me` — the fleet driver's own "Assigned to me" tab. This is the main use case: show the card's "From: X" line here.
- `GET /drivers/network/rides?scope=created` — the owner's own view of rides they created, useful if a manager/second admin did the actual assigning.
- The response of `POST /drivers/network/rides` (create, when it includes `assign_to_driver_id`/`assignToDriverId`), `POST /drivers/network/rides/:id/assign`, and reassign — all carry the same field on the ride they return, so there's no need for a follow-up list refresh just to show it immediately after assigning.
- `GET /drivers/scheduled-rides` — see §4 below.

**Self-assign:** if a driver assigns a ride to themselves, `assigned_by.driver_id` equals their own id — this is expected, not a bug.

## 4. Bonus: `origin` + `assigned_by` on Scheduled Rides

`GET /drivers/scheduled-rides` items now also carry:

```json
{
  "rideId": "...",
  "origin": "driver_created",
  "assigned_by": { "driver_id": "...", "name": "Ram", "phone": "...", "org_name": "Ram Travels" },
  "...": "everything else unchanged"
}
```

- `origin` is `"driver_created"` for a network/fleet ride, `"customer_app"` for an ordinary rider-app booking. Use this to decide whether to show an "Assigned by X" tag on a scheduled-ride card at all — a `customer_app` ride will always have `assigned_by: null`.
- `assigned_by` follows the exact same shape and null-rule as §2/§3.

## What did **not** change

- `assignment.mode`, `assignment.assigned_at`, `assignment.driver` — all unchanged, same shape as before.
- `otp_masked` — still masked on every list endpoint, nothing new exposed here.
- The `network:ride:assigned` socket event and its toast — unchanged; it shows the same name as `assigned_by.name` now, just no longer the *only* place that name appears.
- No new endpoint, no new query params — this is purely additive fields on responses the app already calls.

## Acceptance checklist

- [ ] "Assigned to me" tab card shows "From: {org_name} · {name}" using `assignment.assigned_by`, not the toast.
- [ ] Card correctly shows nothing (no "From:" line) when `assigned_by` is `null`.
- [ ] Self-assigning a ride shows the driver's own name/org in `assigned_by` without any special-casing in the app.
- [ ] Reassigning a ride to someone else updates `assigned_by` to the new assigner the next time the list is fetched.
- [ ] Scheduled Rides list can distinguish a network ride (`origin: "driver_created"`) from a normal booking and show the "Assigned by" tag only on the former.
