import { Router } from 'express';
import { asyncHandler } from '../../../../utils/asyncHandler.js';
import { authenticate } from '../../middlewares/authMiddleware.js';
import { requireDriverPermission } from '../../middlewares/driverCategoryMiddleware.js';
import {
  liveMapController,
  contactLeadController,
  listDriverLeadConversationsController,
  listDriverLeadMessagesController,
  postDriverLeadMessageController,
  acceptFeedRideController,
  disputeEscrowController,
  getFeedController,
  publishRideController,
  unpublishRideController,
  assignNetworkRideController,
  cancelNetworkRideController,
  createNetworkRideController,
  fleetAvailabilityController,
  listNetworkRidesController,
  reassignNetworkRideController,
  rejectNetworkAssignmentController,
  unassignNetworkRideController,
  updateOrganizationController,
  createDriverRouteController,
  deleteDriverRouteController,
  getDriverCategoryController,
  listDriverRoutesController,
  setDriverRouteModeController,
  updateDriverRouteController,
} from '../controllers/networkController.js';

/**
 * Driver-network endpoints. Mounted on the existing `/drivers` router rather
 * than a new top-level prefix so the driver app keeps one base URL.
 */
export const networkRouter = Router();

const driverOnly = authenticate(['driver']);

networkRouter.get('/category', driverOnly, asyncHandler(getDriverCategoryController));

networkRouter.get('/routes', driverOnly, asyncHandler(listDriverRoutesController));
networkRouter.post('/routes', driverOnly, asyncHandler(createDriverRouteController));
networkRouter.patch('/route-mode', driverOnly, asyncHandler(setDriverRouteModeController));
networkRouter.patch('/routes/:routeId', driverOnly, asyncHandler(updateDriverRouteController));
networkRouter.delete('/routes/:routeId', driverOnly, asyncHandler(deleteDriverRouteController));

// Driver-created rides. `can_create_rides` is a tier permission, so the gate
// lives in middleware rather than inside each handler.
const canCreateRides = requireDriverPermission('can_create_rides');

networkRouter.patch(
  '/organization',
  driverOnly,
  requireDriverPermission('can_manage_fleet'),
  asyncHandler(updateOrganizationController),
);

networkRouter.get('/network/rides', driverOnly, asyncHandler(listNetworkRidesController));
networkRouter.post('/network/rides', driverOnly, canCreateRides, asyncHandler(createNetworkRideController));
networkRouter.get(
  '/network/fleet/availability',
  driverOnly,
  requireDriverPermission('can_manage_fleet'),
  asyncHandler(fleetAvailabilityController),
);

networkRouter.post('/network/rides/:rideId/assign', driverOnly, canCreateRides, asyncHandler(assignNetworkRideController));
networkRouter.post('/network/rides/:rideId/unassign', driverOnly, canCreateRides, asyncHandler(unassignNetworkRideController));
networkRouter.post('/network/rides/:rideId/reassign', driverOnly, canCreateRides, asyncHandler(reassignNetworkRideController));
networkRouter.post('/network/rides/:rideId/cancel', driverOnly, canCreateRides, asyncHandler(cancelNetworkRideController));
// Declining is done by the *assigned* driver, who may be any category, so this
// one is deliberately not gated on a tier permission.
networkRouter.post(
  '/network/rides/:rideId/reject-assignment',
  driverOnly,
  asyncHandler(rejectNetworkAssignmentController),
);

// Publish & feed. The feed itself is open to every category — that is the point
// of the network — so only publishing is gated.
networkRouter.post(
  '/network/rides/:rideId/publish',
  driverOnly,
  requireDriverPermission('can_publish_rides'),
  asyncHandler(publishRideController),
);
networkRouter.delete(
  '/network/rides/:rideId/publish',
  driverOnly,
  requireDriverPermission('can_publish_rides'),
  asyncHandler(unpublishRideController),
);
networkRouter.post(
  '/network/rides/:rideId/escrow/dispute',
  driverOnly,
  asyncHandler(disputeEscrowController),
);

networkRouter.get('/feed', driverOnly, asyncHandler(getFeedController));
networkRouter.post('/feed/rides/:rideId/accept', driverOnly, asyncHandler(acceptFeedRideController));

// Lead contact & chat.
networkRouter.post('/feed/rides/:rideId/contact', driverOnly, asyncHandler(contactLeadController));
networkRouter.get('/lead-conversations', driverOnly, asyncHandler(listDriverLeadConversationsController));
networkRouter.get(
  '/lead-conversations/:conversationId/messages',
  driverOnly,
  asyncHandler(listDriverLeadMessagesController),
);
networkRouter.post(
  '/lead-conversations/:conversationId/messages',
  driverOnly,
  asyncHandler(postDriverLeadMessageController),
);

// Owner live map.
networkRouter.get('/network/live-map', driverOnly, asyncHandler(liveMapController));
