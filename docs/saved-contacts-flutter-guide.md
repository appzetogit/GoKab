# GoKab Driver App — Saved Contacts

> **Audience:** Flutter developer (driver app).
> **Status:** written against the backend as implemented. Smoke-tested by `Backend/scripts/smoke_saved_contacts.mjs` (48 checks).
> **App work needed:** a Contacts screen (Worked-with + Saved), a "Save contact" action, and contacts as a target in the Assign sheet.

## 1. Who can use it

New tier permission `can_use_contacts` in `GET /drivers/category` → `permissions.can_use_contacts`.

| Tier | Default |
|---|---|
| Prime / Middle (Elite / Pro) | on |
| Lower (Basic) | **locked** |

Admins can override it per plan (`can_use_contacts` on the subscription tier). When locked, the lists still load (with `locked: true`) so nothing is lost on a downgrade — show them greyed out with an upgrade prompt. Adding and assigning are refused while locked; deleting is always allowed.

## 2. Worked with — `GET /drivers/contacts/worked-with?page=1&limit=20`

Everyone you've shared a ride with (one of you created it, the other drove it), most recent first.

```json
{
  "locked": false,
  "results": [
    {
      "driver": { "id": "…", "name": "Mohan Lal", "phone": "9000000004", "profile_image": "", "vehicle_number": "MP09…", "vehicle_type": "car", "rating": 4.6, "category": "lower", "active": true },
      "rides_together": 3,
      "they_drove_for_me": 2,
      "i_drove_for_them": 1,
      "last_ride_at": "2026-10-16T09:12:00.000Z",
      "last_ride_id": "…",
      "is_saved": false,
      "contact_id": null
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Show a **Save** button when `is_saved` is false.

## 3. Saved contacts

### List — `GET /drivers/contacts`

`{ locked, results: [{ id, nickname, source_ride_id, driver: {…same card…}, createdAt }], pagination }`

### Save — `POST /drivers/contacts`

```json
{ "driver_id": "…", "nickname": "Mohan bhai", "source_ride_id": "…optional…" }
```

- `201` new, `200` already saved (nickname updated if sent). Response: `{ created, contact }`.
- Errors: `403 CONTACTS_LOCKED`, `403 NO_SHARED_RIDE` (never shared a ride, or `source_ride_id` isn't one you shared), `422 INVALID_CONTACT` (yourself), `404 DRIVER_NOT_FOUND`, `400 INVALID_ID`.

### Remove — `DELETE /drivers/contacts/:contactId`

`{ deleted: true, id }`; `404 CONTACT_NOT_FOUND`.

## 4. Assigning a ride to a contact

Same endpoint as fleet assign — `POST /drivers/network/rides/:rideId/assign` (and `/reassign`, and `assign_to_driver_id` on ride creation). A contact is outside your organisation, so the body carries a **split**, exactly like publishing:

```json
{ "driverId": "<contact driver id>", "driver_payout": 3000, "owner_commission": 2000, "is_secure": true }
```

- `driver_payout` is **required** for a contact (`422 SPLIT_REQUIRED`). `owner_commission` defaults to `fare − driver_payout`; `total_fare` defaults to the ride fare. They must add up (`422 INVALID_SPLIT`).
- **Secure** (default): both sides are held in escrow (you freeze the payout, the contact freezes the commission) and settled at completion with `collected_by`, same as a published ride.
- **Unsecure** (`is_secure: false`): no holds, cash only, settled offline; Report works like for unsecure published rides.
- Fleet members and yourself: unchanged — no split, no escrow.

| Error | Meaning | Suggested UI |
|---|---|---|
| `402 INSUFFICIENT_WALLET_FOR_PUBLISH` `{required, available}` | you can't fund the payout | Top-up or Assign as Unsecure |
| `402 CONTACT_INSUFFICIENT_WALLET` | the contact can't fund their side (their balance is not shown) | Assign as Unsecure |
| `403 DRIVER_NOT_IN_FLEET` | you have fleet rights, but the driver is neither in your fleet nor a saved contact | — |
| `403 CATEGORY_NOT_ALLOWED` | your plan has no fleet rights and the driver isn't a saved contact (or the plan allows neither) | upgrade |

Response is the usual network ride with `assignment.target_type` (`self` / `fleet` / `contact`), `publish` split, `is_secure`, and `escrow.state`.

### Contact's side

The contact sees it in `GET /drivers/rides/upcoming` (`amount_for_you` = payout, `assigned_by` = you) and can **Confirm** (`/acknowledge`) or **Decline** (`/reject-assignment`). Declining returns both escrow holds; no penalty.

### Undoing

`/unassign` and `/reassign` now work on a secure contact assignment (holds are returned). For a ride a driver **took from the feed**, unassign is still refused — and if that driver declines it with `/reject-assignment`, the escrow is released (with the admin's cancellation penalty, same as cancelling) and the ride comes off the feed so you can publish or assign it again.

## Acceptance checklist

- [ ] Contacts screen with Worked-with and Saved tabs; locked state with upgrade CTA.
- [ ] Save / remove / nickname.
- [ ] Assign sheet lists fleet + contacts; picking a contact asks for the split and Secure/Unsecure.
- [ ] Handles `INSUFFICIENT_WALLET_FOR_PUBLISH` and `CONTACT_INSUFFICIENT_WALLET`.
