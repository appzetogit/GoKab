export class ApiError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} message   Human-readable text; safe to show to the user.
   * @param {*} [details]      Extra structured context for the client.
   * @param {string} [code]    Stable machine code (e.g. 'PRIME_SLOTS_FULL') that
   *                           clients can branch on without matching on prose.
   */
  constructor(statusCode, message, details = null, code = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
  }
}
