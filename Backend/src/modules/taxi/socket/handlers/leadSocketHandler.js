import {
  assertLeadConversationAccess,
  getLeadRoom,
  markLeadConversationRead,
  postLeadMessage,
} from '../../driver/services/leadService.js';
import { SOCKET_EVENTS } from '../events.js';

/**
 * Realtime side of lead chat — the conversation a driver opens about a ride
 * they have not been assigned yet. Separate from the in-ride `ride:message:*`
 * channel, which only exists once a driver has actually won the trip.
 */
export const registerLeadSocketHandlers = ({ socket, onAsync }) => {
  socket.on(
    SOCKET_EVENTS.LEAD_JOIN,
    onAsync(socket, async ({ conversationId }) => {
      if (!['driver', 'user'].includes(socket.auth.role)) {
        throw new Error('Only riders and drivers can join a lead conversation');
      }

      await assertLeadConversationAccess({
        conversationId,
        role: socket.auth.role,
        entityId: socket.auth.sub,
      });

      socket.join(getLeadRoom(conversationId));
      socket.emit(SOCKET_EVENTS.LEAD_JOINED, { conversationId: String(conversationId) });
    }),
  );

  socket.on(
    SOCKET_EVENTS.LEAD_MESSAGE_SEND,
    onAsync(socket, async ({ conversationId, message, clientMessageId }) => {
      // `postLeadMessage` does the participant check, the closed-conversation
      // check, the rate limit and the fan-out, so the socket path and the REST
      // path cannot drift apart.
      await postLeadMessage({
        conversationId,
        role: socket.auth.role,
        entityId: socket.auth.sub,
        message,
        clientMessageId,
      });
    }),
  );

  socket.on(
    SOCKET_EVENTS.LEAD_READ,
    onAsync(socket, async ({ conversationId }) => {
      await markLeadConversationRead({
        conversationId,
        role: socket.auth.role,
        entityId: socket.auth.sub,
      });
    }),
  );
};
