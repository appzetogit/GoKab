import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { ServiceLocation } from '../../admin/models/ServiceLocation.js';
import {
  getDriverPermissions,
  getPrimeSlotUsage,
} from '../../services/driverCategoryService.js';
import {
  acceptFeedRide,
  getFeed,
  publishRide,
  unpublishRide,
} from '../services/feedService.js';
import { getLiveMapSnapshot } from '../../services/liveMapService.js';
import { openEscrowDispute, reportUnsecureRide } from '../services/escrowService.js';
import { getEarningsSummary, listCommissionEarnings, setWeeklyEarningsGoal } from '../services/earningsService.js';
import { addContact, listContacts, listWorkedWith, removeContact } from '../services/contactService.js';
import {
  listLeadConversations,
  listLeadMessages,
  openLeadContact,
  postLeadMessage,
} from '../services/leadService.js';
import {
  acknowledgeAssignment,
  assignRide,
  cancelDriverRide,
  createDriverRide,
  getFleetAvailability,
  listNetworkRides,
  listUpcomingRides,
  reassignRide,
  rejectAssignment,
  unassignRide,
  updateOrganization,
} from '../services/networkRideService.js';
import {
  createDriverRoute,
  deleteDriverRoute,
  listDriverRoutes,
  setDriverRouteMode,
  updateDriverRoute,
} from '../services/driverRouteService.js';

/**
 * GET /drivers/category
 *
 * Everything the driver app needs to render the network section: which
 * category the recharge bought, what it unlocks, how close they are to the
 * route limit, whether the vehicle rule is satisfied, and how many Prime seats
 * their city has left.
 */
export const getDriverCategoryController = asyncHandler(async (req, res) => {
  const permissions = await getDriverPermissions(req.auth.sub);
  const driver = permissions.driver;

  const city = driver.service_location_id
    ? await ServiceLocation.findById(driver.service_location_id).select('name prime_limit').lean()
    : null;
  const slots = driver.service_location_id
    ? await getPrimeSlotUsage(driver.service_location_id)
    : { limit: null, used: 0, left: null };

  res.json({
    success: true,
    data: {
      category: permissions.category,
      tier: permissions.tier
        ? {
            id: String(permissions.tier._id),
            name: permissions.tier.name,
            badge_color_hex: permissions.tier.badge_color_hex || '#10B981',
          }
        : null,
      expires_at: permissions.expires_at,
      permissions: {
        can_create_rides: permissions.can_create_rides,
        can_publish_rides: permissions.can_publish_rides,
        can_manage_fleet: permissions.can_manage_fleet,
        can_use_contacts: permissions.can_use_contacts,
        max_routes: permissions.max_routes,
        routes_used: permissions.routes_used,
        max_fleet_drivers: permissions.max_fleet_drivers,
        max_vehicles: permissions.max_vehicles,
        requires_commercial_at_purchase: permissions.requires_commercial_at_purchase,
        customer_lead_contact_fee: permissions.customer_lead_contact_fee,
        driver_lead_contact_fee: permissions.driver_lead_contact_fee,
        customer_ride_accept_fee: permissions.customer_ride_accept_fee,
      },
      vehicle_rule: permissions.vehicle_rule,
      city: city
        ? {
            id: String(city._id),
            name: city.name,
            prime_limit: slots.limit,
            prime_slots_left: slots.left,
          }
        : null,
      grace: {
        active: permissions.grace.active,
        ends_at: permissions.grace.ends_at,
        reason: permissions.grace.active ? 'VEHICLE_RULE_BROKEN' : null,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Driver routes (R8)
// ---------------------------------------------------------------------------

export const listDriverRoutesController = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listDriverRoutes(req.auth.sub) });
});

export const createDriverRouteController = asyncHandler(async (req, res) => {
  const route = await createDriverRoute({
    driverId: req.auth.sub,
    name: req.body?.name,
    stops: req.body?.stops,
    corridorKm: req.body?.corridor_km ?? req.body?.corridorKm,
    bidirectional: req.body?.bidirectional,
  });
  res.status(201).json({ success: true, data: route });
});

export const updateDriverRouteController = asyncHandler(async (req, res) => {
  const route = await updateDriverRoute({
    driverId: req.auth.sub,
    routeId: req.params.routeId,
    name: req.body?.name,
    stops: req.body?.stops,
    corridorKm: req.body?.corridor_km ?? req.body?.corridorKm,
    bidirectional: req.body?.bidirectional,
  });
  res.json({ success: true, data: route });
});

export const deleteDriverRouteController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await deleteDriverRoute({ driverId: req.auth.sub, routeId: req.params.routeId }),
  });
});

export const setDriverRouteModeController = asyncHandler(async (req, res) => {
  const result = await setDriverRouteMode({
    driverId: req.auth.sub,
    mode: String(req.body?.mode || '').trim(),
    routeId: req.body?.routeId ?? req.body?.route_id,
  });
  res.json({ success: true, data: result });
});

// ---------------------------------------------------------------------------
// Driver-created rides & assignment (R4, R9)
// ---------------------------------------------------------------------------

export const updateOrganizationController = asyncHandler(async (req, res) => {
  const result = await updateOrganization({
    driverId: req.auth.sub,
    // The app's edit-org screen sends `{ name }`; it used to be silently ignored.
    companyName: req.body?.company_name ?? req.body?.companyName ?? req.body?.name,
  });
  res.json({ success: true, data: result });
});

export const createNetworkRideController = asyncHandler(async (req, res) => {
  const ride = await createDriverRide({ driverId: req.auth.sub, payload: req.body || {} });
  res.status(201).json({ success: true, data: ride });
});

export const assignNetworkRideController = asyncHandler(async (req, res) => {
  const ride = await assignRide({
    driverId: req.auth.sub,
    rideId: req.params.rideId,
    targetDriverId: req.body?.driverId ?? req.body?.driver_id,
    // Split for a saved-contact target (ignored for self/fleet).
    body: req.body || {},
  });
  res.json({ success: true, data: ride });
});

export const unassignNetworkRideController = asyncHandler(async (req, res) => {
  const ride = await unassignRide({
    driverId: req.auth.sub,
    rideId: req.params.rideId,
    reason: req.body?.reason,
  });
  res.json({ success: true, data: ride });
});

export const reassignNetworkRideController = asyncHandler(async (req, res) => {
  const ride = await reassignRide({
    driverId: req.auth.sub,
    rideId: req.params.rideId,
    targetDriverId: req.body?.driverId ?? req.body?.driver_id,
    reason: req.body?.reason,
    body: req.body || {},
  });
  res.json({ success: true, data: ride });
});

export const rejectNetworkAssignmentController = asyncHandler(async (req, res) => {
  const ride = await rejectAssignment({
    driverId: req.auth.sub,
    rideId: req.params.rideId,
    reason: req.body?.reason,
  });
  res.json({ success: true, data: ride });
});

export const acknowledgeNetworkAssignmentController = asyncHandler(async (req, res) => {
  const ride = await acknowledgeAssignment({
    driverId: req.auth.sub,
    rideId: req.params.rideId,
  });
  res.json({ success: true, data: ride });
});

export const cancelNetworkRideController = asyncHandler(async (req, res) => {
  const ride = await cancelDriverRide({
    driverId: req.auth.sub,
    rideId: req.params.rideId,
    reason: req.body?.reason,
  });
  res.json({ success: true, data: ride });
});

export const listNetworkRidesController = asyncHandler(async (req, res) => {
  const result = await listNetworkRides({
    driverId: req.auth.sub,
    scope: req.query.scope,
    status: req.query.status,
    page: req.query.page,
    limit: req.query.limit,
  });
  res.json({ success: true, data: result });
});

export const upcomingRidesController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await listUpcomingRides({ driverId: req.auth.sub, page: req.query.page, limit: req.query.limit }),
  });
});

export const fleetAvailabilityController = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getFleetAvailability(req.auth.sub) });
});

// ---------------------------------------------------------------------------
// Publish, feed & escrow (R5, R6, R11)
// ---------------------------------------------------------------------------

export const publishRideController = asyncHandler(async (req, res) => {
  const result = await publishRide({
    driverId: req.auth.sub,
    rideId: req.params.rideId,
    totalFare: req.body?.total_fare ?? req.body?.totalFare,
    ownerCommission: req.body?.owner_commission ?? req.body?.ownerCommission,
    driverPayout: req.body?.driver_payout ?? req.body?.driverPayout,
    expiresInMinutes: req.body?.expires_in_minutes ?? req.body?.expiresInMinutes,
    isSecure: req.body?.is_secure ?? req.body?.isSecure,
  });
  res.status(201).json({ success: true, data: result });
});

export const unpublishRideController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await unpublishRide({ driverId: req.auth.sub, rideId: req.params.rideId }),
  });
});

export const getFeedController = asyncHandler(async (req, res) => {
  const feed = await getFeed({
    driverId: req.auth.sub,
    tab: req.query.tab,
    page: req.query.page,
    limit: req.query.limit,
    lat: req.query.lat,
    lng: req.query.lng,
  });
  res.json({ success: true, data: feed });
});

export const acceptFeedRideController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await acceptFeedRide({ driverId: req.auth.sub, rideId: req.params.rideId }),
  });
});

export const disputeEscrowController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await openEscrowDispute({
      rideId: req.params.rideId,
      driverId: req.auth.sub,
      reason: req.body?.reason,
    }),
  });
});

export const reportUnsecureRideController = asyncHandler(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await reportUnsecureRide({
      rideId: req.params.rideId,
      driverId: req.auth.sub,
      reason: req.body?.reason,
    }),
  });
});

// ---------------------------------------------------------------------------
// Earnings split: rides driven vs commission on published rides
// ---------------------------------------------------------------------------

export const setEarningsGoalController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await setWeeklyEarningsGoal({
      driverId: req.auth.sub,
      targetAmount: req.body?.target_amount ?? req.body?.targetAmount,
    }),
  });
});

export const earningsSummaryController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await getEarningsSummary({
      driverId: req.auth.sub,
      range: req.query.range,
      from: req.query.from,
      to: req.query.to,
    }),
  });
});

export const commissionEarningsController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await listCommissionEarnings({
      driverId: req.auth.sub,
      range: req.query.range,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      limit: req.query.limit,
    }),
  });
});

// ---------------------------------------------------------------------------
// Saved Contacts (§7.2)
// ---------------------------------------------------------------------------

export const workedWithController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await listWorkedWith({ driverId: req.auth.sub, page: req.query.page, limit: req.query.limit }),
  });
});

export const listContactsController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await listContacts({ driverId: req.auth.sub, page: req.query.page, limit: req.query.limit }),
  });
});

export const addContactController = asyncHandler(async (req, res) => {
  const result = await addContact({
    driverId: req.auth.sub,
    contactDriverId: req.body?.driver_id ?? req.body?.driverId ?? req.body?.contact_driver_id,
    sourceRideId: req.body?.source_ride_id ?? req.body?.sourceRideId ?? null,
    nickname: req.body?.nickname,
  });
  res.status(result.created ? 201 : 200).json({ success: true, data: result });
});

export const removeContactController = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: await removeContact({ driverId: req.auth.sub, contactId: req.params.contactId }),
  });
});

// ---------------------------------------------------------------------------
// Lead contact & chat (R7)
// ---------------------------------------------------------------------------

export const contactLeadController = asyncHandler(async (req, res) => {
  const result = await openLeadContact({
    driverId: req.auth.sub,
    rideId: req.params.rideId,
    channel: String(req.body?.channel || 'chat').trim().toLowerCase(),
  });
  res.json({ success: true, data: result });
});

export const listDriverLeadConversationsController = asyncHandler(async (req, res) => {
  const result = await listLeadConversations({
    role: 'driver',
    entityId: req.auth.sub,
    page: req.query.page,
    limit: req.query.limit,
  });
  res.json({ success: true, data: result });
});

export const listDriverLeadMessagesController = asyncHandler(async (req, res) => {
  const result = await listLeadMessages({
    conversationId: req.params.conversationId,
    role: 'driver',
    entityId: req.auth.sub,
    before: req.query.before,
    limit: req.query.limit,
  });
  res.json({ success: true, data: result });
});

export const postDriverLeadMessageController = asyncHandler(async (req, res) => {
  const result = await postLeadMessage({
    conversationId: req.params.conversationId,
    role: 'driver',
    entityId: req.auth.sub,
    message: req.body?.message,
    clientMessageId: req.body?.clientMessageId,
  });
  res.status(201).json({ success: true, data: result });
});

// ---------------------------------------------------------------------------
// Owner live map (R10)
// ---------------------------------------------------------------------------

export const liveMapController = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getLiveMapSnapshot(req.auth.sub) });
});
