// Who may complain about what, free of imports so it can be checked without a
// database:  node scripts/check_complaints.mjs

export const COMPLAINT_DAYS = 7;
export const COMPLAINT_STATUSES = ['new', 'reviewing', 'resolved'];
export const DIRECTIONS = { user: 'user_on_driver', driver: 'driver_on_user' };

// `safety` complaints are listed first and marked.
export const DEFAULT_REASONS = {
  user: [
    { text: 'Misbehaviour or harassment', safety: true },
    { text: 'Drunk or unsafe driving', safety: true },
    { text: 'Asked for extra money', safety: false },
    { text: 'Different driver or vehicle', safety: true },
    { text: 'Came late or did not come', safety: false },
    { text: 'Vehicle not clean', safety: false },
    { text: 'Other', safety: false },
  ],
  driver: [
    { text: 'Misbehaviour or abuse', safety: true },
    { text: 'Drunk passenger', safety: true },
    { text: 'Did not pay', safety: false },
    { text: 'Damaged the vehicle', safety: false },
    { text: 'Did not come to pickup', safety: false },
    { text: 'Other', safety: false },
  ],
};

const cleanList = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((item) => ({ text: String(item?.text || '').replace(/\s+/g, ' ').trim().slice(0, 60), safety: item?.safety === true }))
    .filter((item) => item.text && !seen.has(item.text.toLowerCase()) && seen.add(item.text.toLowerCase()))
    .slice(0, 20);
};

/** The admin's reasons, or the defaults for a side that has none. */
export const reasonsFrom = (stored) => ({
  user: cleanList(stored?.user).length ? cleanList(stored.user) : DEFAULT_REASONS.user,
  driver: cleanList(stored?.driver).length ? cleanList(stored.driver) : DEFAULT_REASONS.driver,
});

/** What the admin saves: each side needs at least one reason. */
export const validateReasons = (raw) => {
  const next = { user: cleanList(raw?.user), driver: cleanList(raw?.driver) };
  if (!next.user.length || !next.driver.length) throw new Error('Keep at least one reason for riders and one for drivers');
  return next;
};

/** Null when this person may complain about the ride; otherwise why not, as { status, code, message }. */
export const whyNotAllowed = ({ ride, role, accountId, now = Date.now() }) => {
  const mine = ride && String((role === 'user' ? ride.userId : ride.driverId) || '') === String(accountId);
  if (!mine) return { status: 404, code: 'RIDE_NOT_FOUND', message: 'This ride is not one of yours' };
  if (!ride.driverId) return { status: 409, code: 'NO_DRIVER', message: 'No driver took this ride' };
  if (!ride.userId) return { status: 409, code: 'NO_RIDER_ACCOUNT', message: 'This customer has no GoKab account' };
  if (ride.status === 'searching') return { status: 409, code: 'RIDE_NOT_STARTED', message: 'This ride has no driver yet' };
  if (['completed', 'cancelled'].includes(ride.status)) {
    const ended = new Date(ride.completedAt || ride.updatedAt || 0).getTime();
    if (now - ended > COMPLAINT_DAYS * 24 * 60 * 60 * 1000) {
      return { status: 409, code: 'TOO_LATE', message: `A ride can be reported for ${COMPLAINT_DAYS} days after it ends` };
    }
  }
  return null;
};

/**
 * Who a driver answers to: the lead of their team, else the company they are
 * under, else themselves. `key` groups complaints of everyone under one owner.
 */
export const ownerOf = ({ driver, lead, company }) => {
  const isMember = Boolean(driver?.owner_id) && driver?.is_self_drive_owner !== true;
  if (isMember && lead) {
    return {
      kind: 'lead', key: `driver:${lead._id}`, driver_id: lead._id, name: lead.name || '', phone: lead.phone || '', org: company?.company_name || '',
    };
  }
  if (isMember && company) {
    return {
      kind: 'company', key: `owner:${company._id}`, owner_id: company._id, name: company.owner_name || company.name || company.company_name || '',
      phone: company.mobile || company.phone || '', org: company.company_name || '',
    };
  }
  return {
    kind: 'self', key: `driver:${driver?._id}`, driver_id: driver?._id, name: driver?.name || '', phone: driver?.phone || '', org: company?.company_name || '',
  };
};
