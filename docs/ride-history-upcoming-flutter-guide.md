# GoKab Driver App — Ride History Filters & Upcoming Rides

> **Audience:** Flutter developer (driver app).
> **Status:** written against the backend as implemented. Smoke-tested by `Backend/scripts/smoke_history_upcoming.mjs` (34 checks); `smoke_backend_spec_v2.mjs` still passes.
> **App work needed:** History tabs/filters, and an Upcoming list.

## 1. History filters — `GET /rides`

New optional query params (work together with the existing `page`, `limit`, `category`, `from`, `to`):

| Param | Values | Default | Meaning |
|---|---|---|---|
| `status` | `completed`, `cancelled`, `all` | `all` | ride outcome |
| `role` (driver only) | `driven`, `published`, `all` | `driven` | which side of the ride I was on |

- `driven` — rides I drove (this is what the endpoint always returned; unchanged when `role` is omitted).
- `published` — rides I created that someone else drove: taken from the feed, assigned to a fleet driver, or cancelled before anyone drove them.
- `all` — both.

Errors: `422 INVALID_STATUS`, `422 INVALID_ROLE`.

Examples:

```
GET /rides?status=completed&role=published
GET /rides?status=cancelled
GET /rides?role=all&from=2026-10-01T00:00:00Z&to=2026-10-17T00:00:00Z
```

### New fields on each row (driver tokens only)

| Field | Type | Notes |
|---|---|---|
| `ride_role` | `driven` / `published` | |
| `origin` | `customer_app` / `driver_created` | |
| `is_secure` | bool / null | `null` for app bookings |
| `driven_by` | `{ id, name, phone, vehicleNumber }` / null | set on `published` rows that someone drove |
| `split` | `{ driver_payout, owner_commission }` / null | set when the ride was taken from the feed |

Suggested UI: two tabs **Driven / Published** with a **Completed / Cancelled** chip filter.

## 2. Upcoming — `GET /drivers/rides/upcoming?page=1&limit=20`

Rides **assigned to me that I haven't started**:

- scheduled bookings I accepted (`source: "scheduled"`)
- every driver-created ride handed to me — fleet assign, feed accept, contact assign — scheduled or immediate (`source: "network"`)

Not to be confused with `GET /drivers/scheduled-rides`, which lists **open** scheduled rides nobody has taken yet.

Order: immediate rides first, then by `scheduledAt` (soonest first).

```json
{
  "results": [
    {
      "id": "…",
      "origin": "driver_created",
      "source": "network",
      "status": "accepted",
      "liveStatus": "accepted",
      "scheduledAt": "2026-10-18T04:30:00.000Z",
      "is_overdue": false,
      "serviceType": "ride",
      "pickup": { "address": "Vijay Nagar, Indore", "coordinates": [75.85, 22.71] },
      "drop": { "address": "MP Nagar, Bhopal", "coordinates": [77.41, 23.25] },
      "fare": 5000,
      "amount_for_you": 3000,
      "paymentMethod": "cash",
      "notes": "",
      "customer": { "name": "History Customer", "phone": "9100000055" },
      "assignment": {
        "mode": "published",
        "assigned_at": "…",
        "acknowledged_at": null,
        "assigned_by": { "driver_id": "…", "name": "Ramesh Verma", "phone": "9000000001", "org_name": "Ram Travels" }
      },
      "is_secure": false,
      "escrow_state": "none"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

- `amount_for_you` is the agreed payout when I took the ride from the feed; otherwise `null` (show `fare`).
- `is_overdue: true` — scheduled time has passed and the ride still hasn't started; highlight it.
- `assignment.acknowledged_at == null` on a network ride → show the existing **Confirm** button (`POST /drivers/network/rides/:id/acknowledge`).
- A ride leaves this list once it is started, completed, cancelled, unassigned or rejected.

## Acceptance checklist

- [ ] History has Driven / Published tabs and Completed / Cancelled filters.
- [ ] Published rows show who drove and the split.
- [ ] Upcoming screen lists assigned work, with overdue highlighting and Confirm where needed.
