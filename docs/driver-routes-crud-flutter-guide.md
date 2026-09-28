# GoKab Driver App — Driver Routes CRUD Update

> **Audience:** Flutter driver-app developer.
> **Status:** written against the backend as actually implemented (commit `394d47a`), not against the original spec.
> **Scope:** the **My Routes** screen — creating/editing/deleting a driver's saved corridors, and the route-mode toggle (All Locations vs a specific route). Nothing else in `driver-network-flutter-integration.md` changes.

Request payload is unchanged — you're still sending exactly the same shape you already send. What changed is error handling, two response fields, and one socket event you should already be listening for.

---

## 1. Malformed/stale route ids now 404 cleanly

`PATCH /routes/:routeId`, `DELETE /routes/:routeId`, and `PATCH /route-mode` (with a `routeId`) used to crash the server (`500`) if the id was malformed. They now return a normal:
```json
{ "success": false, "message": "Route not found", "code": "ROUTE_NOT_FOUND" }
```
If the app has any retry/crash-recovery logic keyed on a `500` from these endpoints, it can be simplified — a bad or stale route id is now just a `404` like any other not-found case (same handling as a route that belongs to someone else, or was already deleted).

---

## 2. `corridor_km` is validated — handle `422 INVALID_CORRIDOR`

Sending a non-numeric or out-of-range `corridor_km` (must be 1–50) on create or update now fails instead of silently saving garbage:
```json
{ "success": false, "message": "Corridor width must be between 1 and 50 km", "code": "INVALID_CORRIDOR" }
```
If the corridor-width slider/input can somehow produce a value outside 1–50 (or empty-string get sent instead of omitted), clamp it client-side too — but treat this error code as the authoritative check. Omitting `corridor_km` entirely on create still works and gets the admin-configured default.

Route name validation now has its own code too: an empty name is `422 INVALID_NAME` (previously the same `INVALID_STOPS` code stops validation used) — if the app branches on error `code` for inline field errors, `INVALID_NAME` and `INVALID_STOPS` are now distinguishable.

---

## 3. Editing a route no longer always re-geocodes

**No request change needed here** — this is a backend efficiency fix, but it changes what you'll observe: renaming a route, or only adjusting `corridor_km`/`bidirectional`, no longer triggers a Google Directions lookup. `path_source` and the map polyline stay exactly as they were before that edit. If the app was showing a brief "recalculating route…" spinner on every save regardless of what changed, it's fine to keep it — it'll now just resolve near-instantly when stops didn't move, since there's no external call in that case.

---

## 4. Deleting or editing the **active** route now notifies other devices

If a driver is signed in on two devices and one of them edits or deletes the corridor that's currently active, the other device now receives the existing socket event:
```json
// event: driver:route-mode:updated
{ "route_mode": "route" | "all_locations", "active_route_id": "66f…" | null }
```
This event already exists for the manual mode-switch case (`driver-network-flutter-integration.md` §4) — no new listener needed, just confirm the handler also refreshes the **My Routes** screen's selected-route highlight and the corridor shown on the map, not just a plan/category banner, since it can now fire from an edit/delete on a different device too.

**`DELETE /routes/:routeId` response gained `was_active`:**
```json
{ "success": true, "data": { "deleted": true, "was_active": true, "route_mode": "all_locations" } }
```
If `was_active` is `true`, show something like *"Deleted — you're now set to All Locations"* so the driver isn't surprised their matching just changed. If `false`, no mode change happened and no extra messaging is needed.

---

## 5. `max_routes: 0` is now its own clear error

Creating a route, or switching **into** route mode, on a plan that doesn't include routes at all now returns:
```json
{ "success": false, "message": "Routes are not included in your current plan", "code": "ROUTES_NOT_IN_PLAN" }
```
This is distinct from the existing `ROUTE_LIMIT_REACHED` (a plan that *does* include routes, but the driver has used up their quota — still has `details: { limit, used }`). Show a different message for each:
- `ROUTES_NOT_IN_PLAN` → "Your plan doesn't include saved routes — upgrade to use this."
- `ROUTE_LIMIT_REACHED` → "You've used all N routes your plan allows."

**Switching to `all_locations` is always allowed**, on any plan, including a 0-route one — no change needed there.

---

## 6. `PATCH /route-mode` response now echoes `active_route_id`

```json
{ "route_mode": "route", "active_route_id": "66f…", "active_route": { "...": "..." } }
{ "route_mode": "all_locations", "active_route_id": null, "active_route": null }
```
`active_route_id` is new at the top level (it already existed nested inside `active_route`, and in `GET /routes`). If the app was pulling the id out of `active_route.id` after a mode-switch call, you can read `active_route_id` directly now — same value, just no need to dig into the nested object.

---

## 7. Downgrade can silently switch a driver back to All Locations

If a driver's plan changes (expiry, or any tier change) and their new effective plan has `max_routes: 0`, and they were in `route` mode, the backend now automatically switches them to `all_locations` and emits the same `driver:route-mode:updated` event from §4. Their saved routes are **not deleted** — if they upgrade again later, the routes are still there to pick from.

**What to do:** nothing extra to build, but make sure whatever screen shows the current route mode (My Routes, and any home-screen "you're set to: X" indicator) is subscribed to `driver:route-mode:updated` rather than only read once on load — this is exactly the kind of change that can happen in the background (e.g. overnight subscription expiry) while the driver isn't actively looking at the routes screen.

---

## 8. Outstation matching change — more rides may now reach a route driver (backend-only, but worth knowing)

**No app change required**, but this affects what a driver actually sees in dispatch and the feed: a driver in `route` mode is no longer limited to ride requests from their own home city. If their route runs Indore → Bhopal, a Bhopal-origin ride on that same corridor can now reach them too — previously it couldn't, which defeated a lot of the point of having a route. If the app has any UI copy implying "you only get rides starting in your city," that's no longer accurate for a driver with an active route.

---

## What did **not** change

- The route create/update request payload shape (`name`, `stops[]`, `corridor_km`, `bidirectional`) — identical to before.
- `PATCH /routes/:id` is still a **partial** update — send only the fields you're changing, same as today.
- Delete is still a soft delete; a deleted route simply stops appearing and can't be reselected.
- Everything else in `driver-network-flutter-integration.md` (sockets, network rides, feed, leads, wallet) — untouched.

---

## Acceptance checklist

- [ ] Saving a route with an out-of-range corridor value shows a clear inline error, not a generic failure.
- [ ] Tapping an already-deleted or stale route id (e.g. a cached list that's gone stale) shows "not found," not a crash/error screen.
- [ ] Renaming a route is fast and doesn't show a "recalculating route" delay if one exists in the UI.
- [ ] Edit the currently-active route on Device A — confirm Device B's My Routes / map updates live.
- [ ] Delete the currently-active route — confirm the app tells the driver they're now on All Locations.
- [ ] Delete a route that ISN'T active — confirm no mode-change messaging appears.
- [ ] A plan with no routes included shows a distinct "not included in your plan" message vs. "you've used your route limit."
- [ ] Switching to All Locations works even on a 0-route plan.
- [ ] After a mode-switch, confirm the app can read `active_route_id` from the top level of the response.
- [ ] Simulate/observe a plan downgrade while in route mode — confirm the app's route-mode indicator updates via the socket event, without needing a manual refresh.
