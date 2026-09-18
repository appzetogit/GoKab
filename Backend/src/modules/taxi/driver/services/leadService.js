import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { RIDE_STATUS } from '../../constants/index.js';
import { Ride } from '../../user/models/Ride.js';
import { User } from '../../user/models/User.js';
import { Driver } from '../models/Driver.js';
import { LeadContact } from '../models/LeadContact.js';
import { LeadConversation } from '../models/LeadConversation.js';
import { LeadMessage } from '../models/LeadMessage.js';
import { getDriverNetworkSettings } from '../../services/appSettingsService.js';
import { getDriverPermissions } from '../../services/driverCategoryService.js';
import { applyDriverWalletAdjustment, getWalletSnapshot } from './walletService.js';
import { emitToRoom, getDriverRoom, getUserRoom } from '../../services/dispatchService.js';
import { sendPushNotificationToEntities } from '../../services/pushNotificationService.js';

const MESSAGE_RATE_LIMIT = 20;
const MESSAGE_RATE_WINDOW_MS = 60 * 1000;

export const getLeadRoom = (conversationId) => `lead_${conversationId}`;

const assertLeadStillOpen = (ride) => {
  if (ride.origin === 'driver_created') {
    if (ride.publish?.status !== 'open') {
      throw new ApiError(409, 'This ride is no longer open', null, 'RIDE_NOT_OPEN');
    }
    if (ride.publish?.expires_at && ride.publish.expires_at < new Date()) {
      throw new ApiError(409, 'This lead has expired', null, 'RIDE_NOT_OPEN');
    }
    return;
  }

  if (ride.status !== RIDE_STATUS.SEARCHING || ride.driverId) {
    throw new ApiError(409, 'This ride already has a driver', null, 'RIDE_NOT_OPEN');
  }
};

const resolveTarget = (ride) => {
  if (ride.origin === 'driver_created') {
    return { role: 'driver', id: ride.created_by_driver_id, leadType: 'driver' };
  }
  return { role: 'user', id: ride.userId, leadType: 'customer' };
};

/**
 * Unlocks a lead for one driver: charges the tier's contact fee (once per ride),
 * opens a conversation and reveals the phone number.
 *
 * Chat and call share one payment — the fee buys access to the lead, not to a
 * particular channel — which is what the unique index on LeadContact enforces.
 */
export const openLeadContact = async ({ driverId, rideId, channel = 'chat' }) => {
  if (!['chat', 'call'].includes(channel)) {
    throw new ApiError(422, "channel must be 'chat' or 'call'", null, 'INVALID_CHANNEL');
  }

  const ride = await Ride.findById(rideId).lean();
  if (!ride) throw new ApiError(404, 'Ride not found', null, 'RIDE_NOT_FOUND');

  const target = resolveTarget(ride);
  if (String(target.id || '') === String(driverId)) {
    throw new ApiError(409, 'This is your own ride', null, 'RIDE_NOT_OPEN');
  }

  assertLeadStillOpen(ride);

  const permissions = await getDriverPermissions(driverId);
  const settings = await getDriverNetworkSettings();
  const fee =
    target.leadType === 'customer'
      ? permissions.customer_lead_contact_fee
      : permissions.driver_lead_contact_fee;

  const existing = await LeadContact.findOne({ ride_id: ride._id, requester_driver_id: driverId });

  let feeCharged = 0;
  let contact = existing;

  if (!existing) {
    if (fee > 0) {
      const wallet = await getWalletSnapshot(permissions.driver);
      if (wallet.available < fee) {
        throw new ApiError(
          402,
          `You need ₹${fee} available to contact this lead`,
          { required: fee, available: wallet.available },
          'INSUFFICIENT_WALLET_FOR_CONTACT',
        );
      }
    }

    try {
      [contact] = await LeadContact.create([
        {
          ride_id: ride._id,
          requester_driver_id: driverId,
          lead_type: target.leadType,
          target_role: ride.origin === 'driver_created' ? 'driver' : 'user',
          target_id: target.id,
          channels_used: [channel],
          fee_charged: fee,
        },
      ]);
    } catch (error) {
      // Two taps in quick succession: the unique index means only one row is
      // created, and the loser must not be charged a second time.
      if (error?.code !== 11000) throw error;
      contact = await LeadContact.findOne({ ride_id: ride._id, requester_driver_id: driverId });
      return buildContactResponse({ ride, contact, target, fee: 0, permissions, settings, channel });
    }

    if (fee > 0) {
      const charge = await applyDriverWalletAdjustment({
        driverId,
        amount: -fee,
        type: 'lead_contact_fee',
        rideId: ride._id,
        description: 'Fee to contact a lead',
        metadata: { leadType: target.leadType },
      });
      contact.wallet_txn_id = charge.transaction._id;
      await contact.save();
      feeCharged = fee;
    }
  } else if (!existing.channels_used.includes(channel)) {
    existing.channels_used.push(channel);
    await existing.save();
  }

  return buildContactResponse({ ride, contact, target, fee: feeCharged, permissions, settings, channel });
};

const buildContactResponse = async ({ ride, contact, target, fee, permissions, settings, channel }) => {
  let conversationId = contact.conversation_id;

  if (channel === 'chat' && !conversationId) {
    const conversation = await LeadConversation.create({
      ride_id: ride._id,
      participants: [
        { role: 'driver', id: contact.requester_driver_id },
        { role: target.role, id: target.id },
      ],
    });
    conversationId = conversation._id;
    contact.conversation_id = conversationId;
    await contact.save();

    await notifyLeadInterest({ ride, target, requesterDriverId: contact.requester_driver_id, conversationId });
  }

  let phone = '';
  if (channel === 'call') {
    if (target.role === 'driver') {
      phone = (await Driver.findById(target.id).select('phone').lean())?.phone || '';
    } else if (ride.userId) {
      phone = (await User.findById(ride.userId).select('phone').lean())?.phone || '';
    } else {
      phone = ride.offline_customer?.phone || '';
    }
  }

  const wallet = await getWalletSnapshot(permissions.driver);

  return {
    fee_charged: fee,
    wallet_balance: wallet.balance,
    wallet_available: wallet.available,
    conversation_id: conversationId ? String(conversationId) : null,
    call:
      channel === 'call'
        ? {
            // Masked calling needs a telephony provider; until one is wired up
            // the number is revealed, which is also the configured default.
            mode: settings.call_mode === 'masked' ? 'masked' : 'reveal',
            phone: settings.call_mode === 'masked' ? '' : phone,
            ...(settings.call_mode === 'masked'
              ? { unavailable_reason: 'MASKED_CALLING_NOT_CONFIGURED' }
              : {}),
          }
        : null,
  };
};

const notifyLeadInterest = async ({ ride, target, requesterDriverId, conversationId }) => {
  const requester = await Driver.findById(requesterDriverId).select('name').lean();
  const title = `${requester?.name || 'A driver'} is interested in your ride`;
  const body = `${ride.pickupAddress || 'Pickup'} → ${ride.dropAddress || 'Drop'}`;
  const data = {
    type: 'lead_interest',
    rideId: String(ride._id),
    conversationId: String(conversationId),
  };

  if (target.role === 'driver') {
    emitToRoom(getDriverRoom(target.id), 'lead:interest', data);
    await sendPushNotificationToEntities({ driverIds: [String(target.id)], title, body, data }).catch(() => {});
    return;
  }

  if (target.id) {
    emitToRoom(getUserRoom(target.id), 'lead:interest', data);
    await sendPushNotificationToEntities({ userIds: [String(target.id)], title, body, data }).catch(() => {});
  }
};

const assertParticipant = (conversation, { role, id }) => {
  const isParticipant = (conversation.participants || []).some(
    (participant) => participant.role === role && String(participant.id) === String(id),
  );

  if (!isParticipant) {
    throw new ApiError(403, 'You are not part of this conversation', null, 'NOT_A_PARTICIPANT');
  }
};

export const listLeadConversations = async ({ role, entityId, page = 1, limit = 20 }) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));

  const filter = { participants: { $elemMatch: { role, id: new mongoose.Types.ObjectId(String(entityId)) } } };

  const [conversations, total] = await Promise.all([
    LeadConversation.find(filter)
      .sort({ last_message_at: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    LeadConversation.countDocuments(filter),
  ]);

  const rides = await Ride.find({ _id: { $in: conversations.map((item) => item.ride_id) } })
    .select('pickupAddress dropAddress publish status fare')
    .lean();
  const rideMap = new Map(rides.map((ride) => [String(ride._id), ride]));

  return {
    results: conversations.map((conversation) => {
      const ride = rideMap.get(String(conversation.ride_id));
      return {
        id: String(conversation._id),
        ride: ride
          ? {
              id: String(ride._id),
              pickup: ride.pickupAddress || '',
              drop: ride.dropAddress || '',
              amount: ride.publish?.driver_payout || ride.fare,
              status: ride.status,
            }
          : null,
        last_message: conversation.last_message || '',
        last_message_at: conversation.last_message_at,
        closed: Boolean(conversation.closed),
      };
    }),
    pagination: { page: safePage, limit: safeLimit, total },
  };
};

export const listLeadMessages = async ({ conversationId, role, entityId, before, limit = 30 }) => {
  const conversation = await LeadConversation.findById(conversationId).lean();
  if (!conversation) throw new ApiError(404, 'Conversation not found', null, 'CONVERSATION_NOT_FOUND');
  assertParticipant(conversation, { role, id: entityId });

  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const filter = { conversation_id: conversation._id };
  if (before) filter.createdAt = { $lt: new Date(before) };

  const messages = await LeadMessage.find(filter).sort({ createdAt: -1 }).limit(safeLimit).lean();

  await LeadConversation.updateOne(
    { _id: conversation._id, 'participants.role': role, 'participants.id': entityId },
    { $set: { 'participants.$.last_read_at': new Date() } },
  );

  return {
    closed: Boolean(conversation.closed),
    results: messages.reverse().map((message) => ({
      id: String(message._id),
      senderRole: message.sender_role,
      senderId: String(message.sender_id),
      message: message.message,
      createdAt: message.createdAt,
    })),
  };
};

/**
 * Posts into a lead conversation.
 *
 * A closed conversation stays readable but rejects new messages — once a ride
 * is taken, the losing bidders must stop pitching for it. The exception is the
 * pair who actually got matched, who keep talking on the ride itself.
 */
export const postLeadMessage = async ({ conversationId, role, entityId, message, clientMessageId = null }) => {
  const text = String(message || '').trim();
  if (!text) throw new ApiError(422, 'Message cannot be empty', null, 'EMPTY_MESSAGE');
  if (text.length > 1000) throw new ApiError(422, 'Message is too long', null, 'MESSAGE_TOO_LONG');

  const conversation = await LeadConversation.findById(conversationId);
  if (!conversation) throw new ApiError(404, 'Conversation not found', null, 'CONVERSATION_NOT_FOUND');
  assertParticipant(conversation, { role, id: entityId });

  if (conversation.closed) {
    throw new ApiError(409, 'This conversation is closed', null, 'CONVERSATION_CLOSED');
  }

  const recentCount = await LeadMessage.countDocuments({
    conversation_id: conversation._id,
    sender_id: entityId,
    createdAt: { $gt: new Date(Date.now() - MESSAGE_RATE_WINDOW_MS) },
  });
  if (recentCount >= MESSAGE_RATE_LIMIT) {
    throw new ApiError(429, 'You are sending messages too quickly', null, 'RATE_LIMITED');
  }

  const created = await LeadMessage.create({
    conversation_id: conversation._id,
    sender_role: role,
    sender_id: entityId,
    message: text,
  });

  conversation.last_message = text;
  conversation.last_message_at = created.createdAt;
  await conversation.save();

  const payload = {
    id: String(created._id),
    conversationId: String(conversation._id),
    senderRole: role,
    senderId: String(entityId),
    message: text,
    createdAt: created.createdAt,
    clientMessageId,
  };

  emitToRoom(getLeadRoom(conversation._id), 'lead:message:new', payload);

  // Also delivered to each participant's own room so an app that has not opened
  // the thread still gets the message.
  for (const participant of conversation.participants) {
    if (String(participant.id) === String(entityId)) continue;
    const room = participant.role === 'driver' ? getDriverRoom(participant.id) : getUserRoom(participant.id);
    emitToRoom(room, 'lead:message:new', payload);

    if (participant.role === 'driver') {
      await sendPushNotificationToEntities({
        driverIds: [String(participant.id)],
        title: 'New message about a ride',
        body: text.slice(0, 120),
        data: { type: 'lead_message', conversationId: String(conversation._id) },
      }).catch(() => {});
    } else {
      await sendPushNotificationToEntities({
        userIds: [String(participant.id)],
        title: 'New message about your ride',
        body: text.slice(0, 120),
        data: { type: 'lead_message', conversationId: String(conversation._id) },
      }).catch(() => {});
    }
  }

  return payload;
};

export const markLeadConversationRead = async ({ conversationId, role, entityId }) => {
  const conversation = await LeadConversation.findById(conversationId).lean();
  if (!conversation) throw new ApiError(404, 'Conversation not found', null, 'CONVERSATION_NOT_FOUND');
  assertParticipant(conversation, { role, id: entityId });

  await LeadConversation.updateOne(
    { _id: conversation._id, 'participants.role': role, 'participants.id': entityId },
    { $set: { 'participants.$.last_read_at': new Date() } },
  );

  return { read: true };
};

export const assertLeadConversationAccess = async ({ conversationId, role, entityId }) => {
  const conversation = await LeadConversation.findById(conversationId).lean();
  if (!conversation) throw new ApiError(404, 'Conversation not found', null, 'CONVERSATION_NOT_FOUND');
  assertParticipant(conversation, { role, id: entityId });
  return conversation;
};
