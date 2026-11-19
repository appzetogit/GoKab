import { sendPushNotificationToEntities } from './pushNotificationService.js';
import { emitToAdmins, emitToDriver } from './dispatchService.js';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Tells the admin panel (live, to whoever is online) that a payout needs a decision. */
export const notifyAdminsOfWithdrawal = ({ request, driverName = '' }) => {
  try {
    emitToAdmins('withdrawal:requested', {
      requestId: String(request._id),
      driverId: String(request.driver_id || ''),
      driverName,
      amount: request.amount,
      paymentMethod: request.payment_method,
      createdAt: request.createdAt,
    });
  } catch (error) {
    console.error('[withdrawal] admin alert failed:', error.message);
  }
  // The console line survives when no admin is online.
  console.log(`[withdrawal] NEW REQUEST ${request.transactionId}: ${driverName || request.driver_id} asked for ${money(request.amount)}`);
};

/** Tells the driver what the admin decided. */
export const notifyDriverOfWithdrawalDecision = async ({ request, approved }) => {
  if (!request?.driver_id) return;
  const amount = money(request.amount);
  const title = approved ? 'Withdrawal approved' : 'Withdrawal request declined';
  const body = approved
    ? `${amount} is on its way to your bank or UPI. It has been deducted from your wallet.`
    : `Your ${amount} withdrawal request was declined. Your wallet balance is unchanged. Contact support if you need help.`;
  emitToDriver(request.driver_id, 'driver:withdrawal:updated', {
    requestId: String(request._id),
    status: approved ? 'completed' : 'cancelled',
    amount: request.amount,
  });
  await sendPushNotificationToEntities({
    driverIds: [String(request.driver_id)],
    title,
    body,
    data: { type: approved ? 'withdrawal_approved' : 'withdrawal_rejected', requestId: String(request._id) },
  }).catch(() => {});
};
