# GoKab Driver App — Earnings Split (Rides vs Commission)

> **Audience:** Flutter developer (driver app).
> **Status:** written against the backend as implemented. Smoke-tested by `Backend/scripts/smoke_earnings_split.mjs` (30 checks).
> **App work needed:** an earnings screen with two totals and a daily chart, plus a commission list.

## 1. Two kinds of earnings

| Kind | What it is | Amount per ride |
|---|---|---|
| **Ride earnings** | trips the driver drove | platform ride: `driverEarnings`; ride taken from the feed: the agreed `driver_payout`; own/fleet driver-created ride: the full fare (no platform commission) |
| **Commission earnings** | rides the driver *published* that another driver completed | `owner_commission − platform_cut` |

Both come from completed rides, so unsecure (offline-settled) rides are included even though they never touch the wallet.

## 2. Ranges (shared by both endpoints)

| `range` | Window (IST days) |
|---|---|
| `today` | today |
| `week` (default) | last 7 days incl. today |
| `month` | last 30 days incl. today |
| `custom` | `from` + `to`, max 366 days. Bare dates (`2026-10-01`) are IST calendar days and `to` is inclusive; full ISO timestamps are used as-is (`to` exclusive) |

Errors: `422 INVALID_RANGE` (unknown range), `422 INVALID_DATE_RANGE` (bad/missing/backwards dates).

## 3. `GET /drivers/earnings/summary?range=week`

```json
{
  "range": "week",
  "from": "2026-10-09T18:30:00.000Z",
  "to": "2026-10-16T18:30:00.000Z",
  "ride_earnings": 6000,
  "commission_earnings": 3800,
  "total_earnings": 9800,
  "rides": 2,
  "commission_rides": 2,
  "daily": [
    { "date": "2026-10-10", "ride_earnings": 0, "commission_earnings": 0, "rides": 0, "commission_rides": 0 },
    { "date": "2026-10-16", "ride_earnings": 6000, "commission_earnings": 3800, "rides": 2, "commission_rides": 2 }
  ]
}
```

`daily` always has one entry per day in the window (zeros included), oldest first — chart it directly as a stacked bar (rides / commission).

## 4. `GET /drivers/earnings/commissions?range=month&page=1&limit=20`

```json
{
  "totals": { "owner_commission": 4000, "platform_cut": 200, "net_earned": 3800, "rides": 2 },
  "results": [
    {
      "ride_id": "…",
      "date": "2026-10-16T09:12:00.000Z",
      "pickup": "Vijay Nagar, Indore",
      "drop": "MP Nagar, Bhopal",
      "total_fare": 5000,
      "driver_payout": 3000,
      "owner_commission": 2000,
      "platform_cut": 200,
      "net_earned": 1800,
      "acceptor": { "id": "…", "name": "Vikas Singh", "phone": "9000000003" },
      "is_secure": true,
      "settlement": "escrow",
      "settlement_label": "Settled via wallet",
      "escrow_state": "settled",
      "collected_by": "platform"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 }
}
```

- Newest first. `totals` cover the whole range, not just the page.
- `platform_cut` is non-zero only when a secure ride was paid online (the platform withholds its % from the commission).
- **Unsecure rows:** `is_secure: false`, `settlement: "offline"`, `settlement_label: "Settled offline"`, `platform_cut: 0`. Show the label — the money was exchanged between the drivers, not via the wallet.
- `escrow_state: "disputed"` → show a "Under review" chip.

## 5. Wallet history (optional)

Escrow wallet rows now carry `metadata.kind`: `owner_commission`, `driver_payout`, `cancel_penalty`, `owner_commission_reversal`, `driver_payout_reversal`. Use it to label wallet history lines; don't compute earnings from the wallet.

## Acceptance checklist

- [ ] Earnings screen shows Ride and Commission totals with a range picker (Today / Week / Month / Custom).
- [ ] Daily stacked chart from `daily`.
- [ ] Commission list shows the split, acceptor, platform cut and "Settled offline" for unsecure rows.
