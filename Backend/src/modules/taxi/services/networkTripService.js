import crypto from 'crypto';
import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { Ride } from '../user/models/Ride.js';
import { User } from '../user/models/User.js';
import { Driver } from '../driver/models/Driver.js';
import { Owner } from '../admin/models/Owner.js';
import { ApiError } from '../../../utils/ApiError.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';

/**
 * Trip updates for rides a driver created (published to the network, or given to
 * a fleet driver / saved contact): who is told what as the trip moves, the
 * customer's tracking link, and the "on the way" step that starts live location.
 *
 * A customer with a GoKab account is reached through the app (the ride is linked
 * to them). One without gets a text (SMS, and WhatsApp later) with the same
 * details and a link to watch the driver on a map.
 */

const safe = (value, fallback = '') => String(value ?? '').trim() || fallback;
const dispatch = () => import('./dispatchService.js');

const baseUrl = () =>
  String(process.env.PUBLIC_BASE_URL || process.env.FRONTEND_PUBLIC_URL || 'https://gokab.in').replace(/\/+$/, '');

export const trackingLink = (token) => `${baseUrl()}/api/v1/track/${token}`;

export const ensureTrackingToken = async (ride) => {
  if (ride.tracking?.token) return ride.tracking.token;
  const token = crypto.randomBytes(9).toString('base64url');
  await Ride.updateOne({ _id: ride._id, 'tracking.token': { $in: [null, ''] } }, { $set: { 'tracking.token': token } });
  const fresh = await Ride.findById(ride._id).select('tracking').lean();
  return fresh?.tracking?.token || token;
};

const when = (date) =>
  date
    ? new Date(date).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : 'now';

/** Who the customer should call: the publisher's business name and number. */
export const loadPublisherInfo = async (ride) => {
  const [creator, organization] = await Promise.all([
    ride.created_by_driver_id
      ? Driver.findById(ride.created_by_driver_id).select('name phone business_name customer_contact_phone').lean()
      : null,
    ride.organization_owner_id
      ? Owner.findById(ride.organization_owner_id).select('company_name').lean()
      : null,
  ]);
  return {
    driverId: creator?._id ? String(creator._id) : '',
    businessName: safe(creator?.business_name) || safe(organization?.company_name) || safe(creator?.name, 'GoKab'),
    contactPhone: safe(creator?.customer_contact_phone) || safe(creator?.phone),
  };
};

const loadDriverInfo = async (ride) => {
  const driver = ride.driverId
    ? await Driver.findById(ride.driverId?._id || ride.driverId)
        .select('name phone vehicleNumber vehicleMake vehicleModel vehicleType')
        .lean()
    : null;
  const label = [safe(driver?.vehicleMake), safe(driver?.vehicleModel)].filter(Boolean).join(' ') || safe(driver?.vehicleType);
  const number = safe(ride.assignment?.vehicle?.number) || safe(driver?.vehicleNumber);
  return {
    name: safe(driver?.name, 'Your driver'),
    phone: safe(driver?.phone),
    vehicle: [label, number].filter(Boolean).join(' '),
  };
};

const buildText = ({ kind, ride, publisher, driver, link }) => {
  const by = `${publisher.businessName}${publisher.contactPhone ? ` (${publisher.contactPhone})` : ''}`;
  switch (kind) {
    case 'assigned':
      return (
        `Your ride is confirmed. Booked by ${by}. Driver: ${driver.name} ${driver.phone}` +
        `${driver.vehicle ? `, ${driver.vehicle}` : ''}. Pickup ${when(ride.scheduledAt)}: ${safe(ride.pickupAddress)}. ` +
        `OTP ${safe(ride.otp)}. Track your driver: ${link}`
      );
    case 'on_the_way':
      return `Your driver ${driver.name} (${driver.phone}) is on the way to the pickup. Track: ${link}`;
    case 'arrived':
      return `Your driver ${driver.name} has reached the pickup point. Share the OTP ${safe(ride.otp)} with the driver to start the trip.`;
    case 'completed':
      return `Your ride is complete. Thank you! Booked by ${by}.`;
    default:
      return '';
  }
};

/** Texts the customer who has no GoKab account. Never throws. */
export const sendCustomerMessage = async ({ phone, text, kind }) => {
  if (!phone || !text) return { sent: false };
  console.log(`[customer-message] ${kind} -> ${phone}: ${text}`);
  try {
    const { sendCustomText } = await import('./smsService.js');
    const result = await sendCustomText({ phone, text });
    return { sent: Boolean(result?.delivered) };
  } catch (error) {
    console.error('[customer-message] failed:', error.message);
    return { sent: false };
  }
};

const PUSH_COPY = {
  assigned: (p, d) => ['Your ride is confirmed', `Booked by ${p.businessName}. Driver ${d.name} ${d.phone}${d.vehicle ? `, ${d.vehicle}` : ''}.`],
  on_the_way: (_p, d) => ['Your driver is on the way', `${d.name} is heading to your pickup point.`],
};

/**
 * Tells the customer: app push if the ride is linked to their account, a text
 * otherwise. (Arrived / started / completed pushes for app users already come
 * from the normal rider status pushes.)
 */
export const notifyCustomer = async (ride, kind) => {
  const [publisher, driver] = await Promise.all([loadPublisherInfo(ride), loadDriverInfo(ride)]);
  const token = await ensureTrackingToken(ride);
  const link = trackingLink(token);

  if (ride.userId) {
    const copy = PUSH_COPY[kind];
    if (!copy) return;
    const [title, body] = copy(publisher, driver);
    const d = await dispatch();
    d.emitToRoom(d.getUserRoom(ride.userId?._id || ride.userId), 'network:ride:status', {
      rideId: String(ride._id),
      kind,
      liveStatus: ride.liveStatus,
    });
    await sendPushNotificationToEntities({
      userIds: [String(ride.userId?._id || ride.userId)],
      title,
      body,
      data: { type: `network_ride_${kind}`, rideId: String(ride._id) },
    }).catch((error) => console.error('[networkTrip] customer push failed:', error.message));
    return;
  }

  const text = buildText({ kind, ride, publisher, driver, link });
  await sendCustomerMessage({ phone: safe(ride.offline_customer?.phone), text, kind });
};

const PUBLISHER_COPY = {
  on_the_way: (d) => ['Driver is on the way', `${d} is heading to the pickup. Track live on the map.`],
  arrived: (d) => ['Driver reached the pickup', `${d} is at the pickup point.`],
  started: (d) => ['Trip started', `${d} started the trip.`],
  completed: (d) => ['Ride completed', `${d} completed the ride.`],
};

/** The publisher (who is not the one driving) follows the trip status by push and socket. */
export const notifyPublisher = async (ride, kind) => {
  const publisherId = ride.created_by_driver_id ? String(ride.created_by_driver_id) : '';
  const driverId = String(ride.driverId?._id || ride.driverId || '');
  if (!publisherId || publisherId === driverId || ride.origin !== 'driver_created') return;
  const copy = PUBLISHER_COPY[kind];
  if (!copy) return;

  const driver = await loadDriverInfo(ride);
  const [title, body] = copy(driver.name);
  const d = await dispatch();
  d.emitToRoom(d.getPublisherRoom(publisherId), 'network:ride:status', {
    rideId: String(ride._id),
    kind,
    liveStatus: ride.liveStatus,
    driverName: driver.name,
  });
  if (ride.organization_owner_id) {
    d.emitToRoom(d.getOrgRoom(ride.organization_owner_id), 'network:ride:status', {
      rideId: String(ride._id),
      kind,
      liveStatus: ride.liveStatus,
      driverName: driver.name,
    });
  }
  await sendPushNotificationToEntities({
    driverIds: [publisherId],
    title,
    body: `${body} Pickup: ${safe(ride.pickupAddress, 'see app')}`,
    data: { type: `network_ride_${kind}`, rideId: String(ride._id) },
  }).catch((error) => console.error('[networkTrip] publisher push failed:', error.message));
};

/**
 * Called after the driver's status changes (arrived / started / completed) on a
 * driver-created ride. App customers are already pushed by the rider status
 * pushes; a customer without the app gets the text.
 */
export const onNetworkRideStatus = async (ride, nextStatus) => {
  if (ride?.origin !== 'driver_created') return;
  const kind =
    nextStatus === RIDE_LIVE_STATUS.ARRIVING
      ? 'arrived'
      : nextStatus === RIDE_LIVE_STATUS.STARTED
        ? 'started'
        : nextStatus === RIDE_LIVE_STATUS.COMPLETED
          ? 'completed'
          : '';
  if (!kind) return;

  await notifyPublisher(ride, kind);
  if (!ride.userId && (kind === 'arrived' || kind === 'completed')) await notifyCustomer(ride, kind);
};

/**
 * The driver taps "Go to pickup". From here until the ride ends the publisher
 * sees their live location, and the customer is told the driver is coming.
 */
export const markDriverEnRoute = async ({ rideId, driverId }) => {
  const ride = await Ride.findOne({ _id: rideId, driverId });
  if (!ride) throw new ApiError(404, 'Assigned ride not found');
  if (![RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING].includes(ride.liveStatus)) {
    throw new ApiError(409, 'This ride has already started');
  }

  const { getScheduledStartWindowMs, isRideBeforeStartWindow, isRideScheduledForFuture } = await import('./rideService.js');
  if (isRideScheduledForFuture(ride)) {
    const windowMs = await getScheduledStartWindowMs();
    if (isRideBeforeStartWindow(ride, windowMs)) {
      throw new ApiError(409, 'This ride is scheduled for later. You can start it closer to the pickup time.', null, 'TOO_EARLY_TO_START');
    }
  }

  if (ride.enRouteAt) return ride;
  ride.enRouteAt = new Date();
  await ride.save();

  await notifyPublisher(ride, 'on_the_way');
  if (ride.origin === 'driver_created') await notifyCustomer(ride, 'on_the_way');
  return ride;
};

/** The customer signed up (or logged in) with a phone a publisher already used for a ride. */
export const linkOfflineRidesToUser = async (user) => {
  const digits = String(user?.phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return 0;
  const result = await Ride.updateMany(
    {
      userId: null,
      origin: 'driver_created',
      status: { $in: [RIDE_STATUS.SEARCHING, RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
      'offline_customer.phone': { $regex: `${digits}$` },
    },
    { $set: { userId: user._id } },
  );
  return result.modifiedCount || 0;
};

/** Publisher gets one heads-up when the driver's location has gone quiet mid-trip. */
export const alertLostDriverLocations = async () => {
  const stale = new Date(Date.now() - 3 * 60 * 1000);
  const rides = await Ride.find({
    origin: 'driver_created',
    status: { $in: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING] },
    $or: [{ enRouteAt: { $ne: null } }, { liveStatus: RIDE_LIVE_STATUS.STARTED }],
    'lastDriverLocation.updatedAt': { $lt: stale },
    'tracking.lostAlertedAt': null,
  }).limit(100);

  for (const ride of rides) {
    ride.tracking = { ...(ride.tracking?.toObject?.() || ride.tracking || {}), lostAlertedAt: new Date() };
    await ride.save();
    const publisherId = ride.created_by_driver_id ? String(ride.created_by_driver_id) : '';
    if (!publisherId || publisherId === String(ride.driverId)) continue;
    await sendPushNotificationToEntities({
      driverIds: [publisherId],
      title: 'Driver location unavailable',
      body: 'We have not received the driver\'s location for a few minutes (app closed or GPS off).',
      data: { type: 'network_location_lost', rideId: String(ride._id) },
    }).catch(() => {});
  }
};

// ---------------------------------------------------------------- public tracking page

const LIVE = [RIDE_STATUS.ACCEPTED, RIDE_STATUS.ONGOING];

const statusLabel = (ride) => {
  if (ride.status === RIDE_STATUS.COMPLETED) return 'Ride completed';
  if (ride.status === RIDE_STATUS.CANCELLED) return 'Ride cancelled';
  if (ride.liveStatus === RIDE_LIVE_STATUS.STARTED || ride.liveStatus === RIDE_LIVE_STATUS.ARRIVED) return 'Trip in progress';
  if (ride.liveStatus === RIDE_LIVE_STATUS.ARRIVING) return 'Driver has reached the pickup';
  if (ride.enRouteAt) return 'Driver is on the way';
  return 'Driver assigned';
};

export const getTrackingData = async (token) => {
  const ride = await Ride.findOne({ 'tracking.token': String(token || '') });
  if (!ride) return null;
  const ended = !LIVE.includes(ride.status);
  const endedAt = ride.completedAt || ride.updatedAt;
  if (ended && Date.now() - new Date(endedAt).getTime() > 6 * 60 * 60 * 1000) return { expired: true };

  const [publisher, driver] = await Promise.all([loadPublisherInfo(ride), loadDriverInfo(ride)]);
  const sharing = !ended && (ride.enRouteAt || ride.liveStatus === RIDE_LIVE_STATUS.STARTED);
  return {
    status: statusLabel(ride),
    ended,
    scheduledAt: ride.scheduledAt || null,
    driver,
    bookedBy: { name: publisher.businessName, phone: publisher.contactPhone },
    pickup: { address: safe(ride.pickupAddress), coordinates: ride.pickupLocation?.coordinates || [] },
    drop: { address: safe(ride.dropAddress), coordinates: ride.dropLocation?.coordinates || [] },
    location: sharing && ride.lastDriverLocation?.coordinates?.length === 2 ? ride.lastDriverLocation.coordinates : null,
    locationAt: ride.lastDriverLocation?.updatedAt || null,
  };
};

export const trackingPageHtml = (token) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Track your ride</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#f3f4f6;color:#111}
#map{height:55vh;width:100%}
.card{background:#fff;border-radius:18px 18px 0 0;margin-top:-18px;position:relative;padding:18px 16px 28px;box-shadow:0 -4px 18px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 4px}.sub{color:#666;font-size:13px;margin-bottom:12px}
.row{display:flex;gap:10px;align-items:center;margin:10px 0;font-size:14px}
.pill{display:inline-block;background:#ffd600;border-radius:999px;padding:6px 12px;font-weight:700;font-size:13px}
a.btn{display:inline-block;background:#111;color:#fff;border-radius:12px;padding:10px 14px;text-decoration:none;font-size:14px;margin-right:8px}
.muted{color:#777;font-size:12px}
</style></head><body>
<div id="map"></div>
<div class="card">
  <span class="pill" id="status">Loading...</span>
  <h1 id="driver"></h1><div class="sub" id="vehicle"></div>
  <div class="row" id="pickup"></div><div class="row" id="drop"></div>
  <div class="row"><a class="btn" id="callDriver" href="#">Call driver</a><a class="btn" id="callBy" href="#">Call booking contact</a></div>
  <div class="muted" id="by"></div><div class="muted">Share the OTP from your message with the driver at pickup.</div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map').setView([22.72,75.86],13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
var drv=null,pk=null,dp=null,fitted=false;
function ll(c){return [c[1],c[0]]}
function pin(color){return L.divIcon({html:'<div style="width:16px;height:16px;border-radius:50%;background:'+color+';border:3px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.5)"></div>',iconSize:[16,16],className:''})}
function put(o,c,color){if(!c||c.length!==2)return o;if(o){o.setLatLng(ll(c))}else{o=L.marker(ll(c),{icon:pin(color)}).addTo(map)}return o}
function tick(){fetch('/api/v1/track/${token}/data').then(function(r){return r.json()}).then(function(j){
 var d=j.data;if(!d){document.getElementById('status').textContent='Link not found';return}
 if(d.expired){document.getElementById('status').textContent='This link has expired';return}
 document.getElementById('status').textContent=d.status;
 document.getElementById('driver').textContent=d.driver.name;
 document.getElementById('vehicle').textContent=d.driver.vehicle||'';
 document.getElementById('pickup').textContent='Pickup: '+d.pickup.address;
 document.getElementById('drop').textContent='Drop: '+d.drop.address;
 document.getElementById('callDriver').href='tel:'+d.driver.phone;
 document.getElementById('callBy').href='tel:'+d.bookedBy.phone;
 document.getElementById('by').textContent='Booked by '+d.bookedBy.name+(d.bookedBy.phone?' ('+d.bookedBy.phone+')':'');
 pk=put(pk,d.pickup.coordinates,'#16a34a');dp=put(dp,d.drop.coordinates,'#dc2626');drv=put(drv,d.location,'#111');
 if(!fitted){var pts=[];[d.pickup.coordinates,d.drop.coordinates,d.location].forEach(function(c){if(c&&c.length===2)pts.push(ll(c))});if(pts.length){map.fitBounds(pts,{padding:[40,40]});fitted=true}}
 if(d.ended)clearInterval(t)
}).catch(function(){})}
var t=setInterval(tick,5000);tick();
</script></body></html>`;
