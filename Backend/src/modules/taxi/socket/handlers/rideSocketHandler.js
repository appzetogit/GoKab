import { normalizePoint } from '../../../../utils/geo.js';
import { RIDE_LIVE_STATUS } from '../../constants/index.js';
import { getDriverRoom } from '../../services/dispatchService.js';
import {
  appendRideMessage,
  getActiveRideForIdentity,
  getRideDetails,
  getRideRoom,
  serializeRideRealtime,
  updateRideDriverLocation,
  updateRideLifecycle,
} from '../../services/rideService.js';
import { authorizeRideRoomAccess } from '../middleware/rideRoomAuth.js';
import { SOCKET_EVENTS } from '../events.js';
import { clearDriverRoute, updateDriverRoute } from '../services/driverRouteService.js';

const driverLifecycleStatuses = new Set([
  RIDE_LIVE_STATUS.ACCEPTED,
  RIDE_LIVE_STATUS.ARRIVING,
  RIDE_LIVE_STATUS.STARTED,
  RIDE_LIVE_STATUS.ARRIVED,
  RIDE_LIVE_STATUS.COMPLETED,
]);

export const registerRideSocketHandlers = ({ io, socket, onAsync }) => {
  const emitRideState = (ride) => {
    const payload = serializeRideRealtime(ride);
    io.to(getRideRoom(ride._id)).emit(SOCKET_EVENTS.RIDE_STATE, payload);
    return payload;
  };

  socket.on(
    SOCKET_EVENTS.RIDE_JOIN,
    onAsync(socket, async ({ rideId }) => {
      if (!rideId) {
        throw new Error('rideId is required');
      }

      const ride = await authorizeRideRoomAccess({ socket, rideId });
      const room = getRideRoom(ride._id);
      socket.join(room);

      socket.emit(SOCKET_EVENTS.RIDE_JOINED, {
        rideId: String(ride._id),
        room,
      });

      const activeRide = await getActiveRideForIdentity({
        role: socket.auth.role,
        entityId: socket.auth.sub,
      });

      if (activeRide && String(activeRide._id) === String(ride._id)) {
        socket.emit(SOCKET_EVENTS.RIDE_STATE, serializeRideRealtime(activeRide));
      }
    }),
  );

  socket.on(
    SOCKET_EVENTS.RIDE_REJOIN_CURRENT,
    onAsync(socket, async () => {
      const ride = await getActiveRideForIdentity({
        role: socket.auth.role,
        entityId: socket.auth.sub,
      });

      if (!ride) {
        socket.emit(SOCKET_EVENTS.RIDE_STATE, null);
        return;
      }

      const room = getRideRoom(ride._id);
      socket.join(room);
      socket.emit(SOCKET_EVENTS.RIDE_JOINED, {
        rideId: String(ride._id),
        room,
        rejoined: true,
      });
      socket.emit(SOCKET_EVENTS.RIDE_STATE, serializeRideRealtime(ride));
    }),
  );

  socket.on(
    SOCKET_EVENTS.RIDE_DRIVER_LOCATION_UPDATE,
    onAsync(socket, async ({ rideId, coordinates, heading, speed }) => {
      if (socket.auth.role !== 'driver') {
        throw new Error('Only drivers can update live ride location');
      }

      await authorizeRideRoomAccess({ socket, rideId });

      const locationUpdate = await updateRideDriverLocation({
        rideId,
        driverId: socket.auth.sub,
        coordinates: normalizePoint(coordinates, 'coordinates'),
        heading,
        speed,
      });

      io.to(getRideRoom(rideId)).emit(SOCKET_EVENTS.RIDE_DRIVER_LOCATION_UPDATED, locationUpdate);

      updateDriverRoute({
        io,
        rideId,
        driverId: socket.auth.sub,
        coordinates: locationUpdate.coordinates,
      });
    }),
  );

  socket.on(
    SOCKET_EVENTS.RIDE_STATUS_UPDATE,
    onAsync(socket, async ({ rideId, status, paymentMethod }) => {
      if (socket.auth.role !== 'driver') {
        throw new Error('Only drivers can update ride status');
      }

      if (!driverLifecycleStatuses.has(status)) {
        throw new Error('Unsupported ride status transition');
      }

      await authorizeRideRoomAccess({ socket, rideId });

      const ride = await updateRideLifecycle({
        rideId,
        driverId: socket.auth.sub,
        nextStatus: status,
        paymentMethod,
      });
      const populatedRide = await getRideDetails(rideId);

      const payload = {
        rideId: String(populatedRide._id),
        status: populatedRide.status,
        liveStatus: populatedRide.liveStatus,
        acceptedAt: populatedRide.acceptedAt,
        arrivedAt: populatedRide.arrivedAt,
        startedAt: populatedRide.startedAt,
        completedAt: populatedRide.completedAt,
      };

      io.to(getRideRoom(rideId)).emit(SOCKET_EVENTS.RIDE_STATUS_UPDATED, payload);
      emitRideState(populatedRide);

      if (status === RIDE_LIVE_STATUS.COMPLETED) {
        const walletUpdate = ride.$locals?.walletUpdate;
        if (walletUpdate) {
          io.to(getDriverRoom(socket.auth.sub)).emit('driver:wallet:updated', {
            wallet: walletUpdate.wallet,
            transaction: walletUpdate.transaction,
          });
        }
        clearDriverRoute(socket.auth.sub);
      }
    }),
  );

  socket.on(
    SOCKET_EVENTS.RIDE_MESSAGE_SEND,
    onAsync(socket, async ({ rideId, message }) => {
      await authorizeRideRoomAccess({ socket, rideId });

      const savedMessage = await appendRideMessage({
        rideId,
        role: socket.auth.role,
        senderId: socket.auth.sub,
        message,
      });

      io.to(getRideRoom(rideId)).emit(SOCKET_EVENTS.RIDE_MESSAGE_NEW, savedMessage);
    }),
  );
};
