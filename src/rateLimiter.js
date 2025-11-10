/* eslint-env node */

/**
 * RateLimiter: Enforces rate limits per client across multiple time windows
 * 
 * Features:
 * - Configurable rate limits per second, minute, hour, and day
 * - Per-client rate limiting based on client tier
 * - HTTP 429 response when limits exceeded
 * - Retry-After header in error responses
 * - Thread-safe request counting with automatic cleanup
 * - Multiple concurrent time windows properly managed
 */

/**
 * Default rate limits by client tier
 * Format: { second, minute, hour, day }
 */
export const DEFAULT_RATE_LIMITS = {
  free: {
    second: 1,
    minute: 10,
    hour: 100,
    day: 1000
  },
  basic: {
    second: 5,
    minute: 50,
    hour: 500,
    day: 5000
  },
  standard: {
    second: 10,
    minute: 100,
    hour: 1000,
    day: 10000
  },
  premium: {
    second: 50,
    minute: 500,
    hour: 5000,
    day: 50000
  },
  enterprise: {
    second: 100,
    minute: 1000,
    hour: 10000,
    day: 100000
  }
};

/**
 * Time window constants in milliseconds
 */
export const TIME_WINDOWS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000
};

/* eslint-env node */

/**
 * Class to track requests for a specific client and time window
 */
class WindowTracker {
  /**
   * Create a WindowTracker
   * @param {number} windowSize - Size of the time window in milliseconds
   * @param {number} limit - Maximum number of requests allowed in this window
   */
  constructor(windowSize, limit) {
    this.windowSize = windowSize;
    this.limit = limit;
    this.requests = []; // Array of timestamps
  }

  /**
   * Remove expired timestamps from the window
   * @param {number} currentTime - Current timestamp in milliseconds
   * @private
   */
  _cleanup(currentTime) {
    const cutoffTime = currentTime - this.windowSize;
    this.requests = this.requests.filter(timestamp => timestamp > cutoffTime);
  }

  /**
   * Check if a new request would exceed the limit
   * @param {number} currentTime - Current timestamp in milliseconds
   * @returns {Object} Object with allowed status and details
   */
  checkLimit(currentTime) {
    this._cleanup(currentTime);
    
    const currentCount = this.requests.length;
    const allowed = currentCount < this.limit;
    
    return {
      allowed: allowed,
      currentCount: currentCount,
      limit: this.limit,
      remainingRequests: Math.max(0, this.limit - currentCount)
    };
  }

  /**
   * Record a new request
   * @param {number} currentTime - Current timestamp in milliseconds
   */
  recordRequest(currentTime) {
    this._cleanup(currentTime);
    this.requests.push(currentTime);
  }

  /**
   * Calculate time until the oldest request in window expires
   * @param {number} currentTime - Current timestamp in milliseconds
   * @returns {number} Milliseconds until window resets, or 0 if window is not full
   */
  timeUntilReset(currentTime) {
    this._cleanup(currentTime);
    
    if (this.requests.length === 0) {
      return 0;
    }
    
    // Time until the oldest request expires
    const oldestRequest = this.requests[0];
    const resetTime = oldestRequest + this.windowSize;
    const timeUntilReset = Math.max(0, Math.ceil((resetTime - currentTime) / 1000));
    
    return timeUntilReset;
  }

  /**
   * Get current request count
   * @param {number} currentTime - Current timestamp in milliseconds
   * @returns {number} Current number of requests in window
   */
  getCurrentCount(currentTime) {
    this._cleanup(currentTime);
    return this.requests.length;
  }
}

/**
 * Class to manage rate limits for a single client across all time windows
 */
class ClientRateLimiter {
  /**
   * Create a ClientRateLimiter
   * @param {string} clientName - Name of the client
   * @param {Object} limits - Rate limits for each time window
   */
  constructor(clientName, limits) {
    this.clientName = clientName;
    this.limits = limits;
    this.lastActivity = Date.now(); // Track last activity time
    
    // Initialize window trackers for each time window
    this.windows = {
      second: new WindowTracker(TIME_WINDOWS.second, limits.second),
      minute: new WindowTracker(TIME_WINDOWS.minute, limits.minute),
      hour: new WindowTracker(TIME_WINDOWS.hour, limits.hour),
      day: new WindowTracker(TIME_WINDOWS.day, limits.day)
    };
  }

  /**
   * Check if a request should be allowed across all time windows
   * @returns {Object} Result with allowed status and details
   */
  checkRequest() {
    const currentTime = Date.now();
    const results = {};
    let allowed = true;
    let limitingWindow = null;
    let maxRetryAfter = 0;

    // Check all time windows
    for (const [windowName, tracker] of Object.entries(this.windows)) {
      const result = tracker.checkLimit(currentTime);
      results[windowName] = result;

      if (!result.allowed) {
        allowed = false;
        if (!limitingWindow) {
          limitingWindow = windowName;
        }
        
        // Calculate retry-after for this window
        const retryAfter = tracker.timeUntilReset(currentTime);
        if (retryAfter > maxRetryAfter) {
          maxRetryAfter = retryAfter;
          limitingWindow = windowName;
        }
      }
    }

    return {
      allowed: allowed,
      limitingWindow: limitingWindow,
      retryAfter: maxRetryAfter,
      windows: results
    };
  }

  /**
   * Record a successful request across all time windows
   */
  recordRequest() {
    const currentTime = Date.now();
    this.lastActivity = currentTime; // Update last activity time
    
    for (const tracker of Object.values(this.windows)) {
      tracker.recordRequest(currentTime);
    }
  }

  /**
   * Get current statistics for all windows
   * @returns {Object} Statistics for each time window
   */
  getStatistics() {
    const currentTime = Date.now();
    const stats = {};

    for (const [windowName, tracker] of Object.entries(this.windows)) {
      stats[windowName] = {
        currentCount: tracker.getCurrentCount(currentTime),
        limit: tracker.limit,
        remainingRequests: Math.max(0, tracker.limit - tracker.getCurrentCount(currentTime))
      };
    }

    return stats;
  }
}

/**
 * Main RateLimiter class
 */
class RateLimiter {
  /**
   * Create a RateLimiter
   * @param {Object} rateLimits - Custom rate limits by tier (optional)
   * @param {Object} options - Configuration options (optional)
   * @param {number} options.cleanupInterval - Interval in ms for cleanup (default: 5 minutes)
   * @param {number} options.inactiveThreshold - Time in ms to consider client inactive (default: 10 minutes)
   */
  constructor(rateLimits = DEFAULT_RATE_LIMITS, options = {}) {
    // Deep copy rateLimits to avoid mutating the original DEFAULT_RATE_LIMITS
    this.rateLimits = {};
    for (const tier in rateLimits) {
      this.rateLimits[tier] = { ...rateLimits[tier] };
    }
    
    // Map<clientName, ClientRateLimiter>
    this.clients = new Map();
    
    // Configuration options
    this.cleanupIntervalMs = options.cleanupInterval || 5 * 60 * 1000; // Default: 5 minutes
    this.inactiveThresholdMs = options.inactiveThreshold || 10 * 60 * 1000; // Default: 10 minutes
    
    // Cleanup interval to remove inactive clients
    this.cleanupInterval = setInterval(() => this._cleanup(), this.cleanupIntervalMs);
    
    console.info('RateLimiter initialized with multi-window enforcement');
  }

  /**
   * Get or create a rate limiter for a specific client
   * @param {string} clientName - Name of the client
   * @param {string} tier - Client tier (free, basic, standard, premium, enterprise)
   * @returns {ClientRateLimiter} Rate limiter for the client
   * @private
   */
  _getClientLimiter(clientName, tier) {
    if (!this.clients.has(clientName)) {
      const limits = this.rateLimits[tier.toLowerCase()] || this.rateLimits.free;
      this.clients.set(clientName, new ClientRateLimiter(clientName, limits));
    }
    
    return this.clients.get(clientName);
  }

  /**
   * Check if a request should be allowed for a client
   * @param {string} clientName - Name of the client
   * @param {string} tier - Client tier
   * @returns {Object} Result with allowed status and details
   */
  checkRequest(clientName, tier) {
    if (!clientName || !tier) {
      return {
        allowed: false,
        error: 'Client name and tier are required'
      };
    }

    const clientLimiter = this._getClientLimiter(clientName, tier);
    const result = clientLimiter.checkRequest();

    if (!result.allowed) {
      return {
        allowed: false,
        clientName: clientName,
        tier: tier,
        limitingWindow: result.limitingWindow,
        retryAfter: result.retryAfter,
        windows: result.windows,
        message: `Rate limit exceeded for ${result.limitingWindow} window`
      };
    }

    return {
      allowed: true,
      clientName: clientName,
      tier: tier,
      windows: result.windows
    };
  }

  /**
   * Record a successful request for a client
   * @param {string} clientName - Name of the client
   * @param {string} tier - Client tier
   */
  recordRequest(clientName, tier) {
    if (!clientName || !tier) {
      return;
    }

    const clientLimiter = this._getClientLimiter(clientName, tier);
    clientLimiter.recordRequest();
  }

  /**
   * Get statistics for a specific client
   * @param {string} clientName - Name of the client
   * @returns {Object|null} Statistics or null if client not found
   */
  getClientStatistics(clientName) {
    if (!this.clients.has(clientName)) {
      return null;
    }

    const clientLimiter = this.clients.get(clientName);
    return {
      clientName: clientName,
      windows: clientLimiter.getStatistics()
    };
  }

  /**
   * Get statistics for all clients
   * @returns {Object} Statistics for all tracked clients
   */
  getAllStatistics() {
    const stats = {
      totalClients: this.clients.size,
      clients: {}
    };

    for (const [clientName, limiter] of this.clients.entries()) {
      stats.clients[clientName] = limiter.getStatistics();
    }

    return stats;
  }

  /**
   * Cleanup inactive clients to free memory
   * Removes clients with no requests in any window
   * @private
   */
  _cleanup() {
    const currentTime = Date.now();
    const clientsToRemove = [];

    for (const [clientName, limiter] of this.clients.entries()) {
      // Check if client has been inactive for longer than threshold
      const inactiveTime = currentTime - limiter.lastActivity;
      
      if (inactiveTime > this.inactiveThresholdMs) {
        // Double check: ensure no active requests in any window
        let hasActivity = false;
        for (const tracker of Object.values(limiter.windows)) {
          if (tracker.getCurrentCount(currentTime) > 0) {
            hasActivity = true;
            break;
          }
        }
        
        if (!hasActivity) {
          clientsToRemove.push(clientName);
        }
      }
    }

    // Remove inactive clients
    for (const clientName of clientsToRemove) {
      this.clients.delete(clientName);
    }

    if (clientsToRemove.length > 0) {
      console.info(`Cleaned up ${clientsToRemove.length} inactive clients`);
    }
  }

  /**
   * Reset rate limits for a specific client
   * @param {string} clientName - Name of the client to reset
   */
  resetClient(clientName) {
    if (this.clients.has(clientName)) {
      this.clients.delete(clientName);
      console.info(`Reset rate limits for client: ${clientName}`);
    }
  }

  /**
   * Reset all rate limits
   */
  resetAll() {
    const count = this.clients.size;
    this.clients.clear();
    console.info(`Reset rate limits for ${count} clients`);
  }

  /**
   * Stop the cleanup interval
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Update rate limits for a specific tier
   * @param {string} tier - Client tier
   * @param {Object} limits - New rate limits
   */
  updateTierLimits(tier, limits) {
    const normalizedTier = tier.toLowerCase();
    
    if (!this.rateLimits[normalizedTier]) {
      console.warn(`Unknown tier: ${tier}`);
      return false;
    }

    this.rateLimits[normalizedTier] = {
      second: limits.second || this.rateLimits[normalizedTier].second,
      minute: limits.minute || this.rateLimits[normalizedTier].minute,
      hour: limits.hour || this.rateLimits[normalizedTier].hour,
      day: limits.day || this.rateLimits[normalizedTier].day
    };

    console.info(`Updated rate limits for tier: ${tier}`);
    return true;
  }

  /**
   * Get rate limits for a specific tier
   * @param {string} tier - Client tier
   * @returns {Object|null} Rate limits or null if tier not found
   */
  getTierLimits(tier) {
    const normalizedTier = tier.toLowerCase();
    return this.rateLimits[normalizedTier] || null;
  }
}

export default RateLimiter;
