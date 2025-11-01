/**
 * Unit tests for RateLimitHeaderManager
 * 
 * Tests cover:
 * - Header application to responses
 * - Accuracy validation within ±5% margin
 * - Headers in both 200 and 429 responses
 * - Reset time calculations
 * - Error handling
 * - Header formatting and logging
 */

import RateLimitHeaderManager from '../src/rateLimitHeaderManager.js';

describe('RateLimitHeaderManager', () => {
  let manager;
  let mockRes;

  beforeEach(() => {
    manager = new RateLimitHeaderManager({ accuracyMargin: 5 });
    
    // Mock Express response object
    mockRes = {
      headers: {},
      set: function(key, value) {
        this.headers[key] = value;
      },
      getHeaders: function() {
        return this.headers;
      }
    };
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with default accuracy margin', () => {
      const defaultManager = new RateLimitHeaderManager();
      expect(defaultManager.accuracyMargin).toBe(5);
    });

    test('should initialize with custom accuracy margin', () => {
      const customManager = new RateLimitHeaderManager({ accuracyMargin: 10 });
      expect(customManager.accuracyMargin).toBe(10);
    });

    test('should have required methods', () => {
      expect(typeof manager.applyHeaders).toBe('function');
      expect(typeof manager.applyRateLimitedHeaders).toBe('function');
      expect(typeof manager.validateAccuracy).toBe('function');
    });
  });

  describe('Header Application - 200 Response', () => {
    test('should apply rate limit headers to response', () => {
      const now = Date.now();
      const resetTime = now + 60000; // 60 seconds from now

      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: resetTime,
        windowSeconds: 60
      };

      manager.applyHeaders(mockRes, rateLimitInfo, false);

      expect(mockRes.headers['X-RateLimit-Limit']).toBe('100');
      expect(mockRes.headers['X-RateLimit-Remaining']).toBe('50');
      expect(mockRes.headers['X-RateLimit-Reset']).toBe(String(Math.floor(resetTime / 1000)));
      expect(mockRes.headers['X-RateLimit-Window']).toBe('60');
    });

    test('should not include Retry-After header in 200 response', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: now + 60000,
        windowSeconds: 60
      };

      manager.applyHeaders(mockRes, rateLimitInfo, false);

      expect(mockRes.headers['Retry-After']).toBeUndefined();
      expect(mockRes.headers['X-RateLimit-Retry-After']).toBeUndefined();
    });

    test('should clamp remaining to 0 if negative', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 100,
        remaining: -10,
        resetTime: now + 60000,
        windowSeconds: 60
      };

      manager.applyHeaders(mockRes, rateLimitInfo, false);

      expect(mockRes.headers['X-RateLimit-Remaining']).toBe('0');
    });

    test('should include accuracy margin in headers', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: now + 60000,
        windowSeconds: 60
      };

      manager.applyHeaders(mockRes, rateLimitInfo, false);

      expect(mockRes.headers['X-RateLimit-Accuracy-Margin']).toBe('5%');
    });
  });

  describe('Header Application - 429 Response', () => {
    test('should apply rate limit headers for 429 response', () => {
      const now = Date.now();
      const resetTime = now + 60000;

      const rateLimitInfo = {
        limit: 100,
        remaining: 0,
        resetTime: resetTime,
        windowSeconds: 60
      };

      manager.applyRateLimitedHeaders(mockRes, rateLimitInfo);

      expect(mockRes.headers['X-RateLimit-Limit']).toBe('100');
      expect(mockRes.headers['X-RateLimit-Remaining']).toBe('0');
      expect(mockRes.headers['X-RateLimit-Reset']).toBe(String(Math.floor(resetTime / 1000)));
    });

    test('should include Retry-After header in 429 response', () => {
      const now = Date.now();
      const resetTime = now + 30000; // 30 seconds

      const rateLimitInfo = {
        limit: 100,
        remaining: 0,
        resetTime: resetTime,
        windowSeconds: 60
      };

      manager.applyRateLimitedHeaders(mockRes, rateLimitInfo);

      const retryAfter = parseInt(mockRes.headers['Retry-After']);
      expect(retryAfter).toBeGreaterThanOrEqual(29);
      expect(retryAfter).toBeLessThanOrEqual(31);
    });

    test('should include X-RateLimit-Retry-After header', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 100,
        remaining: 0,
        resetTime: now + 45000,
        windowSeconds: 60
      };

      manager.applyRateLimitedHeaders(mockRes, rateLimitInfo);

      expect(mockRes.headers['X-RateLimit-Retry-After']).toBeDefined();
      expect(parseInt(mockRes.headers['X-RateLimit-Retry-After'])).toBeGreaterThan(0);
    });
  });

  describe('Reset Time Calculations', () => {
    test('should calculate correct seconds until reset', () => {
      const now = Date.now();
      const resetTime = now + 120000; // 120 seconds from now

      const secondsUntil = manager._calculateSecondsUntilReset(resetTime);

      expect(secondsUntil).toBeGreaterThanOrEqual(119);
      expect(secondsUntil).toBeLessThanOrEqual(121);
    });

    test('should return 0 if reset time is in the past', () => {
      const now = Date.now();
      const resetTime = now - 10000; // 10 seconds ago

      const secondsUntil = manager._calculateSecondsUntilReset(resetTime);

      expect(secondsUntil).toBe(0);
    });

    test('should convert reset time to Unix timestamp correctly', () => {
      const now = Date.now();
      const resetTime = now + 60000;
      const expectedUnix = Math.floor(resetTime / 1000);

      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: resetTime,
        windowSeconds: 60
      };

      manager.applyHeaders(mockRes, rateLimitInfo);

      expect(parseInt(mockRes.headers['X-RateLimit-Reset'])).toBe(expectedUnix);
    });
  });

  describe('Header Object Conversion', () => {
    test('should return headers as object', () => {
      const now = Date.now();
      const resetTime = now + 60000;

      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: resetTime,
        windowSeconds: 60
      };

      const headersObj = manager.getHeadersAsObject(rateLimitInfo, false);

      expect(headersObj['X-RateLimit-Limit']).toBe('100');
      expect(headersObj['X-RateLimit-Remaining']).toBe('50');
      expect(headersObj['X-RateLimit-Reset']).toBe(String(Math.floor(resetTime / 1000)));
      expect(headersObj['Retry-After']).toBeUndefined();
    });

    test('should include Retry-After in object for rate limited', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 100,
        remaining: 0,
        resetTime: now + 60000,
        windowSeconds: 60
      };

      const headersObj = manager.getHeadersAsObject(rateLimitInfo, true);

      expect(headersObj['Retry-After']).toBeDefined();
      expect(headersObj['X-RateLimit-Retry-After']).toBeDefined();
    });

    test('should return empty object for null info', () => {
      const headersObj = manager.getHeadersAsObject(null);

      expect(headersObj).toEqual({});
    });
  });

  describe('Accuracy Validation', () => {
    test('should validate values within accuracy margin', () => {
      // 5% margin: 95-105 is valid for expected value of 100
      expect(manager.validateAccuracy(100, 100)).toBe(true);
      expect(manager.validateAccuracy(100, 105)).toBe(true);
      expect(manager.validateAccuracy(100, 95)).toBe(true);
      expect(manager.validateAccuracy(100, 94)).toBe(false);
      expect(manager.validateAccuracy(100, 106)).toBe(false);
    });

    test('should validate with different accuracy margins', () => {
      const strictManager = new RateLimitHeaderManager({ accuracyMargin: 2 });

      expect(strictManager.validateAccuracy(100, 100)).toBe(true);
      expect(strictManager.validateAccuracy(100, 102)).toBe(true);
      expect(strictManager.validateAccuracy(100, 103)).toBe(false);
    });

    test('should handle zero value correctly', () => {
      expect(manager.validateAccuracy(0, 0)).toBe(true);
      expect(manager.validateAccuracy(0, 1)).toBe(false);
    });

    test('should validate percentage calculations correctly', () => {
      // Test multiple scenarios
      expect(manager.validateAccuracy(1000, 950)).toBe(true); // 5% below
      expect(manager.validateAccuracy(1000, 1050)).toBe(true); // 5% above
      expect(manager.validateAccuracy(200, 190)).toBe(true); // 5% below
      expect(manager.validateAccuracy(50, 47.5)).toBe(true); // 5% below
    });
  });

  describe('Error Handling', () => {
    test('should handle null rate limit info gracefully', () => {
      expect(() => {
        manager.applyHeaders(mockRes, null);
      }).not.toThrow();
    });

    test('should handle undefined rate limit info gracefully', () => {
      expect(() => {
        manager.applyHeaders(mockRes, undefined);
      }).not.toThrow();
    });

    test('should handle missing response object gracefully', () => {
      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: Date.now() + 60000,
        windowSeconds: 60
      };

      expect(() => {
        manager.applyHeaders(null, rateLimitInfo);
      }).not.toThrow();
    });
  });

  describe('Formatting and Logging', () => {
    test('should format rate limit info for logging', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: now + 60000,
        windowSeconds: 60
      };

      const formatted = manager.formatForLogging(rateLimitInfo);

      expect(formatted).toContain('RateLimit');
      expect(formatted).toContain('Limit=100');
      expect(formatted).toContain('Remaining=50');
      expect(formatted).toContain('Window=60s');
    });

    test('should handle null info in formatting', () => {
      const formatted = manager.formatForLogging(null);

      expect(formatted).toBe('No rate limit info');
    });

    test('should include ISO date in formatted output', () => {
      const now = Date.now();
      const resetTime = now + 60000;
      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: resetTime,
        windowSeconds: 60
      };

      const formatted = manager.formatForLogging(rateLimitInfo);

      expect(formatted).toContain('Reset=');
      expect(formatted).toContain('T'); // ISO date format includes T
    });
  });

  describe('Multiple Window Support', () => {
    test('should handle different window sizes', () => {
      const scenarios = [
        { windowSeconds: 60, name: 'per-minute' },
        { windowSeconds: 3600, name: 'per-hour' },
        { windowSeconds: 86400, name: 'per-day' },
        { windowSeconds: 1, name: 'per-second' }
      ];

      for (const scenario of scenarios) {
        const now = Date.now();
        const rateLimitInfo = {
          limit: 100,
          remaining: 50,
          resetTime: now + (scenario.windowSeconds * 1000),
          windowSeconds: scenario.windowSeconds
        };

        manager.applyHeaders(mockRes, rateLimitInfo);

        expect(mockRes.headers['X-RateLimit-Window']).toBe(String(scenario.windowSeconds));
      }
    });
  });

  describe('Header Standards Compliance', () => {
    test('should use RFC 6585 compliant header names', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: now + 60000,
        windowSeconds: 60
      };

      manager.applyHeaders(mockRes, rateLimitInfo);

      // RFC 6585 uses: Retry-After (for 429 responses)
      // For 200 responses, we don't include Retry-After
      
      // Custom extensions use X- prefix
      expect(mockRes.headers['X-RateLimit-Limit']).toBeDefined();
      expect(mockRes.headers['X-RateLimit-Remaining']).toBeDefined();
      expect(mockRes.headers['X-RateLimit-Reset']).toBeDefined();
    });

    test('should include Retry-After for rate limited responses', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 100,
        remaining: 0,
        resetTime: now + 60000,
        windowSeconds: 60
      };

      manager.applyRateLimitedHeaders(mockRes, rateLimitInfo);

      // 429 response should include Retry-After per RFC 6585
      expect(mockRes.headers['Retry-After']).toBeDefined();
      expect(mockRes.headers['X-RateLimit-Retry-After']).toBeDefined();
    });

    test('should include all required headers', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: now + 60000,
        windowSeconds: 60
      };

      manager.applyHeaders(mockRes, rateLimitInfo, false);

      const requiredHeaders = [
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset'
      ];

      for (const header of requiredHeaders) {
        expect(mockRes.headers[header]).toBeDefined();
      }
    });
  });

  describe('Edge Cases', () => {
    test('should handle very large remaining value', () => {
      const now = Date.now();
      const rateLimitInfo = {
        limit: 1000000,
        remaining: 999999,
        resetTime: now + 60000,
        windowSeconds: 60
      };

      manager.applyHeaders(mockRes, rateLimitInfo);

      expect(mockRes.headers['X-RateLimit-Remaining']).toBe('999999');
    });

    test('should handle reset time far in future', () => {
      const now = Date.now();
      const farFutureTime = now + (86400 * 30 * 1000); // 30 days

      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: farFutureTime,
        windowSeconds: 86400
      };

      manager.applyHeaders(mockRes, rateLimitInfo);

      expect(mockRes.headers['X-RateLimit-Reset']).toBeDefined();
      expect(parseInt(mockRes.headers['X-RateLimit-Reset'])).toBeGreaterThan(0);
    });

    test('should handle microsecond precision in timing', () => {
      const now = Date.now();
      const resetTime = now + 60123; // 60.123 seconds

      const rateLimitInfo = {
        limit: 100,
        remaining: 50,
        resetTime: resetTime,
        windowSeconds: 60
      };

      manager.applyHeaders(mockRes, rateLimitInfo);

      const resetHeader = parseInt(mockRes.headers['X-RateLimit-Reset']);
      expect(resetHeader).toBe(Math.floor(resetTime / 1000));
    });
  });
});
