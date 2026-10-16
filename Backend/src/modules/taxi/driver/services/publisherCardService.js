import { Owner } from '../../admin/models/Owner.js';
import { Driver } from '../models/Driver.js';

/** Fields a publisher card needs; select these wherever a card is built. */
export const PUBLISHER_DRIVER_FIELDS = 'name rating owner_id driver_category profileImage bannerImage';

/**
 * Image fields on a list payload must be URLs. A legacy profileImage can still
 * hold a raw data URL (PATCH /me used to store whatever it got), which would
 * bloat every feed page by megabytes — drop it rather than ship it.
 */
export const toPublicImageUrl = (value) => {
  const url = value && typeof value === 'object' && value.url ? String(value.url) : String(value || '');
  const trimmed = url.trim();
  return trimmed.startsWith('data:') ? '' : trimmed;
};

/** The publisher block shown on feed items, network rides and ride detail. */
export const buildPublisherCard = (driver, organization = null) =>
  driver
    ? {
        id: String(driver._id),
        name: driver.name || '',
        org_name: organization?.company_name || '',
        category: driver.driver_category || 'lower',
        rating: driver.rating || 0,
        profile_image: toPublicImageUrl(driver.profileImage),
        banner_image: toPublicImageUrl(driver.bannerImage),
      }
    : null;

/** Publisher card for a single driver-created ride (ride detail). */
export const loadPublisherCardForRide = async (ride) => {
  if (!ride?.created_by_driver_id) return null;
  const [driver, organization] = await Promise.all([
    Driver.findById(ride.created_by_driver_id).select(PUBLISHER_DRIVER_FIELDS).lean(),
    ride.organization_owner_id ? Owner.findById(ride.organization_owner_id).select('company_name').lean() : null,
  ]);
  return buildPublisherCard(driver, organization);
};
