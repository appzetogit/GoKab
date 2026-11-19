import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { Vehicle } from '../../admin/models/Vehicle.js';
import { LeadContact } from '../../driver/models/LeadContact.js';
import { LeadConversation } from '../../driver/models/LeadConversation.js';
import { emitToRoom, getUserRoom } from '../../services/dispatchService.js';
import { sendPushNotificationToEntities } from '../../services/pushNotificationService.js';
import { TripPost } from '../models/TripPost.js';

const MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

const point = (value) => {
  const coords = value?.coordinates;
  return Array.isArray(coords) && coords.length === 2 && coords.every((n) => Number.isFinite(Number(n)))
    ? { type: 'Point', coordinates: coords.map(Number) }
    : undefined;
};

const serializePosts = async (posts) => {
  const ids = posts.map((p) => p._id);
  const vehicleIds = posts.map((p) => p.vehicleTypeId).filter(Boolean);
  const [vehicles, counts] = await Promise.all([
    vehicleIds.length ? Vehicle.find({ _id: { $in: vehicleIds } }).select('name').lean() : [],
    LeadContact.aggregate([{ $match: { ride_id: { $in: ids } } }, { $group: { _id: '$ride_id', n: { $sum: 1 } } }]),
  ]);
  const vehicleName = new Map(vehicles.map((v) => [String(v._id), v.name]));
  const interested = new Map(counts.map((c) => [String(c._id), c.n]));
  return posts.map((p) => ({
    id: String(p._id),
    pickupAddress: p.pickupAddress,
    dropAddress: p.dropAddress,
    scheduledAt: p.scheduledAt,
    vehicleTypeId: p.vehicleTypeId ? String(p.vehicleTypeId) : null,
    vehicleName: vehicleName.get(String(p.vehicleTypeId)) || '',
    passengers: p.passengers,
    budget: p.budget,
    note: p.note,
    status: p.status,
    interestedCount: interested.get(String(p._id)) || 0,
    createdAt: p.createdAt,
  }));
};

export const createTripPost = async (userId, body = {}) => {
  const pickupAddress = String(body.pickupAddress || '').trim();
  const dropAddress = String(body.dropAddress || '').trim();
  if (!pickupAddress || !dropAddress) {
    throw new ApiError(422, 'Pickup and drop are required', null, 'ADDRESS_REQUIRED');
  }
  const scheduledAt = new Date(body.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 5 * 60 * 1000) {
    throw new ApiError(422, 'Pick a trip time at least 5 minutes from now', null, 'INVALID_TRIP_TIME');
  }
  if (scheduledAt.getTime() > Date.now() + MAX_AHEAD_MS) {
    throw new ApiError(422, 'Trips can be posted up to 7 days ahead', null, 'INVALID_TRIP_TIME');
  }

  const post = await TripPost.create({
    user_id: userId,
    pickupAddress,
    dropAddress,
    pickupLocation: point(body.pickupLocation),
    dropLocation: point(body.dropLocation),
    scheduledAt,
    vehicleTypeId: mongoose.isValidObjectId(body.vehicleTypeId) ? body.vehicleTypeId : null,
    passengers: Math.min(20, Math.max(1, Number(body.passengers) || 1)),
    budget: Math.max(0, Number(body.budget) || 0),
    note: String(body.note || '').slice(0, 300),
  });
  return (await serializePosts([post.toObject()]))[0];
};

export const listMyTripPosts = async (userId) =>
  serializePosts(await TripPost.find({ user_id: userId }).sort({ createdAt: -1 }).limit(50).lean());

const closeConversations = (postIds) =>
  LeadConversation.updateMany({ ride_id: { $in: postIds } }, { $set: { closed: true } });

export const closeTripPost = async (userId, postId) => {
  const post = mongoose.isValidObjectId(postId) ? await TripPost.findOne({ _id: postId, user_id: userId }) : null;
  if (!post) throw new ApiError(404, 'Trip post not found', null, 'POST_NOT_FOUND');
  if (post.status === 'open') {
    post.status = 'closed';
    post.closed_at = new Date();
    await post.save();
    await closeConversations([post._id]);
  }
  return (await serializePosts([post.toObject()]))[0];
};

/** Posts expire at their pickup time: hide them from drivers and tell the rider. */
export const expireTripPosts = async () => {
  const due = await TripPost.find({ status: 'open', scheduledAt: { $lte: new Date() } }).limit(200).lean();
  let expired = 0;
  for (const post of due) {
    const res = await TripPost.updateOne({ _id: post._id, status: 'open' }, { $set: { status: 'expired' } });
    if (!res.modifiedCount) continue;
    expired += 1;
    await closeConversations([post._id]);
    const data = { type: 'trip_post_expired', postId: String(post._id) };
    emitToRoom(getUserRoom(post.user_id), 'trip_post:expired', data);
    await sendPushNotificationToEntities({
      userIds: [String(post.user_id)],
      title: 'Your trip post has expired',
      body: `${post.pickupAddress} to ${post.dropAddress}: the pickup time has passed. Post again if you still need a ride.`,
      data,
    }).catch(() => {});
  }
  return { expiredTripPosts: expired };
};
