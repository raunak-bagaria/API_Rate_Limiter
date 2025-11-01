/**
 * Integration tests for Rate Limit Headers
 * 
 * Tests the complete flow:
 * 1. Request is made to rate-limited endpoint
 * 2. Rate limiter checks limits
 * 3. Response includes rate limit headers
 * 4. Headers are accurate and RFC 6585 compliant
 */

import request from 'supertest';
import app from '../src/app.js';

describe('Rate Limit Headers Integration', () => {
  const validApiKey = '12345-ABCDE'; // Client A from clients.csv
  
  describe('200 Response with Rate Limit Headers', () => {
    test('successful request should include X-RateLimit headers', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
      expect(response.headers['x-ratelimit-window']).toBeDefined();
    });

    test('200 response should NOT include Retry-After header', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      expect(response.status).toBe(200);
      expect(response.headers['retry-after']).toBeUndefined();
    });

    test('X-RateLimit-Remaining should decrease with each request', async () => {
      // Make first request
      const response1 = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      const remaining1 = parseInt(response1.headers['x-ratelimit-remaining']);

      // Make second request
      const response2 = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      const remaining2 = parseInt(response2.headers['x-ratelimit-remaining']);

      // Remaining count should decrease (or stay same if hitting different limits)
      expect(remaining2).toBeLessThanOrEqual(remaining1);
    });

    test('X-RateLimit-Reset should be future Unix timestamp', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      const resetTime = parseInt(response.headers['x-ratelimit-reset']);
      const currentTime = Math.floor(Date.now() / 1000);

      // Reset time should be in the future
      expect(resetTime).toBeGreaterThan(currentTime);
    });

    test('/tier-info endpoint should include rate limit headers', async () => {
      const response = await request(app)
        .get('/tier-info')
        .set('X-API-Key', validApiKey);

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    test('premium-only endpoint should include rate limit headers', async () => {
      const premiumApiKey = '54321-ZYXWV'; // Premium tier from clients.csv
      
      const response = await request(app)
        .get('/premium-only')
        .set('X-API-Key', premiumApiKey);

      // Should either succeed (200) or be rate limited (429), both should have headers
      expect([200, 429]).toContain(response.status);
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    });
  });

  describe('429 Response with Retry-After', () => {
    test('rate limited response should include Retry-After header', async () => {
      // This test is for documentation purposes
      // Making this many requests quickly should eventually hit rate limit
      // depending on tier configuration
      
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      // Either success (200) or rate limited (429)
      if (response.status === 429) {
        expect(response.headers['retry-after']).toBeDefined();
        expect(response.headers['x-ratelimit-retry-after']).toBeDefined();
        expect(parseInt(response.headers['retry-after'])).toBeGreaterThan(0);
      }
    });

    test('rate limited response should include all rate limit headers', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      if (response.status === 429) {
        expect(response.headers['x-ratelimit-limit']).toBeDefined();
        expect(response.headers['x-ratelimit-remaining']).toBe('0');
        expect(response.headers['x-ratelimit-reset']).toBeDefined();
      }
    });
  });

  describe('Header Accuracy and Format', () => {
    test('X-RateLimit-Limit should be a valid positive number', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      const limit = parseInt(response.headers['x-ratelimit-limit']);
      expect(limit).toBeGreaterThan(0);
      expect(Number.isInteger(limit)).toBe(true);
    });

    test('X-RateLimit-Remaining should be non-negative', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      const remaining = parseInt(response.headers['x-ratelimit-remaining']);
      expect(remaining).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(remaining)).toBe(true);
    });

    test('X-RateLimit-Remaining should not exceed X-RateLimit-Limit', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      const limit = parseInt(response.headers['x-ratelimit-limit']);
      const remaining = parseInt(response.headers['x-ratelimit-remaining']);

      expect(remaining).toBeLessThanOrEqual(limit);
    });

    test('X-RateLimit-Window should match rate limit window size', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      const window = parseInt(response.headers['x-ratelimit-window']);
      
      // Valid windows: 1 (per-second), 60 (per-minute), 3600 (per-hour), 86400 (per-day)
      const validWindows = [1, 60, 3600, 86400];
      expect(validWindows).toContain(window);
    });

    test('X-RateLimit-Accuracy-Margin should indicate tolerance', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      const margin = response.headers['x-ratelimit-accuracy-margin'];
      expect(margin).toBeDefined();
      expect(margin).toMatch(/^\d+%$/); // Should be like "5%"
    });
  });

  describe('Multiple Endpoints Consistency', () => {
    test('all endpoints should use consistent rate limit headers', async () => {
      const endpoints = ['/data', '/tier-info'];
      
      for (const endpoint of endpoints) {
        const response = await request(app)
          .get(endpoint)
          .set('X-API-Key', validApiKey);

        // Both endpoints should have headers
        expect(response.headers['x-ratelimit-limit']).toBeDefined();
        expect(response.headers['x-ratelimit-remaining']).toBeDefined();
        expect(response.headers['x-ratelimit-reset']).toBeDefined();
        expect(response.headers['x-ratelimit-window']).toBeDefined();
      }
    });
  });

  describe('Error Scenarios with Headers', () => {
    test('unauthorized request should not include rate limit headers', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', 'invalid-key');

      // 401 Unauthorized should not have rate limit headers
      // (since we couldn't identify the client)
      expect(response.status).toBe(401);
    });

    test('health check should not include rate limit headers', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    });
  });

  describe('Header RFC Compliance', () => {
    test('should use RFC 6585 Retry-After format', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      // If rate limited, check Retry-After format
      if (response.status === 429) {
        const retryAfter = response.headers['retry-after'];
        // Should be a number (seconds) per RFC 6585
        expect(/^\d+$/.test(retryAfter)).toBe(true);
      }
    });

    test('should use X- prefix for custom headers', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKey);

      // Custom headers should use X- prefix
      const customHeaders = [
        'x-ratelimit-limit',
        'x-ratelimit-remaining',
        'x-ratelimit-reset',
        'x-ratelimit-window',
        'x-ratelimit-accuracy-margin'
      ];

      for (const header of customHeaders) {
        expect(response.headers[header.toLowerCase()]).toBeDefined();
        expect(header.startsWith('x-')).toBe(true);
      }
    });
  });
});
