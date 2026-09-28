# GoKab Driver App — Fleet Drivers CRUD Update

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented (commit `0c5b71c`), not against the original spec.
> **Scope:** the "Add Driver" / fleet-driver management screens a Pro/Elite (Prime/Elite) driver — or an owner-portal login — uses to hire and manage drivers. Nothing else in `driver-network-flutter-integration.md` or the other guides changes.

The shape of a fleet driver is now deliberately small: **name, mobile, identity documents, and exactly one vehicle.** Email, salary, zone and city are gone from this API. If the current Add Driver screen has fields for any of those, they need to come out.

---

## 1. Fields removed from the API — email, salary, zone, city

**Request:** stop sending `email`, `salary`, `zoneId`/`zone_id`, `city` on `POST /drivers/fleet/drivers` and `PATCH /drivers/fleet/drivers/:driverId`. They're silently ignored now, not rejected — but don't rely on that; remove the fields from the form.

**Response:** `email`, `salary`, `zoneId`, `zone`, `city` no longer appear anywhere in the fleet-driver list/create/update response. If the app reads any of these off a fleet driver object, that code needs to go too. `city` is still derived server-side from the owner's service location — you just never send or receive it for a fleet driver.

If the "Fleet Drivers" screen currently shows a salary column or a zone picker, remove them — there's no replacement, this was intentionally dropped.

---

## 2. A vehicle is now mandatory, and documents come from a real template list

### 2.1 Vehicle selection is required, not optional

`assignedFleetVehicleId` must be sent on **create**, and can never be cleared on **update** (sending `null` is a `400`). The Add Driver flow needs a vehicle picker step that can't be skipped. If the owner doesn't have a vehicle to assign yet, send them to Add Vehicle first — `POST /drivers/fleet/vehicles` — then come back and assign the returned `id`.

```
POST /drivers/fleet/vehicles   → vehicleId
POST /drivers/fleet/drivers    { name, phone, assignedFleetVehicleId: vehicleId, documents: {...} }
```

If the second call fails for any reason, the vehicle just stays in the fleet unassigned — no rollback needed, the owner can retry or pick a different vehicle for it later.

### 2.2 Documents are admin-configured, not hard-coded

**Fetch the required document set for Add Driver with:**

```
GET /drivers/document-templates?role=fleet_driver
→ { success, data: { results: [ <template with fields[]> ] } }
```

Build the upload form entirely from what comes back — don't hardcode "Driving Licence / Aadhaar / PAN" as fixed fields. An admin can add, remove, or stop requiring any of these later, and the list will just change under you. Each template's `fields[]` gives you the `key` to use in the `documents` map, a `label`, and whether it's `required`.

**Uploading:** send `documents` as `{ "<fieldKey>": { "dataUrl": "data:image/jpeg;base64,...", "identifyNumber": "...", "expiryDate": "..." } }` — same shape the driver's own registration document upload already uses. A field can also just be the raw data URL string with no wrapper object if there's no identify number/expiry to attach.

**If a required document is missing**, create fails with:
```json
{ "success": false, "message": "Missing required documents: panCard, aadhaarFront", "code": "DOCUMENTS_REQUIRED", "details": { "missing": ["panCard", "aadhaarFront"] } }
```
Use `details.missing` to highlight exactly which fields need attention, rather than a generic "fill the form" error.

**Until an admin runs the one-time backend migration** to scope the Driving Licence/Aadhaar/PAN templates to fleet drivers, `?role=fleet_driver` may return an **empty list** — meaning the Add Driver screen legitimately has no documents to ask for yet, not a bug. Check with the backend team if the form looks empty in a given environment.

---

## 3. Create: `POST /drivers/fleet/drivers`

```json
{
  "name": "Ramesh Kumar",
  "phone": "9876543210",
  "assignedFleetVehicleId": "66f...",
  "documents": {
    "drivingLicense": { "dataUrl": "data:image/jpeg;base64,...", "identifyNumber": "MP09...", "expiryDate": "12 Mar 2031" },
    "aadhaarFront": "data:image/jpeg;base64,...",
    "aadhaarBack": "data:image/jpeg;base64,...",
    "panCard": "data:image/jpeg;base64,..."
  }
}
```

**Response `201`** — the created driver, same shape as a list item (see §5):
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "Ramesh Kumar",
    "phone": "9876543210",
    "approve": false,
    "status": "pending",
    "isOnline": false,
    "isOnRide": false,
    "assignedFleetVehicleId": "66f...",
    "assignedVehicle": { "id": "66f...", "vehicleNumber": "MP09AB1234", "...": "..." },
    "documents": { "drivingLicense": { "uploaded": true, "status": "pending", "previewUrl": "..." } },
    "createdAt": "...",
    "message": "Fleet driver request created"
  }
}
```

**New behavior: a driver with no organisation yet can now go straight to Add Driver.** If a Prime/Elite driver hasn't added a vehicle or hired anyone before, this call creates their organisation automatically — no separate "set up your fleet" step needed first. If the app had any workaround for this (calling some other endpoint first to "warm up" the organisation), it can come out.

### Error codes to handle

| HTTP | code | Meaning | Suggested UI |
| --- | --- | --- | --- |
| 400 | — | `name is required` / invalid phone | Inline field error |
| 400 | `VEHICLE_REQUIRED` | No vehicle selected | Block submit, focus the vehicle picker |
| 400 | `DOCUMENTS_REQUIRED` | Required docs missing; `details.missing` lists keys | Highlight those fields |
| 403 | `DRIVER_NOT_APPROVED` | Caller's own driver account isn't approved yet | "Your account is pending approval" |
| 403 | `CATEGORY_NOT_ALLOWED` | Current plan doesn't allow hiring drivers (Basic/lower) | Prompt to upgrade to Prime/Elite |
| 403 | `FLEET_DRIVER_LIMIT_REACHED` | Plan's driver cap hit; `details = {limit, used}` | "You've reached your plan's driver limit (used/limit)" |
| 409 | `PHONE_ALREADY_REGISTERED` | Number belongs to another account | "This number is already registered elsewhere" |
| 409 | — | Vehicle already assigned to another driver (message names them) | Show the message, ask to pick a different vehicle |
| 409 | `VEHICLE_REJECTED` | The selected vehicle was rejected by admin | "Fix this vehicle's documents before assigning it" |

**Re-adding a previously removed driver "just works" now.** If an owner removed a driver and later re-adds the same phone number, the backend silently re-attaches their old record (same history, same wallet) instead of the create failing forever with "phone already registered". No special handling needed on the app side — it's a normal `201` response, same shape as any other create. Just don't assume the response id is guaranteed to be brand-new.

---

## 4. Update: `PATCH /drivers/fleet/drivers/:driverId` is now a partial update

**This changed from a full-replace to a partial update.** Send only the fields that changed — `name`, `phone`, `assignedFleetVehicleId`, `documents` — each independently optional. Don't re-send `name`/`phone` on every request just to change the vehicle; a field left out of the body is left untouched, not cleared.

- `assignedFleetVehicleId` **cannot be sent as `null`/empty** — a fleet driver always has a vehicle. Removing a vehicle assignment isn't supported; reassign to a different one instead.
- Changing the vehicle while the driver is mid-trip is blocked:
  ```json
  { "success": false, "message": "Driver is on a trip, change the vehicle after it ends", "code": "DRIVER_ON_TRIP" }
  ```
  Show this message and let the owner retry after the trip ends. Re-sending the *same* vehicle the driver already has never triggers this, even mid-trip.
- Assigning a rejected vehicle: same `409 VEHICLE_REJECTED` as create.
- Phone change: same `409 PHONE_ALREADY_REGISTERED` as create if the number belongs to someone else.

**Re-approval reset — important for the plan-eligibility / status UI:** if the driver was already `approve: true` and the owner changes their **phone number** or uploads **any document**, the backend automatically sends them back to `approve: false, status: 'pending'` and logs them out (`isOnline: false`). A **vehicle-only** change does *not* reset approval. If the app shows a "driver is approved" badge, refresh it from the PATCH response rather than assuming it's unchanged — a document re-upload can silently flip it back to pending.

**Response `200`:** same object shape as create (see §5).

---

## 5. List: `GET /drivers/fleet/drivers`

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "...",
        "name": "Ramesh Kumar",
        "phone": "9876543210",
        "approve": false,
        "status": "pending",
        "isOnline": false,
        "isOnRide": false,
        "assignedFleetVehicleId": "66f...",
        "assignedVehicle": {
          "id": "66f...", "vehicleNumber": "MP09AB1234", "vehicleMake": "Maruti",
          "vehicleModel": "Dzire", "vehicleTypeName": "Sedan", "status": "approved"
        },
        "documents": {
          "drivingLicense": { "uploaded": true, "status": "pending", "previewUrl": "https://..." }
        },
        "createdAt": "..."
      }
    ]
  }
}
```

**Changes vs before:**
- `email`, `salary`, `zoneId`, `zone`, `city` are gone from every list item. Remove any UI reading them.
- **A Prime/Elite driver no longer sees themselves in their own fleet-drivers list.** Previously the requester (the owner-driver) could show up as one of their own "fleet drivers" — that's fixed. If the app filtered them out client-side as a workaround, that filter is now redundant (harmless to leave, but can come out).
- `documents` is a map of `{ uploaded, status, previewUrl }` per field key — `status` is one of the usual review states (`pending`, `approved`/`verified`, `rejected`, depending on what admin review sets). Use it to show a per-document badge on the driver's detail screen rather than just a blanket "documents submitted" checkmark.

---

## 6. Delete/remove — one new guard on the vehicle side

`DELETE /drivers/fleet/drivers/:driverId` (remove from fleet) is unchanged: the driver is detached and deactivated, not account-deleted, and still refuses with `409` if the driver is on a trip.

**New:** `DELETE /drivers/fleet/vehicles/:vehicleId` now refuses if a driver is currently assigned to that vehicle:
```json
{ "success": false, "message": "Vehicle is assigned to Ramesh Kumar. Reassign or remove the driver first.", "code": "VEHICLE_ASSIGNED" }
```
If the Vehicles screen has a delete action, handle this the same way as any other conflict error — show the message, and either offer to reassign the driver first or block the delete.

---

## What did **not** change

- The driver-network sockets, routes, network rides, feed, leads, wallet, live-map flows from `driver-network-flutter-integration.md` — untouched.
- Vehicle add/edit payload shape (`POST`/`PATCH /drivers/fleet/vehicles`) — unchanged, still exactly as documented in the earlier guides.
- Driver login/OTP for a fleet-hired driver — unchanged; a hired driver still logs in with just mobile + OTP, no separate registration.

---

## Acceptance checklist

- [ ] Add Driver form has no email, salary, or zone fields.
- [ ] Add Driver form fetches its document list from `GET /drivers/document-templates?role=fleet_driver` instead of a hardcoded set.
- [ ] Vehicle selection is mandatory in the Add Driver flow — cannot submit without one.
- [ ] A brand-new Prime/Elite driver (no organisation yet) can go straight to Add Driver without a separate setup step.
- [ ] Submitting with a missing required document shows exactly which ones, from `details.missing`.
- [ ] Attempting to select a vehicle already assigned to another driver, or a rejected vehicle, shows the right message (test both).
- [ ] Update screen only sends changed fields (partial update) — confirm changing just the vehicle doesn't also resend name/phone.
- [ ] Changing an approved driver's phone or re-uploading a document — confirm the UI reflects them going back to "pending", not stuck showing "approved".
- [ ] Changing only the vehicle on an approved driver — confirm they stay approved.
- [ ] Attempting a vehicle change while the driver is on a trip shows `DRIVER_ON_TRIP`, not a generic error.
- [ ] Fleet drivers list no longer shows the logged-in Prime/Elite driver as one of their own drivers.
- [ ] Fleet drivers list shows per-document status, not just a single "documents complete" flag.
- [ ] Remove a driver, then re-add the same phone number — confirm it succeeds (re-attach) instead of "phone already registered".
- [ ] Attempt to delete a vehicle that has a driver assigned — confirm the `VEHICLE_ASSIGNED` message shows instead of a silent failure or a broken driver record.
