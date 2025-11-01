/**
 * RateLimitHeaderManager: Manages rate limit information exposed in HTTP response headers
 * 
 * Features:
 * - Calculates and exposes rate limit information in response headers
 * - Supports multiple time windows (per-minute, per-hour, etc.)
 * - Accurate within ±5% error margin (NFR requirement)
 * - Headers present in both 200 and 429 responses
 * - Follows industry standards (X-RateLimit-* headers)
 * 
 * Standard Headers:
 * - X-RateLimit-Limit: Maximum requests allowed in current window
 * - X-RateLimit-Remaining: Requests remaining in current window
 * - X-RateLimit-Reset: Unix timestamp when limit resets
 * - X-RateLimit-Window: Current window duration in seconds
 * - X-RateLimit-Retry-After: Seconds until next request allowed (on 429 response)
 */

class RateLimitHeaderManager {
  /**
   * Initialize RateLimitHeaderManager
   * @param {Object} options - Configuration options
   * @param {number} options.accuracyMargin - Acceptable error margin (0-100), default 5
   */
  constructor(options = {}) {
    this.accuracyMargin = options.accuracyMargin || 5;
    console.info(`RateLimitHeaderManager initialized with ${this.accuracyMargin}% accuracy margin`);
  }

  /**
   * Calculate time until next reset
   * @param {number} resetTime - Unix timestamp in milliseconds
   * @returns {number} Seconds until reset
   */
  _calculateSecondsUntilReset(resetTime) {
    const now = Date.now();
    const secondsUntil = Math.ceil((resetTime - now) / 1000);
    return Math.max(0, secondsUntil);
  }

  /**
   * Apply rate limit headers to response
   * @param {Object} res - Express response object
   * @param {Object} rateLimitInfo - Rate limit information
   * @param {number} rateLimitInfo.limit - Maximum requests allowed
   * @param {number} rateLimitInfo.remaining - Requests remaining
   * @param {number} rateLimitInfo.resetTime - Unix timestamp when limit resets
   * @param {number} rateLimitInfo.windowSeconds - Window duration in seconds
   * @param {boolean} isRateLimited - Whether request is rate limited (429)
   */
  applyHeaders(res, rateLimitInfo, isRateLimited = false) {
    if (!rateLimitInfo) {
      console.warn('No rate limit info provided to applyHeaders');
      return;
    }

    try {
      const secsUntilReset = this._calculateSecondsUntilReset(rateLimitInfo.resetTime);
      const resetUnix = Math.floor(rateLimitInfo.resetTime / 1000);

      // Core rate limit headers (RFC 6585 style)
      res.set('X-RateLimit-Limit', String(rateLimitInfo.limit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, rateLimitInfo.remaining)));
      res.set('X-RateLimit-Reset', String(resetUnix));

      // Additional informational headers
      res.set('X-RateLimit-Window', String(rateLimitInfo.windowSeconds || 60));

      // For rate limited responses, include Retry-After
      if (isRateLimited) {
        res.set('Retry-After', String(secsUntilReset));
        res.set('X-RateLimit-Retry-After', String(secsUntilReset));
      }

      // Add accuracy margin info for compliance
      res.set('X-RateLimit-Accuracy-Margin', `${this.accuracyMargin}%`);

      console.info(
        `Rate limit headers applied: ` +
        `Limit=${rateLimitInfo.limit}, ` +
        `Remaining=${Math.max(0, rateLimitInfo.remaining)}, ` +
        `Reset=${resetUnix}, ` +
        `IsRateLimited=${isRateLimited}`
      );
    } catch (error) {
      console.error(`Error applying rate limit headers: ${error.message}`);
    }
  }

  /**
   * Apply headers for rate limited response (429)
   * @param {Object} res - Express response object
   * @param {Object} rateLimitInfo - Rate limit information
   */
  applyRateLimitedHeaders(res, rateLimitInfo) {
    this.applyHeaders(res, rateLimitInfo, true);
  }

  /**
   * Get rate limit headers as object
   * Useful for testing or debugging
   * @param {Object} rateLimitInfo - Rate limit information
   * @returns {Object} Headers as key-value pairs
   */
  getHeadersAsObject(rateLimitInfo, isRateLimited = false) {
    if (!rateLimitInfo) return {};

    const secsUntilReset = this._calculateSecondsUntilReset(rateLimitInfo.resetTime);
    const resetUnix = Math.floor(rateLimitInfo.resetTime / 1000);

    const headers = {
      'X-RateLimit-Limit': String(rateLimitInfo.limit),
      'X-RateLimit-Remaining': String(Math.max(0, rateLimitInfo.remaining)),
      'X-RateLimit-Reset': String(resetUnix),
      'X-RateLimit-Window': String(rateLimitInfo.windowSeconds || 60),
      'X-RateLimit-Accuracy-Margin': `${this.accuracyMargin}%`
    };

    if (isRateLimited) {
      headers['Retry-After'] = String(secsUntilReset);
      headers['X-RateLimit-Retry-After'] = String(secsUntilReset);
    }

    return headers;
  }

  /**
   * Validate header values are within accuracy margin
   * @param {number} expectedValue - Expected value
   * @param {number} actualValue - Actual value
   * @returns {boolean} True if within accuracy margin
   */
  validateAccuracy(expectedValue, actualValue) {
    if (expectedValue === 0) return actualValue === 0;
    
    const errorPercent = Math.abs((expectedValue - actualValue) / expectedValue) * 100;
    return errorPercent <= this.accuracyMargin;
  }

  /**
   * Format rate limit info for logging/monitoring
   * @param {Object} rateLimitInfo - Rate limit information
   * @returns {string} Formatted string
   */
  formatForLogging(rateLimitInfo) {
    if (!rateLimitInfo) return 'No rate limit info';

    const resetDate = new Date(rateLimitInfo.resetTime);
    return (
      `RateLimit[Limit=${rateLimitInfo.limit}, ` +
      `Remaining=${rateLimitInfo.remaining}, ` +
      `Reset=${resetDate.toISOString()}, ` +
      `Window=${rateLimitInfo.windowSeconds}s]`
    );
  }
}

export default RateLimitHeaderManager;
