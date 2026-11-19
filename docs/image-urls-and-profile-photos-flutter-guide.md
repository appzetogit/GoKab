# GoKab Images: What Was Fixed and How the App Should Load Them (Flutter Guide)

> **Audience:** Flutter developer (driver app; the rider app is affected the same way).
> **Status:** fixed and **verified live on `gokab.in` on 19 Oct 2026** (`master` @ `f759355`).
> **Answers:** the "Image Issues: Driver App vs Backend" report (Issue 1 and Issue 2).
> **App change needed:** none to make images load. Read §5 for small recommended improvements.

---

## Contents

1. [Summary](#1-summary)
2. [Issue 1: `/images/...` returned HTML](#2-issue-1-images-returned-html)
3. [Issue 2: profile photo stored as base64](#3-issue-2-profile-photo-stored-as-base64)
4. [Sample responses](#4-sample-responses)
5. [What the app should do](#5-what-the-app-should-do)
6. [Uploading photos: rules and errors](#6-uploading-photos-rules-and-errors)
7. [QA checklist](#7-qa-checklist)

---

## 1. Summary

| Problem | Root cause | Fix | Status |
|---|---|---|---|
| Every `https://gokab.in/images/...` URL returned the website's `index.html` | nginx on `gokab.in` sends only `/api/*` to the backend; every other path (including `/images`) gets the website | Images are now served at **`https://gokab.in/api/images/...`**; all stored URLs were rewritten | ✅ live |
| Vehicle-type images returned 404 | the files had never been copied to this server's storage | files copied | ✅ live |
| Vehicle-type images were ~6 MB each (8–16 s to load) | 2816×1536 PNG data saved with a `.webp` name | re-encoded to real WebP, 800×436, ~20 KB each | ✅ live |
| `profileImage` in `/drivers/me` was a `data:image/jpeg;base64,…` string | `PATCH /drivers/me` saved whatever string the app sent | the image is now saved as a file and only its URL is stored | ✅ live |
| Rudra's photo didn't decode on Android | stored as base64 (see above) | converted to a hosted WebP | ✅ live |

**Final answer to the report's questions:**
1. **Issue 1:** neither (a) nor (b) as written. Option (b) was right in spirit, but the server is **nginx, not Vercel**, and nginx already forwards `/api/*` to the backend. So the backend now serves uploads at `/api/images/...`, with no nginx change needed. A test URL returns `200 image/webp` (§2.3).
2. **Issue 2:** fixed by switching to URLs; the base64 was not repaired. Sample response in §4.

---

## 2. Issue 1: `/images/...` returned HTML

### 2.1 What we found

```
GET https://gokab.in/images/drivers/2026/10/12f9c213-….webp
→ 200  text/html  2354 bytes     ← the website's index.html, even for a file that doesn't exist

GET https://gokab.in/api/v1/vehicle-types/active
→ 200  application/json          ← /api reaches the backend (X-Powered-By: Express)
```

- `gokab.in` is served by **nginx 1.24** on the VPS. `frontend/vercel.json` is not used in production.
- nginx forwards `/api/*` to the backend (pm2, port 5000) and answers every other path with the SPA's `index.html`.
- The backend's `app.use('/images', express.static(...))` was never reached.

### 2.2 The fix

| Change | Detail |
|---|---|
| Backend serves uploads at **`/api/images/`** | same files, same folder (`/var/storage`); the old `/images` route still exists in the backend but nginx never reaches it |
| New uploads get `/api/images/` URLs | `getPublicUrl()` in `Backend/src/utils/storage.util.js` |
| Stored URLs rewritten | `scripts/migrate_image_urls_to_api_path.mjs`: **258 URLs in 30 documents** |
| Vehicle-type image files restored and shrunk | 6 files, now ~20 KB each |

URLs rewritten, by collection:

| Collection | Documents | URLs |
|---|---|---|
| `taxidrivers` (photos, banners, documents) | 12 | 222 |
| `taxiusers` (rider photos) | 8 | 16 |
| `taxifleetvehicles` (vehicle documents) | 2 | 12 |
| `taxivehicles` (vehicle-type images) | 6 | 6 |
| `taxiadvertisements` | 1 | 1 |
| `taxidriverregistrationsessions` | 1 | 1 |

### 2.3 Verified live

```
https://gokab.in/api/images/drivers/2026/10/12f9c213-72ac-4beb-b466-c0272475519d.webp → 200 image/webp  14472 B
https://gokab.in/api/images/users/2026/09/9b9dba4d-97da-4876-9d20-ecfe1aaabf92.webp    → 200 image/webp   1472 B
https://gokab.in/api/images/vehicles/images/2026/07/gokab-auto.webp                    → 200 image/webp  18750 B  0.19 s
https://gokab.in/api/images/vehicles/images/2026/07/gokab-mini.webp                    → 200 image/webp  19696 B  0.17 s
https://gokab.in/api/images/vehicles/images/2026/07/gokab-sedan.webp                   → 200 image/webp  20150 B  0.21 s
https://gokab.in/api/images/vehicles/images/2026/07/gokab-suv.webp                     → 200 image/webp  20562 B  0.18 s
https://gokab.in/api/images/vehicles/images/2026/07/gokab-xl.webp                      → 200 image/webp  20200 B  0.15 s
https://gokab.in/api/images/vehicles/images/2026/07/gokab-premium.webp                 → 200 image/webp  21888 B  0.18 s
```

Check one yourself:

```bash
curl -sI https://gokab.in/api/images/vehicles/images/2026/07/gokab-premium.webp
```

It must show `content-type: image/webp`.

> **`https://gokab.in/images/...` (without `/api`) still returns HTML.** No stored URL uses it any more. If you ever see one, report it with the endpoint that returned it.

---

## 3. Issue 2: profile photo stored as base64

### 3.1 Root cause

- `PATCH /drivers/me` saved `req.body.profileImage` as-is. A base64 data URL went straight into Mongo, so every `GET /drivers/me` carried the whole photo.
- Rider signup, `PATCH /users/me`, and the admin "create driver" and "create/edit user" forms did the same.
- **Rudra (`6aa5c3995b081b792ba554eb`):** his stored JPEG was **complete**, not truncated (81,684 bytes, valid start and end markers, and the server decodes it fully). Android's decoder rejected that particular JPEG, but the backend wasn't cutting anything off; the 10 MB body limit was never the problem. Either way, he now has a hosted WebP.

### 3.2 The fix

Every profile-photo write now stores **a URL, never base64**:

| Endpoint | Data URL sent | URL sent | `""` |
|---|---|---|---|
| `PATCH /drivers/me` → `profileImage` | hosted, URL stored | kept **only if hosted by gokab.in** | clears |
| `PATCH /drivers/me` → `bannerImage` | hosted | kept only if it's the current one | clears |
| `PATCH /drivers/onboarding/personal` → `profileImage`, `bannerImage` | hosted | kept only if it's the current one | clears |
| `PATCH /users/me` → `profileImage` (rider) | hosted | kept as-is | clears |
| `POST /users/signup` → `profileImage` (rider) | hosted (after OTP session check) | kept as-is | — (required) |
| Admin forms | hosted | kept as-is | — |

Photos already stored as base64 were converted on the server with `scripts/migrate_profile_images_to_urls.mjs`.

---

## 4. Sample responses

### `GET /api/v1/drivers/me` (Rudra, live)

```json
{
  "success": true,
  "data": {
    "id": "6aa5c3995b081b792ba554eb",
    "name": "Rudra",
    "profileImage": "https://gokab.in/api/images/drivers/2026/10/c62b6755-1da6-42e1-bdf1-f93528aee372.webp",
    "bannerImage": "",
    "…": "…"
  }
}
```

His photo is now **17 KB** (it was 109,000 characters of base64 inside every profile response).

### `GET /api/v1/vehicle-types/active`

```json
[
  { "name": "GoKab Premium", "image": "https://gokab.in/api/images/vehicles/images/2026/07/gokab-premium.webp", "capacity": 4, "category": "PREMIUM" }
]
```

### `PATCH /api/v1/drivers/me` with a new photo

Request:

```json
{ "profileImage": "data:image/jpeg;base64,/9j/4AAQ…" }
```

Response: the full profile, with:

```json
"profileImage": "https://gokab.in/api/images/drivers/2026/10/<uuid>.webp"
```

---

## 5. What the app should do

**Required: nothing.** The app already loads http(s) URLs, and every image URL the API returns now works.

**Recommended:**

1. **Never build image URLs in the app.** Always use the exact URL from the API. The path is now `/api/images/...`; don't hard-code either `/images` or `/api/images`.
2. **Use a cached network image** for photos, vehicle types and documents, e.g. `cached_network_image`:
   ```dart
   CachedNetworkImage(
     imageUrl: driver.profileImage,
     placeholder: (_, __) => const CircleAvatar(child: Icon(Icons.person)),
     errorWidget: (_, __, ___) => CircleAvatar(child: Text(driver.initials)),
   )
   ```
3. **Keep a fallback for any leftover `data:` value.** All known ones were converted, but don't crash if one appears:
   ```dart
   Widget avatar(String src, String initials) {
     if (src.isEmpty) return CircleAvatar(child: Text(initials));
     if (src.startsWith('data:')) {
       try {
         final bytes = base64Decode(src.substring(src.indexOf(',') + 1));
         return CircleAvatar(
           backgroundImage: MemoryImage(bytes),
           onBackgroundImageError: (_, __) {},
         );
       } catch (_) {
         return CircleAvatar(child: Text(initials));
       }
     }
     return CircleAvatar(
       backgroundImage: CachedNetworkImageProvider(src),
       onBackgroundImageError: (_, __) {},
     );
   }
   ```
4. **Treat a non-image response as a broken image, not a crash.** If a URL ever returns `text/html`, show the placeholder.
5. **Cache:** vehicle-type and photo URLs changed (`/images` → `/api/images`), so old cached copies won't be reused. No cache clearing is needed.

---

## 6. Uploading photos: rules and errors

Send photos as a **data URL** (`data:image/jpeg;base64,…`). Accepted: JPEG, PNG, WebP, **max 5 MB**. The server re-encodes to WebP:
- profile photos are cropped to 500×500;
- banners keep their aspect ratio, up to 1600 px wide.

Compress before sending:

```dart
final picked = await ImagePicker().pickImage(
  source: ImageSource.gallery,
  maxWidth: 1024,
  imageQuality: 80,
);
final bytes = await picked!.readAsBytes();
final dataUrl = 'data:image/jpeg;base64,${base64Encode(bytes)}';
await api.patch('/drivers/me', data: {'profileImage': dataUrl});
```

| HTTP | `code` | Meaning | Show |
|---|---|---|---|
| 422 | `INVALID_PROFILE_IMAGE` | not JPEG/PNG/WebP, unreadable or truncated image, or (driver) a URL not hosted by gokab.in | "Couldn't use this photo. Please pick another one." The previous photo stays |
| 400 | `IMAGE_TOO_LARGE` | over 5 MB (`details.max_bytes`) | "Photo must be under 5 MB." Compress and retry |
| 422 | `INVALID_BANNER` | same as above, for `bannerImage` | same message |

To keep the current photo while saving other fields, either omit `profileImage` or send back the URL you got from the API.

---

## 7. QA checklist

| # | Check | Expected |
|---|---|---|
| 1 | Rudra (`9876543210`) opens Profile | photo shows; no `ImageDecoder` error |
| 2 | Any driver: change photo from gallery | `GET /drivers/me` → `profileImage` starts with `https://gokab.in/api/images/drivers/` and it shows |
| 3 | Vehicle selection screen | all 6 vehicle images show within about a second |
| 4 | My Documents / fleet vehicle documents | uploaded document photos show |
| 5 | Rider app: change profile photo | photo shows; `profileImage` is an `/api/images/users/` URL |
| 6 | Pick a non-image file, or a broken image, as the photo | `INVALID_PROFILE_IMAGE` message; the old photo stays |
| 7 | Open any image URL from the API in a browser | the image shows (not the website) |

Backend smoke tests (run by backend): `smoke_image_url_path.mjs`, `smoke_profile_image_urls.mjs`.
Related guide: `driver-app-backend-gaps-flutter-guide.md` (P1–P7, payments).
