# GoKab Driver App — Vehicle RC (Registration Certificate) Update

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented (commit `85b3a6b`), not against the original spec.
> **Scope:** the RC upload step in **driver registration** (the onboarding vehicle) and in **Add/Edit Vehicle** on the fleet screens. Nothing else changes.

Until now, RC was just a bare photo upload — no plate/RC number, no expiry date, and nothing validated it. That's fixed: RC is now a proper document with a photo, a number, and an expiry date, wherever a vehicle gets added.

**Current server state: this is NOT yet mandatory.** The backend team seeded the RC template with `is_required: false` on purpose, specifically so existing app builds keep working while this guide gets implemented. Once the app ships this, they'll flip it to required from the admin panel — after that, every registration and every fleet vehicle add will need a full RC (photo + number + expiry) to succeed. Build this now; there's no separate "phase 2" needed later.

---

## 1. Fetch the RC requirement like any other document template — don't hardcode it

RC now shows up in the same dynamic document-template lists the app already fetches:

- **Registration (driver's own vehicle):** whatever endpoint the vehicle-documents step already calls (the generic driver document template list).
- **Fleet Add/Edit Vehicle:** `GET /drivers/document-templates?role=fleet`

Look for an entry with `key: "rc"` (or check `slug: "registration-certificate"`). Its shape:
```json
{
  "name": "RC (Registration Certificate)",
  "slug": "registration-certificate",
  "applies_to": "vehicle",
  "account_type": "both",
  "image_type": "image",
  "has_identify_number": true,
  "identify_number_key": "rc_number",
  "has_expiry_date": true,
  "is_required": false,
  "fields": [{ "key": "rc", "label": "RC (Registration Certificate)", "required": false }]
}
```

**Don't hardcode `is_required: false` into the app.** Read it from the template every time the form loads — the backend team will flip this to `true` once your build is out, and the app needs to start enforcing it the moment that happens, with no new release required. The same goes for `has_identify_number`/`has_expiry_date`: use them to decide whether to show the number/expiry inputs at all, rather than assuming RC always has them.

---

## 2. What to build: photo + number + expiry, as one unit

Wherever the app currently has a bare RC photo upload, add two more inputs right below it:
- **RC number** (text input)
- **RC expiry date** (date picker)

This applies to both places:
- Registration → vehicle documents step
- Fleet → Add Vehicle / Edit Vehicle

**Sending it:** the `documents` map's `"rc"` entry becomes an object instead of a bare string/data-URL:
```json
{
  "documents": {
    "rc": {
      "dataUrl": "data:image/jpeg;base64,...",
      "identifyNumber": "MP09AB1234",
      "expiryDate": "2030-06-15"
    }
  }
}
```
This is the exact same shape every other numbered/dated document in the app already uses (Driving Licence, Aadhaar, Commercial Permit, etc.) — if the app has a shared "document with number + expiry" upload widget, reuse it for RC rather than building a new one.

`expiryDate` can be any reasonable date string the backend already accepts elsewhere in the app (it's stored and read back as-is) — match whatever format your other expiry-date fields already send.

---

## 3. New validation error to handle: `DOCUMENT_DETAILS_REQUIRED`

Two distinct failure cases now exist, and they need different messages:

| code | Meaning | Example message |
| --- | --- | --- |
| `DOCUMENTS_REQUIRED` | The RC document itself (photo) is missing entirely | "Missing required documents: rc" |
| `DOCUMENT_DETAILS_REQUIRED` (new) | The RC photo was uploaded, but the number or expiry date wasn't filled in | "Missing required document details: RC (Registration Certificate) expiry date" |

```json
{ "success": false, "message": "Missing required document details: RC (Registration Certificate) expiry date", "code": "DOCUMENT_DETAILS_REQUIRED", "details": { "missing": ["RC (Registration Certificate) expiry date"] } }
```

Handle `DOCUMENT_DETAILS_REQUIRED` the same way as `DOCUMENTS_REQUIRED` — inline error pointing at the RC number/expiry fields specifically, using `details.missing` to know which one(s). This applies to both registration completion and fleet vehicle add.

Note: this only fires once RC becomes `is_required: true` on the server — while it's still optional (see the note above), uploading an RC photo with no number/expiry is currently accepted without error. Build the number/expiry inputs as if they're always required anyway, so the app doesn't need another release when the backend flips the flag.

---

## 4. Where the number/expiry end up (for anything that reads them back)

If any screen shows the driver their own vehicle's RC details back (e.g. a "My Vehicle" summary), read them from the document object the same way you'd read any other numbered document:
```json
"documents": {
  "rc": {
    "uploaded": true,
    "previewUrl": "https://...",
    "identifyNumber": "MP09AB1234",
    "expiryDate": "2030-06-15",
    "status": "pending"
  }
}
```
(Also available under the snake_case aliases `identify_number` / `expiry_date` if that's what the app's existing document-reading code expects — both are always present.)

For a **fleet vehicle**, the RC also shows up in the vehicle list's `documents_summary` (per `fleet-vehicles-crud-flutter-guide.md` §5) as `{ key: "rc", uploaded, previewUrl }` — that summary doesn't carry the number/expiry, only completeness; read the full `documents.rc` object if you need those.

---

## 5. Admin panel — no app change needed here, just context

The admin panel already shows RC's number and expiry date automatically once uploaded (it's a generic column on every document, not something built specifically for RC) — nothing to build or verify on the admin side from the app's perspective. Just know that whatever number/expiry the driver enters is exactly what admin will see when reviewing/approving the vehicle.

---

## What did **not** change

- Every other document (Driving Licence, Aadhaar, PAN, Commercial Permit, etc.) — untouched.
- The overall Add Vehicle / registration flow, endpoints, and every other field — unchanged.
- `fleet-vehicles-crud-flutter-guide.md` and `fleet-drivers-crud-flutter-guide.md` — this is additive to those, not a replacement.

---

## Acceptance checklist

- [ ] RC upload step (registration and fleet Add/Edit Vehicle) shows number + expiry inputs alongside the photo, driven by the template's `has_identify_number`/`has_expiry_date` flags, not hardcoded.
- [ ] Submitting RC with a photo but no number, or no expiry, shows a clear inline error naming which one is missing (`DOCUMENT_DETAILS_REQUIRED`).
- [ ] Submitting with all three (photo + number + expiry) succeeds.
- [ ] Any screen that reads back a vehicle's RC shows the number and expiry, not just the photo.
- [ ] Confirm with the backend team when they plan to flip RC to `is_required: true`, and re-test the full registration and Add Vehicle flows right before/after that happens — this is the point where any driver who hasn't been asked for RC number/expiry yet will start being blocked.
