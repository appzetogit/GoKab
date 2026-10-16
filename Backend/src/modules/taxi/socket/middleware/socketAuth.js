import { ApiError } from '../../../../utils/ApiError.js';
import { User } from '../../user/models/User.js';
import { Driver } from '../../driver/models/Driver.js';
import { verifyAccessToken } from '../../services/tokenService.js';

const INACTIVE_DRIVER_STATUSES = new Set(['pending', 'blocked', 'rejected', 'inactive']);

export const getIdentityFromSocket = (socket) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    throw new ApiError(401, 'Socket token is required');
  }

  return verifyAccessToken(token);
};

export const attachSocketAuth = (io) => {
  io.use(async (socket, next) => {
    try {
      socket.auth = getIdentityFromSocket(socket);

      if (socket.auth.role === 'user') {
        const user = await User.findById(socket.auth.sub).select('active isActive deletedAt').lean();

        if (!user || user.deletedAt || user.isActive === false || user.active === false) {
          throw new ApiError(401, 'User account is not active');
        }
      }

      // Same rule as the HTTP `authenticate` middleware: a token outlives a
      // block/rejection, so the account state is re-checked on every connect.
      if (socket.auth.role === 'driver') {
        const driver = await Driver.findById(socket.auth.sub).select('approve status deletedAt').lean();

        if (!driver || driver.deletedAt) {
          throw new ApiError(401, 'Driver account no longer exists');
        }

        if (driver.approve === false || INACTIVE_DRIVER_STATUSES.has(String(driver.status || '').toLowerCase())) {
          throw new ApiError(403, 'Driver account is not approved or has been blocked');
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  });
};
