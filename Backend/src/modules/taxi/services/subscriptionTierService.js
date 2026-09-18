import crypto from 'crypto';
import Razorpay from 'razorpay';
import { ApiError } from '../../../utils/ApiError.js';
import { SubscriptionTier } from '../admin/models/SubscriptionTier.js';
import { RideModule } from '../admin/models/RideModule.js';
import { SupportChannelType } from '../admin/models/SupportChannelType.js';
import { TierAuditLog } from '../admin/models/TierAuditLog.js';
import { DriverSubscription } from '../driver/models/DriverSubscription.js';
import { SubscriptionPayment } from '../driver/models/SubscriptionPayment.js';
import { env } from '../../../config/env.js';

const getRazorpayInstance = () => {
  const key_id = String(process.env.RAZORPAY_KEY_ID || 'rzp_test_Sfly3DalsiEPN8').trim();
  const key_secret = String(process.env.RAZORPAY_KEY_SECRET || 'J4MPIKYt342CofanLuPvPvp1').trim();
  return new Razorpay({ key_id, key_secret });
};

/**
 * A captured payment that could not be turned into a plan needs a human. The
 * admin socket reaches whoever is online; the console line is what survives if
 * nobody is.
 */
const notifyAdminsOfRefundDue = async ({ driverId, payment, subscription, reason }) => {
  console.error(
    `[subscriptionTierService] REFUND DUE: driver ${driverId} paid ₹${payment.amount} ` +
      `(order ${payment.razorpay_order_id}) but activation failed with ${reason}. ` +
      `Subscription ${subscription._id} marked pending_refund.`,
  );

  try {
    const { emitToRoom, getAdminRoom } = await import('./dispatchService.js');
    emitToRoom(getAdminRoom(), 'subscription:refund-due', {
      driverId: String(driverId),
      subscriptionId: String(subscription._id),
      paymentId: String(payment._id),
      amount: payment.amount,
      order_id: payment.razorpay_order_id,
      reason,
    });
  } catch (error) {
    console.error('[subscriptionTierService] refund alert failed:', error.message);
  }
};

export const subscriptionTierService = {
  // --- Admin CRUD for Tiers ---
  async getAllTiers(adminView = false) {
    const query = adminView ? {} : { is_active: true };
    return SubscriptionTier.find(query)
      .sort({ display_order: 1, priority_score: -1 })
      .populate('support_channel_type_id')
      .populate('ride_module_ids')
      .lean();
  },

  /**
   * The tier catalogue annotated for one driver: whether they can actually buy
   * each plan today and, for Prime, how many seats their city has left. Without
   * this the app can only show a price list and discover the refusal at
   * checkout.
   */
  async listTiersForDriver(driverId) {
    const tiers = await this.getAllTiers(false);
    if (!driverId) return tiers;

    const { checkTierEligibility } = await import('./driverCategoryService.js');

    return Promise.all(
      tiers.map(async (tier) => {
        try {
          const eligibility = await checkTierEligibility({ driverId, tierId: tier._id });
          return {
            ...tier,
            eligible: eligibility.eligible,
            ineligible_reasons: eligibility.reasons,
            ...(tier.driver_category === 'prime' ? { prime_slots_left: eligibility.slots_left } : {}),
          };
        } catch (error) {
          return { ...tier, eligible: false, ineligible_reasons: ['ELIGIBILITY_CHECK_FAILED'] };
        }
      }),
    );
  },

  async getTierById(tierId) {
    const tier = await SubscriptionTier.findById(tierId)
      .populate('support_channel_type_id')
      .populate('ride_module_ids')
      .lean();
    if (!tier) throw new ApiError(404, 'Subscription tier not found');
    return tier;
  },

  async createTier(payload, adminContext = {}) {
    const {
      name,
      is_default,
      display_order,
      priority_score,
      price_monthly,
      price_yearly,
      commission_percent,
      search_radius_multiplier,
      max_cash_debt_allowed,
      free_cancellations_per_day,
      cancellation_penalty_waived,
      support_channel_type_id,
      ride_module_ids,
      map_icon_asset_url,
      badge_color_hex,
      is_active,
    } = payload;

    if (!String(name || '').trim()) throw new ApiError(400, 'Tier name is required');
    if (commission_percent < 0 || commission_percent > 100) {
      throw new ApiError(400, 'Commission percent must be between 0 and 100');
    }

    const tier = await SubscriptionTier.create({
      name: String(name).trim(),
      is_default: Boolean(is_default),
      display_order: Number(display_order || 0),
      priority_score: Number(priority_score || 0),
      price_monthly: Math.max(0, Number(price_monthly || 0)),
      price_yearly: Math.max(0, Number(price_yearly || 0)),
      commission_percent: Math.min(100, Math.max(0, Number(commission_percent || 0))),
      search_radius_multiplier: Math.max(0.1, Number(search_radius_multiplier || 1.0)),
      max_cash_debt_allowed: Math.max(0, Number(max_cash_debt_allowed || 0)),
      free_cancellations_per_day: Math.max(0, Number(free_cancellations_per_day || 0)),
      cancellation_penalty_waived: Boolean(cancellation_penalty_waived),
      support_channel_type_id: support_channel_type_id || null,
      ride_module_ids: Array.isArray(ride_module_ids) ? ride_module_ids : [],
      map_icon_asset_url: String(map_icon_asset_url || '').trim(),
      badge_color_hex: String(badge_color_hex || '#10B981').trim(),
      is_active: is_active !== undefined ? Boolean(is_active) : true,
    });

    // Enforce Singleton Default Tier
    if (tier.is_default) {
      await SubscriptionTier.updateMany({ _id: { $ne: tier._id } }, { $set: { is_default: false } });
    }

    // Record Audit Log
    await TierAuditLog.create({
      admin_id: adminContext.admin_id || null,
      admin_email: adminContext.admin_email || 'admin',
      tier_id: tier._id,
      action: 'create',
      changes: Object.entries(payload).map(([field, new_value]) => ({ field, old_value: null, new_value })),
      ip_address: adminContext.ip_address || '',
    });

    return tier.toObject();
  },

  async updateTier(tierId, payload, adminContext = {}) {
    const existing = await SubscriptionTier.findById(tierId);
    if (!existing) throw new ApiError(404, 'Subscription tier not found');

    const changes = [];
    Object.keys(payload).forEach((field) => {
      if (payload[field] !== undefined && String(existing[field]) !== String(payload[field])) {
        changes.push({ field, old_value: existing[field], new_value: payload[field] });
      }
    });

    if (payload.commission_percent !== undefined) {
      const comm = Number(payload.commission_percent);
      if (comm < 0 || comm > 100) throw new ApiError(400, 'Commission percent must be between 0 and 100');
    }

    const updated = await SubscriptionTier.findByIdAndUpdate(tierId, { $set: payload }, { new: true }).lean();

    // Enforce Singleton Default Tier
    if (updated.is_default) {
      await SubscriptionTier.updateMany({ _id: { $ne: updated._id } }, { $set: { is_default: false } });
    }

    if (changes.length > 0) {
      await TierAuditLog.create({
        admin_id: adminContext.admin_id || null,
        admin_email: adminContext.admin_email || 'admin',
        tier_id: updated._id,
        action: 'update',
        changes,
        ip_address: adminContext.ip_address || '',
      });
    }

    return updated;
  },

  async deleteTier(tierId, adminContext = {}) {
    const existing = await SubscriptionTier.findById(tierId);
    if (!existing) throw new ApiError(404, 'Subscription tier not found');

    await SubscriptionTier.findByIdAndDelete(tierId);

    await TierAuditLog.create({
      admin_id: adminContext.admin_id || null,
      admin_email: adminContext.admin_email || 'admin',
      tier_id: existing._id,
      action: 'delete',
      changes: [{ field: 'name', old_value: existing.name, new_value: null }],
      ip_address: adminContext.ip_address || '',
    });

    return { success: true };
  },

  // --- CRUD for Ride Modules ---
  async getRideModules() {
    return RideModule.find().sort({ code: 1 }).lean();
  },

  async createRideModule(payload) {
    const { code, display_name, description } = payload;
    if (!code || !display_name) throw new ApiError(400, 'Module code and display name are required');
    const existing = await RideModule.findOne({ code: code.toLowerCase().trim() });
    if (existing) throw new ApiError(400, `Ride module code '${code}' already exists`);
    return RideModule.create({
      code: code.toLowerCase().trim(),
      display_name: display_name.trim(),
      description: String(description || '').trim(),
    });
  },

  async updateRideModule(id, payload) {
    const updated = await RideModule.findByIdAndUpdate(id, { $set: payload }, { new: true }).lean();
    if (!updated) throw new ApiError(404, 'Ride module not found');
    return updated;
  },

  async deleteRideModule(id) {
    await RideModule.findByIdAndDelete(id);
    return { success: true };
  },

  // --- CRUD for Support Channel Types ---
  async getSupportChannelTypes() {
    return SupportChannelType.find().sort({ code: 1 }).lean();
  },

  async createSupportChannelType(payload) {
    const { code, name, description } = payload;
    if (!code || !name) throw new ApiError(400, 'Channel code and name are required');
    return SupportChannelType.create({
      code: code.toLowerCase().trim(),
      name: name.trim(),
      description: String(description || '').trim(),
    });
  },

  async updateSupportChannelType(id, payload) {
    const updated = await SupportChannelType.findByIdAndUpdate(id, { $set: payload }, { new: true }).lean();
    if (!updated) throw new ApiError(404, 'Support channel type not found');
    return updated;
  },

  async deleteSupportChannelType(id) {
    await SupportChannelType.findByIdAndDelete(id);
    return { success: true };
  },

  // --- Driver Effective Tier Resolution ---
  async getEffectiveDriverTier(driverId) {
    const activeSub = await DriverSubscription.findOne({
      driver_id: driverId,
      status: 'active',
      start_date: { $lte: new Date() },
      end_date: { $gte: new Date() },
    })
      .populate('tier_id')
      .populate('queued_tier_id')
      .lean();

    if (activeSub && activeSub.tier_id && activeSub.tier_id.is_active) {
      // Re-populate module codes
      const tier = await SubscriptionTier.findById(activeSub.tier_id._id)
        .populate('ride_module_ids')
        .populate('support_channel_type_id')
        .lean();

      return {
        ...tier,
        subscription: {
          id: activeSub._id,
          billing_cycle: activeSub.billing_cycle,
          start_date: activeSub.start_date,
          end_date: activeSub.end_date,
          status: activeSub.status,
          suppress_renewal_reminders: Boolean(activeSub.suppress_renewal_reminders),
          queued_tier: activeSub.queued_tier_id || null,
          queued_billing_cycle: activeSub.queued_billing_cycle || null,
        },
      };
    }

    // Fallback to Singleton Default Tier (is_default: true)
    const defaultTier = await SubscriptionTier.findOne({ is_default: true, is_active: true })
      .populate('ride_module_ids')
      .populate('support_channel_type_id')
      .lean();

    if (defaultTier) {
      return {
        ...defaultTier,
        subscription: null, // Signals default fallback
      };
    }

    return null; // Blocked if no subscription & no default tier
  },

  // --- Checkout, Verification & Proration ---
  async createSubscriptionCheckout({ driverId, tierId, billingCycle = 'monthly' }) {
    const tier = await SubscriptionTier.findById(tierId);
    if (!tier || !tier.is_active) throw new ApiError(404, 'Selected subscription tier is unavailable');

    // Driver-network tiers carry entry rules (vehicle mix, Prime seat in the
    // city). Check them *before* taking money — refunding a driver who paid for
    // a Prime seat that was already gone is far worse than refusing up front.
    // Imported lazily because driverCategoryService imports this module back.
    const { checkTierEligibility, reservePrimeSlot } = await import('./driverCategoryService.js');
    const eligibility = await checkTierEligibility({ driverId, tierId });

    if (!eligibility.eligible) {
      throw new ApiError(
        eligibility.reasons.includes('PRIME_SLOTS_FULL') ? 409 : 422,
        'You are not eligible for this plan yet',
        { reasons: eligibility.reasons, slots_left: eligibility.slots_left },
        eligibility.reasons[0],
      );
    }

    if (tier.driver_category === 'prime') {
      const { Driver } = await import('../driver/models/Driver.js');
      const driver = await Driver.findById(driverId).select('service_location_id').lean();
      await reservePrimeSlot({ driverId, serviceLocationId: driver?.service_location_id });
    }

    const rawPrice = billingCycle === 'yearly' ? tier.price_yearly : tier.price_monthly;
    let finalAmount = Math.max(0, Number(rawPrice || 0));
    let proratedCredit = 0;

    // Check existing active subscription for upgrade proration
    const currentSub = await DriverSubscription.findOne({
      driver_id: driverId,
      status: 'active',
      start_date: { $lte: new Date() },
      end_date: { $gte: new Date() },
    }).populate('tier_id');

    if (currentSub && currentSub.tier_id) {
      const currentPrice = currentSub.billing_cycle === 'yearly' ? currentSub.tier_id.price_yearly : currentSub.tier_id.price_monthly;

      // If new tier price is higher, apply prorated credit
      if (rawPrice > currentPrice) {
        const totalDurationMs = new Date(currentSub.end_date).getTime() - new Date(currentSub.start_date).getTime();
        const remainingMs = Math.max(0, new Date(currentSub.end_date).getTime() - Date.now());
        if (totalDurationMs > 0 && remainingMs > 0) {
          const unusedFraction = remainingMs / totalDurationMs;
          proratedCredit = Math.round(currentPrice * unusedFraction * 100) / 100;
          finalAmount = Math.max(0, Math.round((rawPrice - proratedCredit) * 100) / 100);
        }
      }
    }

    const rzp = getRazorpayInstance();
    const orderOptions = {
      amount: Math.round(finalAmount * 100), // Razorpay expects amount in paise
      currency: 'INR',
      receipt: `sub_${driverId}_${Date.now()}`.slice(0, 40),
      notes: {
        driverId: String(driverId),
        tierId: String(tierId),
        billingCycle,
        proratedCredit: String(proratedCredit),
      },
    };

    const order = await rzp.orders.create(orderOptions);

    const paymentRecord = await SubscriptionPayment.create({
      driver_id: driverId,
      tier_id: tierId,
      billing_cycle: billingCycle,
      amount: finalAmount,
      currency: 'INR',
      prorated_credit_applied: proratedCredit,
      razorpay_order_id: order.id,
      status: 'created',
    });

    return {
      orderId: order.id,
      amount: finalAmount,
      currency: 'INR',
      keyId: String(process.env.RAZORPAY_KEY_ID || 'rzp_test_Sfly3DalsiEPN8').trim(),
      paymentRecordId: paymentRecord._id,
      proratedCredit,
    };
  },

  async verifySubscriptionPayment({ driverId, razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
    const key_secret = String(process.env.RAZORPAY_KEY_SECRET || 'J4MPIKYt342CofanLuPvPvp1').trim();
    const generatedSignature = crypto
      .createHmac('sha256', key_secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      throw new ApiError(400, 'Razorpay payment signature verification failed');
    }

    return this.activateVerifiedSubscription({
      driverId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });
  },

  async activateVerifiedSubscription({ driverId, razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
    const payment = await SubscriptionPayment.findOne({ razorpay_order_id });
    if (!payment) throw new ApiError(404, 'Subscription payment order record not found');

    // Webhook Idempotency Check
    if (payment.status === 'paid') {
      return { success: true, message: 'Subscription payment already processed' };
    }

    payment.razorpay_payment_id = razorpay_payment_id;
    payment.razorpay_signature = razorpay_signature;
    payment.status = 'paid';
    payment.verified_at = new Date();
    await payment.save();

    const targetTier = await SubscriptionTier.findById(payment.tier_id);
    if (!targetTier) throw new ApiError(404, 'Target subscription tier not found');

    const currentSub = await DriverSubscription.findOne({
      driver_id: driverId,
      status: 'active',
      start_date: { $lte: new Date() },
      end_date: { $gte: new Date() },
    }).populate('tier_id');

    const targetPrice = payment.billing_cycle === 'yearly' ? targetTier.price_yearly : targetTier.price_monthly;
    const currentPrice = currentSub && currentSub.tier_id
      ? currentSub.billing_cycle === 'yearly' ? currentSub.tier_id.price_yearly : currentSub.tier_id.price_monthly
      : 0;

    // Upgrade (or initial purchase) -> Immediate Activation
    if (!currentSub || targetPrice >= currentPrice) {
      if (currentSub) {
        currentSub.status = 'expired';
        await currentSub.save();
      }

      const durationDays = payment.billing_cycle === 'yearly' ? 365 : 30;
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

      const newSub = await DriverSubscription.create({
        driver_id: driverId,
        tier_id: targetTier._id,
        billing_cycle: payment.billing_cycle,
        start_date: startDate,
        end_date: endDate,
        status: 'active',
      });

      payment.driver_subscription_id = newSub._id;
      await payment.save();

      const { applyCategoryFromSubscription } = await import('./driverCategoryService.js');

      try {
        await applyCategoryFromSubscription({ subscription: newSub });
      } catch (error) {
        // The commonest cause is a Prime seat that expired mid-payment and was
        // claimed by someone else. The driver has been charged, so the money
        // must be flagged for refund rather than silently kept, and the
        // subscription must not sit there looking active.
        if (error?.code === 'PRIME_SLOTS_FULL' || error?.code === 'CITY_REQUIRED') {
          newSub.status = 'pending_refund';
          await newSub.save();
          payment.status = 'refund_due';
          await payment.save();

          await notifyAdminsOfRefundDue({ driverId, payment, subscription: newSub, reason: error.code });

          throw new ApiError(
            409,
            'Your payment went through but the plan could not be activated. Support has been notified and a refund is being arranged.',
            { subscriptionId: String(newSub._id), paymentId: String(payment._id) },
            'SUBSCRIPTION_REFUND_DUE',
          );
        }
        throw error;
      }

      return { success: true, activeSubscription: newSub, action: 'activated_immediately' };
    }

    // Downgrade -> Queued for Next Period
    currentSub.queued_tier_id = targetTier._id;
    currentSub.queued_billing_cycle = payment.billing_cycle;
    await currentSub.save();

    payment.driver_subscription_id = currentSub._id;
    await payment.save();

    return { success: true, activeSubscription: currentSub, action: 'queued_for_next_cycle' };
  },

  async handleRazorpayWebhook(eventBody, signatureHeader) {
    const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || 'secret123').trim();
    if (webhookSecret) {
      const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(eventBody)).digest('hex');
      if (expectedSignature !== signatureHeader) {
        throw new ApiError(400, 'Invalid webhook signature');
      }
    }

    const event = eventBody?.event;
    if (event === 'payment.captured' || event === 'order.paid') {
      const entity = eventBody?.payload?.payment?.entity || eventBody?.payload?.order?.entity;
      const order_id = entity?.order_id || entity?.id;
      const payment_id = entity?.id || `pay_${Date.now()}`;

      if (order_id) {
        const paymentRecord = await SubscriptionPayment.findOne({ razorpay_order_id: order_id });
        if (paymentRecord && paymentRecord.status !== 'paid') {
          await this.activateVerifiedSubscription({
            driverId: paymentRecord.driver_id,
            razorpay_order_id: order_id,
            razorpay_payment_id: payment_id,
            razorpay_signature: 'webhook_verified',
          });
        }
      }
    }

    return { received: true };
  },

  async toggleRenewalReminders(driverId) {
    const sub = await DriverSubscription.findOne({ driver_id: driverId, status: 'active' });
    if (!sub) throw new ApiError(404, 'No active subscription found to update');

    sub.suppress_renewal_reminders = !sub.suppress_renewal_reminders;
    await sub.save();

    return { suppress_renewal_reminders: sub.suppress_renewal_reminders };
  },
};
