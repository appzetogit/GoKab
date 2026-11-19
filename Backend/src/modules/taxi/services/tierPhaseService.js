import { ApiError } from '../../../utils/ApiError.js';
import { Driver } from '../driver/models/Driver.js';
import { getTransportRideSettings } from './transportSettingsService.js';

const CATEGORIES = ['lower', 'middle', 'prime'];

/**
 * Who may see and take a customer ride, and when. Plans map as
 * prime = Elite, middle = Pro, lower = Basic. Each phase lists every plan that
 * can take the ride while it lasts, so Elite keeps access through all phases
 * (3 + 2 + 5 = 10 minutes), Pro through two (7) and Basic through one (5).
 * Admins can override via `transport_ride.tier_phases`; turn the whole thing
 * off with `transport_ride.tier_phases_enabled = false`.
 */
export const DEFAULT_TIER_PHASES = [
  { categories: ['prime'], minutes: 3 },
  { categories: ['prime', 'middle'], minutes: 2 },
  { categories: ['prime', 'middle', 'lower'], minutes: 5 },
];

/** The phase list, or null when phased dispatch is switched off. */
export const getTierPhases = async () => {
  const settings = await getTransportRideSettings();
  if (settings.tier_phases_enabled === false) return null;

  const configured = (Array.isArray(settings.tier_phases) ? settings.tier_phases : [])
    .map((phase) => ({
      categories: (Array.isArray(phase?.categories) ? phase.categories : []).filter((c) => CATEGORIES.includes(c)),
      minutes: Number(phase?.minutes),
    }))
    .filter((phase) => phase.categories.length && Number.isFinite(phase.minutes) && phase.minutes > 0);

  return configured.length ? configured : DEFAULT_TIER_PHASES;
};

export const categoryOf = (driver) => String(driver?.driver_category || 'lower');

/** Plans that may take the ride in phase `index`. Past the last phase everyone may. */
export const phaseCategories = (phases, index) => phases?.[index]?.categories || CATEGORIES;

const isMemberOfTeam = (driver) => Boolean(driver?.owner_id) && driver?.is_self_drive_owner !== true;

/**
 * Drops drivers who work under another driver's team. Their lead takes customer
 * rides and assigns them; they never get the request themselves. Needs
 * `owner_id` and `is_self_drive_owner` on each driver.
 */
export const withoutTeamMembers = async (drivers = []) => {
  const orgIds = [...new Set(drivers.filter(isMemberOfTeam).map((driver) => String(driver.owner_id)))];
  if (!orgIds.length) return drivers;

  const leads = await Driver.find({ owner_id: { $in: orgIds }, is_self_drive_owner: true, deletedAt: null })
    .select('owner_id')
    .lean();
  const orgsWithLead = new Set(leads.map((lead) => String(lead.owner_id)));

  return drivers.filter((driver) => !(isMemberOfTeam(driver) && orgsWithLead.has(String(driver.owner_id))));
};

/** Whether a customer ride is open to this plan right now (feed visibility). */
export const isRideOpenToCategory = (ride, category, phases) => {
  if (!phases || ride?.tierPhaseIndex == null) return true;
  return phaseCategories(phases, ride.tierPhaseIndex).includes(category);
};

/**
 * Guards every way of taking a customer ride (socket, REST card, feed): a team
 * member never takes one directly, and a plan can only take it in its phase.
 */
export const assertDriverMayTakeCustomerRide = async (ride, driver) => {
  if (ride?.origin && ride.origin !== 'customer_app') return;

  if ((await withoutTeamMembers([driver])).length === 0) {
    throw new ApiError(
      403,
      'Your team lead takes customer rides and assigns them to you',
      null,
      'TEAM_MEMBER_CANNOT_ACCEPT',
    );
  }

  const phases = await getTierPhases();
  if (!isRideOpenToCategory(ride, categoryOf(driver), phases)) {
    throw new ApiError(409, 'This ride is not open to your plan yet', null, 'RIDE_NOT_OPEN_FOR_PLAN_YET');
  }
};
