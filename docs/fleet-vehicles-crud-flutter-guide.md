# GoKab Driver App — Fleet Vehicles CRUD Update

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented (commit `cddf11e`), not against the original spec.
> **Scope:** the fleet **vehicles** screens (Add/Edit/Delete vehicle) a Pro/Elite driver — or an owner-portal login — uses to manage their fleet. Companion doc: `fleet-drivers-crud-flutter-guide.md` (the driver side of the same fleet). The rule both must agree on: **one vehicle ↔ one driver, and a fleet driver always has a vehicle.**

---

## 1. `vehicleTypeId` is now required on **create**, not just update

`POST /drivers/fleet/vehicles` now requires a valid `vehicleTypeId`, the same as `PATCH` already did. If the Add Vehicle screen ever let a driver submit without picking a vehicle type, that's no longer possible:
```json
{ "success": false, "message": "A valid vehicle type is required", "code": "FIELD_REQUIRED" }
```
Make the vehicle-type picker mandatory on Add Vehicle if it wasn't already — an untyped vehicle can't be dispatched, so this was always effectively required, just not enforced.

The other required fields (`make`, `model`, `number`, `color`) now also return `code: "FIELD_REQUIRED"` on create — if the app was matching on message text for inline errors, it's safer to switch to matching on `code` (message text is unchanged, but the code lets you localize/style it consistently across all four fields).

---

## 2. Vehicle documents now respect the vehicle's usage type

**No request change needed**, but the required-documents list you get back is now smarter: `GET /drivers/document-templates?role=fleet` only returns a template if it applies to *this* usage type — a commercial-only template (like Commercial Permit) is no longer shown as required for a **private** vehicle. If Add Vehicle was previously showing (and demanding) a commercial-only document even when "Private" was selected, that's fixed — refetch the template list whenever the usage-type toggle changes, since the required set can now genuinely differ between Commercial and Private.

Missing-document errors now carry a stable code and the list of missing keys:
```json
{ "success": false, "message": "Missing required documents: rc", "code": "DOCUMENTS_REQUIRED", "details": { "missing": ["rc"] } }
```
Use `details.missing` to highlight exactly which upload slots need attention.

The commercial-permit check is unchanged in behavior (still its own distinct error) but now also fires on **update**, not just create — see §4.

---

## 3. Number plates are now unique across the whole platform, not just your fleet

Previously two different owners could both register the same plate number (each scoped to their own fleet). That's no longer allowed — the check is now global:
```json
{ "success": false, "message": "This number plate is already registered", "code": "PLATE_ALREADY_REGISTERED" }
```
Same code on both create and update. If the app had any copy specifically saying "already in your fleet," update it to something ownership-neutral like *"This number plate is already registered."* — it may now legitimately belong to a completely different organisation.

A plate that was hard-deleted (see §6) becomes available again immediately, for any owner — no special handling needed, a delete truly frees it.

---

## 4. Editing a vehicle: new guards and a re-verification reset

### 4.1 Can't edit a vehicle while its driver is on a trip

```json
{ "success": false, "message": "This vehicle is on a trip right now. Edit it after the trip ends.", "code": "VEHICLE_ON_TRIP" }
```
Disable the Edit action (or show this on submit) for a vehicle whose assigned driver is currently on a ride — see §5 for how to detect this from the list.

### 4.2 An approved vehicle can go back to `pending`

Changing the **plate, vehicle type, or usage type**, or **uploading any new document**, on a vehicle that's already `approved` sends it back to `pending` for re-verification. Changing only **make, model, or colour** does **not** — those are cosmetic and don't require admin to look at it again.

**What to build:** after any successful edit, read `data.status` from the response rather than assuming it's unchanged. If it comes back `"pending"` when it was `"approved"` before the edit, tell the driver their vehicle needs to be re-verified — e.g. *"Your vehicle has been resubmitted for verification."* (the API's own `message` field already says this). This can also silently affect the driver's plan eligibility (a Prime/Middle driver's commercial+private rule) — if the app shows a category-grace banner (per `driver-network-flutter-integration.md`), refresh that screen's state after any vehicle edit, not just after adding/removing a vehicle.

### 4.3 Switching to commercial still needs the permit

Unchanged in spirit, but now also enforced on update, not just create:
```json
{ "success": false, "message": "A commercial permit document is required for a commercial vehicle", "code": "COMMERCIAL_PERMIT_REQUIRED", "details": { "required_document": "commercial_permit" } }
```
If the Edit Vehicle screen lets a driver flip Private → Commercial, make sure it also prompts for the permit document in that flow (the same slot Add Vehicle already shows for a commercial vehicle) — previously this switch had no such check on update.

### 4.4 The assigned driver's own record now stays in sync

If this vehicle is assigned to a fleet driver, editing the vehicle's make/model/plate/colour/type now automatically updates that driver's copied vehicle info too. **No app change needed** — but if the Fleet Drivers list screen was caching a driver's vehicle details separately from the vehicle list, make sure it refetches after a vehicle edit rather than relying on a stale local copy; the two are now guaranteed to match the vehicle's edited values without you needing to reconcile them yourself.

---

## 5. List: `assignedDriver.isOnRide` and `documents_summary`

```json
{
  "assignedDriver": { "id": "…", "name": "Ramesh", "phone": "…", "vehicleNumber": "…", "isOnRide": false, "zone": null },
  "documents_summary": [
    { "key": "rc", "uploaded": true, "previewUrl": "https://…" }
  ]
}
```
- **`assignedDriver.isOnRide`** — use this to disable the Delete and Edit actions in the vehicle list/detail UI *before* the driver even taps them, rather than only reacting to the `409` after the fact (both errors from §4.1 and §6 are still there as a backstop, but a disabled button is a better experience than a submit-then-fail).
- **`documents_summary`** — a lightweight per-document status list (key, uploaded, previewUrl only — never a raw base64 blob). Use this for a document-completeness indicator on the vehicle card instead of parsing the full `documents` map (which is still present for backward compatibility, but this is the intended source for a quick summary view).

---

## 6. Delete: clearer error, and it's a real (hard) delete

`DELETE /drivers/fleet/vehicles/:vehicleId`:
- A malformed id now returns a normal `400`, not a crash.
- The existing "can't delete an assigned vehicle" error now also carries structured details:
  ```json
  { "success": false, "message": "Vehicle is assigned to Ramesh. Assign Ramesh another vehicle or remove the driver first.", "code": "VEHICLE_ASSIGNED", "details": { "driver_id": "…", "driver_name": "Ramesh" } }
  ```
  Use `details.driver_name` if you want to build the message yourself instead of showing the server's `message` verbatim (e.g. for localization).
- Delete is a genuine hard delete (unchanged) — once removed, the vehicle is gone and its plate is immediately available for reuse by anyone, including the same owner re-adding a vehicle with that plate later.

---

## What did **not** change

- The create/update request payload shape — identical fields, same names.
- `PATCH` is still a **full replace**: send every field (`vehicleTypeId`, `make`, `model`, `number`, `color`), not just the ones that changed.
- Admin's own approval/rejection flow and the `usage_type_verified` auto-set-on-approval behavior for commercial vehicles with a permit already on file.
- Everything in `driver-network-flutter-integration.md` and `fleet-drivers-crud-flutter-guide.md` not mentioned above.

---

## Acceptance checklist

- [ ] Add Vehicle cannot be submitted without a vehicle type selected.
- [ ] Toggling Commercial/Private on Add Vehicle changes which documents are required (a commercial-only doc disappears for Private).
- [ ] Registering a plate already used by a *different* owner's vehicle shows a clear "already registered" message (not "already in your fleet").
- [ ] Edit a vehicle whose driver is currently on a trip — confirm a clear "on a trip" message, ideally with the Edit/Delete actions already disabled from the list.
- [ ] Edit only the colour on an approved vehicle — confirm it stays approved.
- [ ] Edit the plate on an approved vehicle — confirm the UI reflects it going back to "pending" and, if applicable, a grace/eligibility banner appears.
- [ ] Switch an existing vehicle from Private to Commercial — confirm the permit upload is prompted and required.
- [ ] After editing a vehicle assigned to a fleet driver, confirm that driver's own vehicle info (shown elsewhere in the app) reflects the edit without a manual workaround.
- [ ] Vehicle list shows `documents_summary`-based completeness and disables actions per `assignedDriver.isOnRide`.
- [ ] Delete a vehicle, then re-add a vehicle with the same plate — confirm it succeeds immediately.
