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

  // ApiError's statusCode is one we chose on purpose, so only the 500 case is
  // worth logging. Any other thrown error is not: a third-party SDK error can
  // carry its own `.statusCode` that just mirrors an upstream HTTP response
  // (Razorpay's client does this — an unauthorized order-create call throws
  // with `.statusCode: 401`), and that must not be treated as an intentional,
  // silent 401 the way one of ours would be. It reached here because
  // something is actually broken (bad credentials, a misconfigured client),
  // and previously it never appeared in the logs at all.
  if (statusCode === 500 || !(error instanceof ApiError)) {
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
