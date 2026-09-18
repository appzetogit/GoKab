import { ApiError } from '../../../utils/ApiError.js';
import { getDriverPermissions } from '../services/driverCategoryService.js';
import { getDriverNetworkSettings } from '../services/appSettingsService.js';

/**
 * Gate a driver route on a tier permission (`can_create_rides`,
 * `can_publish_rides`, `can_manage_fleet`).
 *
 * The resolved permissions are left on `req.driverPermissions` so the handler
 * does not have to load the tier a second time.
 */
export const requireDriverPermission = (permission) => async (req, _res, next) => {
  try {
    const settings = await getDriverNetworkSettings();
    if (settings.enabled === false) {
      throw new ApiError(
        503,
        'The driver network is currently disabled',
        null,
        'DRIVER_NETWORK_DISABLED',
      );
    }

    const permissions = await getDriverPermissions(req.auth.sub);

    if (!permissions[permission]) {
      throw new ApiError(
        403,
        'Your current plan does not allow this action',
        { required: permission, category: permissions.category },
        'CATEGORY_NOT_ALLOWED',
      );
    }

    req.driverPermissions = permissions;
    next();
  } catch (error) {
    next(error);
  }
};

/** Loads permissions without gating, for handlers that only need the fees. */
export const attachDriverPermissions = async (req, _res, next) => {
  try {
    req.driverPermissions = await getDriverPermissions(req.auth.sub);
    next();
  } catch (error) {
    next(error);
  }
};
