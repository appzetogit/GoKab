# GoKab Driver App — Profile Banner, Publisher Card & Org Name

> **Audience:** Flutter developer (driver app).
> **Status:** written against the backend as implemented. Smoke-tested by `Backend/scripts/smoke_banner_publisher.mjs` (28 checks).
> **App work needed:** a banner picker (registration + edit profile), and showing the publisher card on feed / ride screens.

## 1. Profile banner

A wide header image on the driver's public card. **The server keeps the aspect ratio you upload** — no crop. It re-encodes to WebP and caps the width at 1600px (smaller images are not upscaled). Max 5 MB; JPEG, PNG or WebP only.

### Set / change — `PATCH /drivers/me`

```json
{ "bannerImage": "data:image/jpeg;base64,/9j/4AAQ..." }
```

`banner_image` is accepted as an alias. The response is the full `GET /drivers/me` payload, now including `bannerImage` (a hosted URL, or `""`).

| Send | Result |
|---|---|
| image data URL | uploaded, URL stored |
| the URL you got from `GET /me` | unchanged (safe to send the whole form back) |
| `""` | banner removed |
| field omitted | unchanged |
| any other URL, a GIF, a video, or corrupt bytes | `422 INVALID_BANNER` |
| > 5 MB | `400 IMAGE_TOO_LARGE` |

Crop/zoom in the app is optional — whatever shape you send is what everyone sees.

### At registration — `PATCH /drivers/onboarding/personal`

Add optional `bannerImage` (data URL) to the personal step. It's uploaded immediately; the response's `personal.bannerImage` is the hosted URL. Re-saving the step without the field keeps it. On completion it becomes the driver's `bannerImage`. (Owners: ignored.)

## 2. Publisher card

Wherever a driver-created ride is shown to another driver, the creator now comes with images:

```json
"publisher": {
  "id": "…",
  "name": "Ramesh Verma",
  "org_name": "Ram Travels",
  "category": "prime",
  "rating": 4.8,
  "profile_image": "https://…/drivers/….webp",
  "banner_image": "https://…/banners/….webp"
}
```

| Endpoint | Where |
|---|---|
| `GET /drivers/feed?tab=driver` | `results[].publisher` (now with `profile_image`, `banner_image`) |
| `GET /drivers/network/rides` | `results[].publisher` (new) |
| `GET /drivers/rides/upcoming` | `results[].publisher` (network rows; `null` for app bookings) |
| `GET /rides/:rideId` | `data.publisher` and `data.is_secure` (driver-created rides only; other rides unchanged) |

Either image can be `""` — fall back to initials / a default header. Render the banner with `BoxFit.cover` in a fixed-height header; it isn't pre-cropped.

## 3. Organisation name

`PATCH /drivers/organization` now accepts `{ "name": "Ram Tours" }` (previously only `company_name` / `companyName` worked, and `name` was silently ignored while still returning 200). Response: `{ id, company_name, name, owner_name }`. A blank name returns `422 INVALID_ORG_NAME`. The new name shows as `publisher.org_name` immediately.

## Acceptance checklist

- [ ] Registration personal step and Edit Profile both have a banner picker.
- [ ] Feed cards / ride detail show the publisher's photo and banner with fallbacks.
- [ ] Renaming the organisation with `{ name }` updates everywhere.
