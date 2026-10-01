# GoKab Driver App — Fleet Vehicle Document Edit-Flow

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented (commit `cf02436`).
> **Scope:** `PATCH /drivers/fleet/vehicles/:vehicleId` (Edit Vehicle) and, to a lesser extent, `POST /drivers/fleet/vehicles` (Add Vehicle). Nothing else changes.

Adding a fleet vehicle already required a complete document (photo + number + expiry, per `vehicle-rc-document-flutter-guide.md`). **Editing** one didn't enforce any of that — this closes those gaps. There's also one new capability the app should start using: fixing a wrong number/expiry **without** re-uploading the photo.

---

## 1. Edit now enforces the same document rules as Add

`PATCH /drivers/fleet/vehicles/:vehicleId` now runs the exact same required-document checks `POST /drivers/fleet/vehicles` always has. Two error codes the app must already handle for Add now also appear on Edit:

| code | Meaning |
| --- | --- |
| `DOCUMENTS_REQUIRED` | A required document is missing entirely |
| `DOCUMENT_DETAILS_REQUIRED` | A required document's photo is there, but its number or expiry date isn't |

**This matters most when switching usage type** (private → commercial): a template that only applies to commercial vehicles (e.g. a commercial permit) can suddenly become required the moment the switch happens. If the app lets the driver flip usage type and save in one step, make sure the commercial-only document fields are shown and validated **before** that save — the server will now refuse the save otherwise, same as it already does for a brand-new commercial vehicle.

**Important: old vehicles are not retroactively blocked.** If a vehicle's RC (or any document) was saved before these rules existed and has no number/expiry, editing an *unrelated* field (colour, model, make) still succeeds — only documents the request actually touches get checked for completeness. The app doesn't need to force a re-upload just because the driver wants to fix the car's colour.

---

## 2. New capability: fix the number/expiry without touching the photo

Previously, sending `documents.rc.identifyNumber`/`expiryDate` with no photo was silently dropped — the server had nothing to attach it to. **That's fixed.** The app can now send a number/expiry-only correction:

```json
{
  "documents": {
    "rc": {
      "identifyNumber": "MP09AB1234",
      "expiryDate": "12 Mar 2031"
    }
  }
}
```

No `dataUrl`/`secureUrl`/`previewUrl` in that object — just the text fields. The server merges this into whatever photo is already on file; the photo itself is untouched.

**Build this as a real feature, not just an edge case:** add a "Fix number / expiry" action (or make the existing number/expiry fields on Edit Vehicle independently editable without forcing a new photo pick) for any document the vehicle already has. This is exactly for the case where a driver typed the RC number wrong, or renewed the RC with the same photo on file.

**Failure case to handle:** sending this for a document key the vehicle has **no existing entry for at all** returns `400 DOCUMENTS_REQUIRED` — there's nothing to attach a number to. In practice this shouldn't happen if the UI only offers this action on a document that's already uploaded, but handle the error the same way as any other `DOCUMENTS_REQUIRED` response if it does.

**Re-verification:** changing a document's number or expiry (with or without a new photo) is treated as a material change, exactly like changing the plate number or vehicle type. **If the vehicle was already `approved`, it goes back to `pending`** after this kind of edit. Show the same "this will need re-approval" warning the app presumably already shows for a plate/type change — reuse it here rather than building a separate one.

---

## 3. Admin can no longer approve an incomplete document

Not an app change, but relevant context: admin approval now also checks number/expiry, not just "is there a photo." If a vehicle somehow has an RC photo with no number (e.g. one added before these rules existed), admin's approve action gets refused with:

```json
{
  "success": false,
  "message": "Cannot approve — missing: RC (Registration Certificate) ID number, RC (Registration Certificate) expiry date",
  "code": "VEHICLE_DOCUMENT_DETAILS_REQUIRED",
  "details": { "missing": ["RC (Registration Certificate) ID number", "RC (Registration Certificate) expiry date"] }
}
```

If a driver asks "why is my vehicle still pending, I already added the photo," the answer may be this — point them at Edit Vehicle to use the new number/expiry-only fix from §2 instead of needing a brand-new photo.

---

## 4. New error code: `DOCUMENT_EXPIRED`

Both Add and Edit now validate the expiry date itself, not just whether one was entered. If the date can't be parsed, or is already in the past:

```json
{
  "success": false,
  "message": "rc expiry date is invalid or already in the past",
  "code": "DOCUMENT_EXPIRED",
  "details": { "key": "rc" }
}
```

Validate this client-side too (don't let the date picker accept a past date for an expiry field in the first place) so this is a true belt-and-braces check, not the first time the driver hears about it. `details.key` tells you which document key failed, for forms with more than one expiry-tracked document on screen at once.

Once a valid expiry is accepted, the server stamps a normalised `expiresAt` (ISO date) onto the document alongside the original `expiryDate` text — this is for a future expiry-reminder feature, nothing the app needs to read or send today.

---

## What did **not** change

- `POST /drivers/fleet/vehicles` (Add) — already had these checks; unchanged by this work.
- Every document other than the one(s) actually being edited — untouched, not re-validated.
- The response shape of a successful edit — same fields as before, `documents` just reflects whatever was actually changed.
- `fleet-vehicles-crud-flutter-guide.md` and `vehicle-rc-document-flutter-guide.md` — this is additive to both, not a replacement.

---

## Acceptance checklist

- [ ] Editing a vehicle's colour/model/make only, where its RC has no number/expiry, succeeds — no document prompt appears for an unrelated edit.
- [ ] Re-uploading a document's photo without filling in its number/expiry on Edit shows the same `DOCUMENT_DETAILS_REQUIRED` inline error Add already shows.
- [ ] Switching usage type to commercial on Edit, without the commercial-only document(s), is refused with `DOCUMENTS_REQUIRED` before save — not discovered only after.
- [ ] A "fix number/expiry" path exists on Edit Vehicle for any document that already has a photo, sending just `identifyNumber`/`expiryDate` with no photo fields.
- [ ] Using that path on an **approved** vehicle shows the re-approval warning and the vehicle shows as `pending` afterward.
- [ ] Entering a past expiry date is blocked in the date picker itself, and the app also handles a `DOCUMENT_EXPIRED` response gracefully if one ever arrives.
