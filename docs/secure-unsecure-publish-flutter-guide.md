# GoKab Driver App — Secure / Unsecure Publish

> **Audience:** Flutter developer (driver app).
> **Status:** written against the backend as implemented. Smoke-tested by `Backend/scripts/smoke_secure_unsecure.mjs` (49 checks).
> **App work needed:** a toggle on the Publish sheet, an insufficient-wallet choice, a badge on feed/network cards, and a Report button.

## 1. What the toggle means

| | Secure (default) | Unsecure |
|---|---|---|
| Publisher wallet check at publish | yes — must have `driver_payout` available | none |
| Escrow hold at accept | publisher freezes payout, acceptor freezes commission | none |
| Payment method | as booked | **forced to cash** |
| Split (`owner_commission + driver_payout = total_fare`) | required | still required (it's the agreement both drivers see) |
| Settlement at completion | through wallets (`collected_by`) | none — drivers settle offline |
| If something goes wrong | escrow dispute | **Report** (support ticket, no money moves) |

## 2. Publish

`POST /drivers/network/rides/:rideId/publish`

```json
{ "total_fare": 5000, "owner_commission": 2000, "driver_payout": 3000, "is_secure": false }
```

- `is_secure` is optional; omitted = `true`. `isSecure` (camelCase) is also accepted.
- Response `data.is_secure` echoes the stored value.

### Insufficient wallet → offer the choice

A secure publish the publisher can't fund returns:

```json
{ "success": false, "code": "INSUFFICIENT_WALLET_FOR_PUBLISH", "details": { "required": 3000, "available": 100 } }
```

Show a sheet: **Top up ₹(required − available)** or **Publish as Unsecure**. "Publish as Unsecure" = repeat the same call with `"is_secure": false`. Mention on the sheet that unsecure rides are cash only and not protected by escrow.

## 3. New fields in payloads

**Feed item** (`GET /drivers/feed?tab=driver`), socket `feed:driver:new`:

| Field | Type | Notes |
|---|---|---|
| `is_secure` | bool / null | `null` on customer leads (escrow doesn't apply) |
| `payment_method` | string | always `cash` for unsecure |
| `accept.hold_required` | number | `0` for unsecure leads |

**Network ride** (`GET /drivers/network/rides`, assign/create responses): `publish.is_secure` (bool).

**Accept response** (`POST /drivers/feed/rides/:id/accept`): `{ accepted, rideId, escrow: "held" | "none", is_secure }`. Socket `network:ride:taken` to the publisher now carries `is_secure` and `held: 0` for unsecure.

Suggested UI: an "Unsecure · Cash" badge on the card and a one-line note "Settle ₹{driver_payout}/₹{owner_commission} with the other driver directly".

## 4. Completing an unsecure ride

- Do **not** ask "who collected the fare" — that prompt is only for `escrow.state == held`. Complete normally.
- Completing with `paymentMethod: "online"` returns `422 UNSECURE_RIDE_CASH_ONLY`. Don't show online/UPI-to-platform options for these rides.
- No wallet change happens for either driver. Ride earnings for the acceptor = `driver_payout`.

Fleet / self-assigned driver-created rides (no publish) also complete with **no platform commission** now; earnings = full fare.

## 5. Report (unsecure rides only)

`POST /drivers/network/rides/:rideId/report`

```json
{ "reason": "Publisher did not pay my share" }
```

`201` → `{ reported: true, rideId, ticketCode, money_moved: false }`

| Code | When |
|---|---|
| `NOT_UNSECURE_RIDE` (409) | ride is secure (use escrow dispute) or was never accepted |
| `NOT_RIDE_PARTY` (403) | caller is neither publisher nor acceptor |
| `REASON_REQUIRED` (422) | empty reason |
| `ALREADY_REPORTED` (409) | this driver already reported this ride (one each) |

Show the button on accepted/completed unsecure rides for both the publisher and the acceptor. After success, show the ticket code and that support will follow up — nothing is refunded automatically.

## Acceptance checklist

- [ ] Publish sheet has a Secure/Unsecure toggle (default Secure).
- [ ] `INSUFFICIENT_WALLET_FOR_PUBLISH` offers Top-up or Publish as Unsecure.
- [ ] Feed and My Rides show the unsecure badge; accept works with an empty wallet.
- [ ] Unsecure completion skips the "who collected" prompt and offers cash only.
- [ ] Report button files a ticket and shows the code.
