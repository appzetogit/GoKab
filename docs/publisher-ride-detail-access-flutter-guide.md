# Publisher Can Open Their Own Ride: `GET /rides/:rideId` (Flutter Guide)

> **Audience:** Flutter developer (driver app).
> **Status:** on `master` @ `53d7b1c`, live after the next server deploy. Covered by `Backend/scripts/smoke_publisher_ride_access.mjs` (14 checks).
> **Answers:** the bug report "Publisher gets 403 when opening their own published ride".
> **Response envelope (unchanged):** success → `{ "success": true, "data": … }`; error → `{ "success": false, "message": "…", "code": …, "details": … }`.

---

## Contents

1. [Summary](#1-summary)
2. [Who can open a ride](#2-who-can-open-a-ride)
3. [What the publisher receives](#3-what-the-publisher-receives)
4. [Keeping the detail screen up to date](#4-keeping-the-detail-screen-up-to-date)
5. [App changes](#5-app-changes)
6. [Dart example](#6-dart-example)
7. [QA checklist](#7-qa-checklist)

---

## 1. Summary

| | |
|---|---|
| **Bug** | My Rides → History → Published → tap a ride → `403 You are not allowed to access this ride room` |
| **Root cause** | `GET /rides/:rideId` only allowed the rider, the assigned driver and that driver's fleet owner. The driver who **created / published** the ride (`created_by_driver_id`) was never checked, so the publisher could see the ride in `GET /rides?role=published` but not open it |
| **Fix chosen** | the **`getRideById`-only** fix, not the shared helper. The publisher can **read** the ride detail; the ride socket room and ride chat are still participant-only |
| **Why not the shared helper** | the same check guards the ride socket room and the rider–driver chat. Allowing the publisher there would let them join the live room and **post chat messages as the driver** |
| **Verified** | publisher **200**, unrelated driver **403**, and the publisher still can't join the room or post in the chat |

---

## 2. Who can open a ride

`GET /api/v1/rides/:rideId`

| Viewer | Before | Now | Chat (`messages`) |
|---|---|---|---|
| Rider (`userId`) | 200 | 200 | ✅ included |
| Assigned driver (`driverId`) | 200 | 200 | ✅ included |
| Fleet owner of the assigned driver | 200 | 200 | ✅ included |
| **Publisher / creator** (`created_by_driver_id`), ride not taken yet | **403** | **200** | ❌ not included |
| **Publisher / creator**, after another driver took it | **403** | **200** | ❌ not included |
| Publisher who assigned the ride **to themselves** | 200 | 200 | ✅ included (they are the driver) |
| A driver who only saw it in the feed, or any other driver | 403 | **403** | — |

Works whether the customer is an app user or offline (`userId: null`), and whatever the ride's state (open, taken, ongoing, completed, cancelled, expired).

Errors (unchanged):

| HTTP | When |
|---|---|
| `404 Ride not found` | wrong id |
| `403 You are not allowed to access this ride room` | not the rider, the driver, the fleet owner or the publisher |

---

## 3. What the publisher receives

The same response as the assigned driver gets, **minus `messages`**: the chat is between the rider and the driver who took the ride.

```json
{
  "success": true,
  "data": {
    "_id": "6ad5eee6f459033e7c5e4c9f",
    "origin": "driver_created",
    "status": "accepted",
    "liveStatus": "accepted",
    "fare": 5000,
    "paymentMethod": "cash",
    "pickupAddress": "Vijay Nagar, Indore",
    "dropAddress": "MP Nagar, Bhopal",
    "offline_customer": { "name": "Walk-in Customer", "phone": "9100000077" },
    "userId": null,
    "driverId": { "_id": "…", "name": "Vikas Singh", "phone": "9000000003", "vehicleNumber": "MP09AB1234" },
    "publish": { "status": "taken", "is_secure": true, "total_fare": 5000, "owner_commission": 2000, "driver_payout": 3000 },
    "escrow": { "state": "held", "publisher_hold": 3000, "acceptor_hold": 2000, "collected_by": null },
    "is_secure": true,
    "publisher": { "id": "…", "name": "Ramesh Verma", "…": "…" }
  }
}
```

Notes:
- `driverId` is `null` until someone takes the ride.
- The publisher sees the customer's details and the ride OTP. That's intended: it's their customer's booking.
- Treat `messages` as **optional** in the model. It's absent for the publisher and present for the rider and the driver.

---

## 4. Keeping the detail screen up to date

The publisher **cannot** join the ride room (`ride:join` → `errorMessage`), so they don't get `ride:state` or the driver's per-ride location. They do get these events in their own `publisher:<id>` room, which the app already joins on connect:

| Socket event | When | Payload |
|---|---|---|
| `network:ride:taken` | another driver accepted | `{ rideId, driverId, held, is_secure, acceptor: { id, name, phone, vehicleNumber } }` |
| `network:ride:expired` | nobody took it in time | `{ rideId }` |
| `network:ride:rejected` | the assigned driver gave it back | `{ rideId, driverId, driverName, reason }` |
| `org:ride-started` | the driver started the trip | `{ rideId, driverId, liveStatus, status }` |
| `org:ride-ended` | completed or cancelled | `{ rideId, driverId, liveStatus, status }` |
| `org:live-location` | the driver is moving (throttled) | `{ rideId, driverId, driverName, vehicleNumber, coordinates: [lng, lat], heading, speed, pickup, drop, liveStatus, at }` |
| `escrow:settled` | the secure ride was settled | `{ rideId, collected_by, can_dispute: true, … }` |

Pushes on the same moments: `network_ride_taken`, `network_ride_expired`, `network_ride_rejected`, `network_ride_cancelled`, `escrow_settled`.

**Rule:** while the publisher's ride-detail screen is open, **refetch `GET /rides/:rideId`** whenever one of these events arrives with the same `rideId`. You can also move the map marker straight from `org:live-location`. There is no separate event for "arriving" or "arrived"; those show up on the next refetch.

---

## 5. App changes

| # | Change | Required? |
|---|---|---|
| 1 | Nothing for the 403: the same `GET /rides/:rideId` call now works for the publisher | — |
| 2 | Make `messages` nullable / optional in the ride-detail model | **yes**, if the model currently requires it |
| 3 | On the publisher's detail screen, **hide the chat** and don't call `ride:join` / `ride:message:send` | **yes** (they would be refused with `errorMessage`) |
| 4 | Refresh the publisher's detail screen from the events in §4 | recommended |
| 5 | Decide "am I the publisher?" with `ride.publisher.id == me.id` (or `created_by_driver_id`) and `ride.driverId?._id != me.id` | recommended |

---

## 6. Dart example

```dart
class RideDetailScreenController {
  RideDetailScreenController(this.api, this.socket, this.me, this.rideId);

  final Api api;
  final Socket socket;
  final Driver me;
  final String rideId;
  Map<String, dynamic>? ride;

  bool get iAmAssignedDriver => ride?['driverId']?['_id'] == me.id;
  bool get iAmPublisherOnly => ride?['publisher']?['id'] == me.id && !iAmAssignedDriver;
  bool get showChat => !iAmPublisherOnly;

  static const _publisherEvents = [
    'network:ride:taken', 'network:ride:expired', 'network:ride:rejected',
    'org:ride-started', 'org:ride-ended', 'escrow:settled',
  ];

  Future<void> open() async {
    await refresh();
    if (iAmPublisherOnly) {
      for (final event in _publisherEvents) {
        socket.on(event, _onPublisherEvent);
      }
      socket.on('org:live-location', _onLiveLocation);
    } else {
      socket.emit('ride:join', {'rideId': rideId}); // rider / assigned driver only
    }
  }

  Future<void> refresh() async {
    final res = await api.get('/rides/$rideId');
    ride = res.data['data'] as Map<String, dynamic>;
    final messages = (ride!['messages'] as List?) ?? const []; // absent for the publisher
    // … update UI
  }

  void _onPublisherEvent(dynamic payload) {
    if (payload is Map && payload['rideId'] == rideId) refresh();
  }

  void _onLiveLocation(dynamic payload) {
    if (payload is! Map || payload['rideId'] != rideId) return;
    final coords = payload['coordinates'] as List; // [lng, lat]
    // move the driver marker to LatLng(coords[1], coords[0])
  }

  void close() {
    for (final event in [..._publisherEvents, 'org:live-location']) {
      socket.off(event);
    }
  }
}
```

---

## 7. QA checklist

| # | Steps | Expected |
|---|---|---|
| 1 | Driver A publishes a ride (offline customer). A opens it from My Rides → History → Published | opens, no 403, no chat section |
| 2 | Driver C (unrelated) calls `GET /rides/<that id>` | 403 |
| 3 | Driver B accepts it. A opens it again | opens; shows B as the driver, still no chat |
| 4 | B opens the same ride | opens with the chat |
| 5 | B starts the trip while A's detail screen is open | A's screen refreshes to "started" (`org:ride-started`) |
| 6 | B completes it | A's screen refreshes to completed (`org:ride-ended`); escrow shows settled after `escrow:settled` |
| 7 | A publishes, nobody accepts until expiry, A opens it | opens, shows expired |
| 8 | Ride `6ad5eee6f459033e7c5e4c9f` from the report, opened by its publisher | opens (after deploy) |

Related guides: `driver-app-backend-gaps-flutter-guide.md`, `image-urls-and-profile-photos-flutter-guide.md`.
