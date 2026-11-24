import { ApiError } from '../../../../utils/ApiError.js';
import { isPlanRulesEnabled } from '../../services/appSettingsService.js';
import { canGenerateBills, indianMonth } from '../../services/planBenefits.js';
import { subscriptionTierService } from '../../services/subscriptionTierService.js';
import { Driver } from '../models/Driver.js';
import { DriverBillUsage } from '../models/DriverBill.js';

/** Whose plan pays for this driver's bills: a team member uses their lead's, everyone else their own. */
const findPlanHolderId = async (driverId) => {
  const driver = await Driver.findById(driverId).select('owner_id is_self_drive_owner').lean();
  if (!driver?.owner_id || driver.is_self_drive_owner === true) return String(driverId);

  const lead = await Driver.findOne({ owner_id: driver.owner_id, is_self_drive_owner: true, deletedAt: null })
    .select('_id')
    .lean();
  return String(lead?._id || driverId);
};

const usageId = (holderId) => `${holderId}:${indianMonth()}`;

const loadRules = async (driverId) => {
  const holderId = await findPlanHolderId(driverId);
  const tier = await subscriptionTierService.getEffectiveDriverTier(holderId);
  return {
    holderId,
    planName: tier?.name || '',
    allowed: canGenerateBills(tier),
    limit: Math.max(0, Number(tier?.max_bills_per_month || 0)),
  };
};

/** What the driver app shows: may I make a bill, and how many are left this month (limit 0 = no limit). */
export const getBillAllowance = async (driverId) => {
  if (!(await isPlanRulesEnabled())) {
    return { enforced: false, allowed: true, limit: 0, used: 0, left: null, month: indianMonth(), planName: '', sharedWithTeam: false };
  }
  const rules = await loadRules(driverId);
  const usage = await DriverBillUsage.findById(usageId(rules.holderId)).lean();
  const used = usage?.used || 0;
  return {
    enforced: true,
    allowed: rules.allowed,
    limit: rules.limit,
    used,
    left: rules.limit > 0 ? Math.max(0, rules.limit - used) : null,
    month: indianMonth(),
    planName: rules.planName,
    sharedWithTeam: rules.holderId !== String(driverId),
  };
};

/**
 * Takes one bill from the month's allowance, or refuses. Returns a function that
 * gives it back if the bill is then not saved. Does nothing while plan rules are off.
 */
export const takeBillAllowance = async (driverId) => {
  if (!(await isPlanRulesEnabled())) return async () => {};

  const { holderId, allowed, limit } = await loadRules(driverId);
  if (!allowed) {
    throw new ApiError(403, 'Bills are not part of your plan. Upgrade to make bills.', null, 'BILL_NOT_IN_PLAN');
  }

  const _id = usageId(holderId);
  // One atomic step, so two bills at once (the lead and a team driver) cannot both take the last one.
  await DriverBillUsage.updateOne({ _id }, { $setOnInsert: { used: 0 } }, { upsert: true });
  const taken = await DriverBillUsage.updateOne(
    { _id, ...(limit > 0 ? { used: { $lt: limit } } : {}) },
    { $inc: { used: 1 } },
  );
  if (!taken.modifiedCount) {
    throw new ApiError(403, `You have made all ${limit} bills of this month's plan limit.`, { limit }, 'BILL_LIMIT_REACHED');
  }
  return async () => {
    await DriverBillUsage.updateOne({ _id, used: { $gt: 0 } }, { $inc: { used: -1 } }).catch((error) =>
      console.error('[bills] allowance not given back:', error.message),
    );
  };
};
