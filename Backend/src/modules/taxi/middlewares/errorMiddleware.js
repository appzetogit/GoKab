import { ApiError } from '../../../utils/ApiError.js';

export const notFoundHandler = (req, _res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

// Concurrent writes to the same document (two riders redeeming the last promo,
// two tabs approving one withdrawal, a double-tapped wallet transfer) abort the
// transaction with a retryable WriteConflict. That is a conflict, not a server
// fault, so it must not reach the client as a 500 — the balance is intact and
// retrying succeeds.
const isRetryableWriteConflict = (error) =>
  error?.codeName === 'WriteConflict' ||
  error?.code === 112 ||
  (typeof error?.hasErrorLabel === 'function' && error.hasErrorLabel('TransientTransactionError'));

export const errorHandler = (error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;

  if (!(error instanceof ApiError) && isRetryableWriteConflict(error)) {
    return res.status(409).json({
      success: false,
      message: 'This action collided with another update. Nothing was changed — please try again.',
      retryable: true,
    });
  }

  if (statusCode === 500) {
    console.error('[errorHandler]', error);
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: Object.values(error.errors).map((entry) => entry.message),
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Duplicate value error',
      details: error.keyValue,
    });
  }

  return res.status(statusCode).json({
    success: false,
    message: error.message || 'Internal server error',
    code: error instanceof ApiError ? error.code || undefined : undefined,
    details: error instanceof ApiError ? error.details : undefined,
  });
};
