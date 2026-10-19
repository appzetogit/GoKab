/**
 * Shared by the smoke tests: pays a completed ride the way the rider app does,
 * through POST /rides/:rideId/complete-payment/wallet. A platform-collected
 * published ride only settles once its payment is verified, so tests that
 * expect platform payouts must pay first.
 *
 * Tops the rider's wallet up by the fare directly in the test database first,
 * and signs the rider's token with the backend's token service, so the calling
 * script must share the server's JWT_SECRET (the smoke scripts already do).
 *
 * Not a test on its own.
 */
export const payRideAsRider = async ({ api, rideId }) => {
  const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
  const { UserWallet } = await import('../src/modules/taxi/user/models/UserWallet.js');
  const { signAccessToken } = await import('../src/modules/taxi/services/tokenService.js');

  const ride = await Ride.findById(rideId).select('userId fare').lean();
  if (!ride?.userId) {
    throw new Error(`payRideAsRider: ride ${rideId} has no app rider`);
  }

  await UserWallet.updateOne(
    { userId: ride.userId },
    { $inc: { balance: Number(ride.fare || 0) }, $setOnInsert: { refundWallet: 0, transactions: [] } },
    { upsert: true },
  );

  const token = signAccessToken({ sub: String(ride.userId), role: 'user' });
  return api(`/rides/${rideId}/complete-payment/wallet`, { method: 'POST', token, body: { rating: 5 } });
};
