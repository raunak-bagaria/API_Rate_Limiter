/**
 * System Integration Tests
 * 
 * Tests the complete API Rate Limiter system with all components working together:
 * 1. Client Identification (API Key + IP Management)
 * 2. Rate Limiting (Multiple time windows)
 * 3. IP Allow/Block Lists
 * 4. Error Message Management
 * 5. Policy Management
 * 6. Admin APIs
 * 
 * These tests verify the full end-to-end functionality of the system.
 */

import request from 'supertest';
import app from '../src/app.js';

describe('System Integration Tests', () => {
  
  // Note: supertest handles the server lifecycle automatically
  // No need to start/stop the server manually
  
  // Test data
  const validApiKeys = {
    free: '12345-ABCDE',      // Client A - Free tier
    premium: '54321-ZYXWV',   // Premium tier
    enterprise: '11111-AAAAA' // Enterprise tier
  };

  const testIP = '192.168.1.100';
  const allowlistedIP = '192.168.100.50';
  const blocklistedIP = '192.168.1.101';

  // Helper function to reset rate limits before tests
  const resetRateLimits = async () => {
    await request(app).post('/admin/rate-limits/Client A/reset').catch(() => {});
    await request(app).post('/admin/rate-limits/Client B/reset').catch(() => {});
    await request(app).post('/admin/rate-limits/Client C/reset').catch(() => {});
    await request(app).post('/admin/rate-limits/Client D/reset').catch(() => {});
  };

  // Reset rate limits before all tests
  beforeAll(async () => {
    await resetRateLimits();
  });

  describe('1. Complete Request Flow - Success Path', () => {
    test('should handle valid request with API key, IP check, and rate limit', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', testIP);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('classification');
      expect(response.body.classification).toBe('free');
    });

    test('should process tier-info endpoint with all components', async () => {
      const response = await request(app)
        .get('/tier-info')
        .set('X-API-Key', validApiKeys.premium)
        .set('X-Forwarded-For', testIP);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('tier', 'premium');
      expect(response.body).toHaveProperty('features');
      expect(response.body.features.length).toBeGreaterThan(0);
    });
  });

  describe('2. Client Identification Integration', () => {
    test('should reject request without API key', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-Forwarded-For', testIP);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('message');
    });

    test('should reject request with invalid API key', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', 'INVALID-KEY')
        .set('X-Forwarded-For', testIP);

      expect(response.status).toBe(401);
      expect(response.body.error).toHaveProperty('message');
    });

    test('should identify client tier correctly and apply tier-specific access', async () => {
      // Free tier should not access premium endpoint
      const freeResponse = await request(app)
        .get('/premium-only')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', testIP);

      expect(freeResponse.status).toBe(403);
      expect(freeResponse.body.error).toHaveProperty('yourTier', 'free');

      // Premium tier should access premium endpoint
      const premiumResponse = await request(app)
        .get('/premium-only')
        .set('X-API-Key', validApiKeys.premium)
        .set('X-Forwarded-For', testIP);

      expect([200, 429]).toContain(premiumResponse.status);
    });
  });

  describe('3. IP Allow/Block List Integration', () => {
    beforeAll(async () => {
      // Add test IPs to lists
      await request(app)
        .post('/admin/blocklist/add')
        .send({
          ip_or_cidr: blocklistedIP,
          description: 'Test blocked IP'
        });

      await request(app)
        .post('/admin/allowlist/add')
        .send({
          ip_or_cidr: allowlistedIP,
          description: 'Test allowed IP'
        });
    });

    afterAll(async () => {
      // Clean up test IPs
      await request(app)
        .delete('/admin/blocklist/remove')
        .send({ ip_or_cidr: blocklistedIP });

      await request(app)
        .delete('/admin/allowlist/remove')
        .send({ ip_or_cidr: allowlistedIP });
    });

    test('should block requests from blocklisted IP regardless of valid API key', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKeys.premium)
        .set('X-Forwarded-For', blocklistedIP);

      expect(response.status).toBe(403);
      expect(response.body.error).toHaveProperty('clientIP', blocklistedIP);
      expect(response.body.error.message).toContain('blocked');
    });

    test('should allow requests from allowlisted IP with valid API key', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', allowlistedIP);

      expect(response.status).toBe(200);
    });

    test('should handle CIDR ranges in blocklist', async () => {
      // Add CIDR range to blocklist
      const cidrRange = '10.0.0.0/24';
      await request(app)
        .post('/admin/blocklist/add')
        .send({
          ip_or_cidr: cidrRange,
          description: 'Test CIDR block'
        });

      // Test IP within CIDR range
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', '10.0.0.50');

      expect(response.status).toBe(403);

      // Clean up
      await request(app)
        .delete('/admin/blocklist/remove')
        .send({ ip_or_cidr: cidrRange });
    });
  });

  describe('4. Rate Limiting Integration', () => {
    const testClientKey = validApiKeys.free; // 1 req/second for free tier

    beforeAll(async () => {
      // Reset rate limits for test client before this suite
      await request(app).post('/admin/rate-limits/Client A/reset');
    });

    beforeEach(async () => {
      // Wait a bit between tests to avoid rate limit carryover
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    test('should enforce rate limits and return 429 when exceeded', async () => {
      // First request should succeed
      const response1 = await request(app)
        .get('/data')
        .set('X-API-Key', testClientKey)
        .set('X-Forwarded-For', '192.168.2.1');

      expect(response1.status).toBe(200);

      // Second request immediately should be rate limited (free tier: 1 req/sec)
      const response2 = await request(app)
        .get('/data')
        .set('X-API-Key', testClientKey)
        .set('X-Forwarded-For', '192.168.2.1');

      expect(response2.status).toBe(429);
      expect(response2.headers).toHaveProperty('retry-after');
      expect(response2.body.error).toHaveProperty('limitingWindow');
      expect(response2.body.error).toHaveProperty('retryAfter');
    });

    test('should include all time windows status in rate limit response', async () => {
      // Trigger rate limit
      await request(app)
        .get('/data')
        .set('X-API-Key', testClientKey)
        .set('X-Forwarded-For', '192.168.2.2');

      const response = await request(app)
        .get('/data')
        .set('X-API-Key', testClientKey)
        .set('X-Forwarded-For', '192.168.2.2');

      expect(response.status).toBe(429);
      expect(response.body.error).toHaveProperty('windows');
      expect(response.body.error.windows).toHaveProperty('second');
      expect(response.body.error.windows).toHaveProperty('minute');
      expect(response.body.error.windows).toHaveProperty('hour');
      expect(response.body.error.windows).toHaveProperty('day');
    });

    test('should allow premium tier higher rate limits', async () => {
      const premiumKey = validApiKeys.premium; // 50 req/second

      // Make multiple rapid requests
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .get('/data')
            .set('X-API-Key', premiumKey)
            .set('X-Forwarded-For', '192.168.2.3')
        );
      }

      const responses = await Promise.all(requests);
      const successfulResponses = responses.filter(r => r.status === 200);

      // Premium tier should handle at least 10 requests/second
      expect(successfulResponses.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('5. Error Message Management Integration', () => {
    test('should return custom error messages for rate limit', async () => {
      const testKey = validApiKeys.free;

      // Trigger rate limit
      await request(app)
        .get('/data')
        .set('X-API-Key', testKey)
        .set('X-Forwarded-For', '192.168.3.1');

      const response = await request(app)
        .get('/data')
        .set('X-API-Key', testKey)
        .set('X-Forwarded-For', '192.168.3.1');

      expect(response.status).toBe(429);
      expect(response.body.error.message).toBeTruthy();
      expect(typeof response.body.error.message).toBe('string');
    });

    test('should return custom error for unauthorized access', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-Forwarded-For', testIP);

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBeTruthy();
    });

    test('should return custom error for tier restriction', async () => {
      const response = await request(app)
        .get('/premium-only')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', testIP);

      expect(response.status).toBe(403);
      expect(response.body.error.message).toBeTruthy();
      expect(response.body.error).toHaveProperty('requiredTier');
    });

    test('should return custom error for IP blocklist', async () => {
      // Use the blocklisted IP added earlier
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', blocklistedIP);

      expect(response.status).toBe(403);
      expect(response.body.error.message).toBeTruthy();
      expect(response.body.error.clientIP).toBe(blocklistedIP);
    });
  });

  describe('6. Admin API Integration', () => {
    test('should get comprehensive statistics including all components', async () => {
      const response = await request(app)
        .get('/admin/stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('apiKeyClients');
      expect(response.body).toHaveProperty('ipLists');
      expect(response.body).toHaveProperty('rateLimits');
      expect(response.body.ipLists).toHaveProperty('allowlist');
      expect(response.body.ipLists).toHaveProperty('blocklist');
    });

    test('should reload all configurations', async () => {
      const response = await request(app)
        .post('/admin/reload');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('statistics');
      expect(response.body).toHaveProperty('ipLists');
    });

    test('should manage IP allowlist through admin API', async () => {
      const testCIDR = '172.16.0.0/24';

      // Add to allowlist
      const addResponse = await request(app)
        .post('/admin/allowlist/add')
        .send({
          ip_or_cidr: testCIDR,
          description: 'Test CIDR allowlist'
        });

      expect(addResponse.status).toBe(200);
      expect(addResponse.body.ip_or_cidr).toBe(testCIDR);

      // Verify it's in stats
      const statsResponse = await request(app)
        .get('/admin/stats');

      expect(statsResponse.body.ipLists.allowlist.totalEntries).toBeGreaterThan(0);

      // Remove from allowlist
      const removeResponse = await request(app)
        .delete('/admin/allowlist/remove')
        .send({ ip_or_cidr: testCIDR });

      expect(removeResponse.status).toBe(200);
    });

    test('should manage rate limits through admin API', async () => {
      // Get tier limits
      const getResponse = await request(app)
        .get('/admin/rate-limits/tier/free');

      expect(getResponse.status).toBe(200);
      expect(getResponse.body).toHaveProperty('limits');

      // Update tier limits
      const updateResponse = await request(app)
        .put('/admin/rate-limits/tier/free')
        .send({
          second: 2,
          minute: 20
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.limits.second).toBe(2);

      // Restore original limits
      await request(app)
        .put('/admin/rate-limits/tier/free')
        .send({
          second: 1,
          minute: 10,
          hour: 100,
          day: 1000
        });
    });

    test('should get client-specific rate limit statistics', async () => {
      // Make a request to generate stats
      await request(app)
        .get('/data')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', '192.168.4.1');

      const response = await request(app)
        .get('/admin/rate-limits/Client A');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('clientName', 'Client A');
      expect(response.body).toHaveProperty('windows');
    });
  });

  describe('7. Multi-Component Failure Scenarios', () => {
    test('should prioritize IP blocklist over valid API key and rate limits', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKeys.enterprise) // Highest tier
        .set('X-Forwarded-For', blocklistedIP);

      expect(response.status).toBe(403);
      expect(response.body.error.clientIP).toBe(blocklistedIP);
    });

    test('should check API key before rate limit', async () => {
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', 'INVALID')
        .set('X-Forwarded-For', testIP);

      expect(response.status).toBe(401); // Not 429
    });

    test('should check rate limit before tier access', async () => {
      // Exhaust rate limit for free tier
      await request(app)
        .get('/data')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', '192.168.5.1');

      // Try to access any endpoint
      const response = await request(app)
        .get('/tier-info')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', '192.168.5.1');

      expect(response.status).toBe(429);
    });
  });

  describe('8. Concurrent Request Handling', () => {
    beforeAll(async () => {
      // Reset all clients before concurrent tests
      await resetRateLimits();
    });

    test('should handle concurrent requests from different clients', async () => {
      const requests = [
        request(app)
          .get('/data')
          .set('X-API-Key', validApiKeys.free)
          .set('X-Forwarded-For', '192.168.6.1'),
        request(app)
          .get('/data')
          .set('X-API-Key', validApiKeys.premium)
          .set('X-Forwarded-For', '192.168.6.2'),
        request(app)
          .get('/tier-info')
          .set('X-API-Key', validApiKeys.enterprise)
          .set('X-Forwarded-For', '192.168.6.3')
      ];

      const responses = await Promise.all(requests);

      // All should get responses (either 200 or rate limited)
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status);
      });
    });

    test('should maintain separate rate limits for different clients', async () => {
      // Reset both clients first
      await request(app).post('/admin/rate-limits/Client A/reset');
      await request(app).post('/admin/rate-limits/Client B/reset');

      // Client 1 - Free tier (1 req/sec) - make requests sequentially
      let client1RateLimited = 0;
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .get('/data')
          .set('X-API-Key', validApiKeys.free)
          .set('X-Forwarded-For', '192.168.7.1');
        if (response.status === 429) client1RateLimited++;
      }

      // Client 1 should get rate limited
      expect(client1RateLimited).toBeGreaterThan(0);

      // Client 2 - Premium tier (50 req/sec) - can handle more concurrent requests
      const client2Requests = [];
      for (let i = 0; i < 10; i++) {
        client2Requests.push(
          request(app)
            .get('/data')
            .set('X-API-Key', validApiKeys.premium)
            .set('X-Forwarded-For', '192.168.7.2')
        );
      }

      const client2Responses = await Promise.all(client2Requests);
      const client2Success = client2Responses.filter(r => r.status === 200);
      
      // Client 2 should succeed more often (but may still hit some limits due to concurrency)
      expect(client2Success.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('9. Health Check and Monitoring', () => {
    test('should respond to health check', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('service');
    });

    test('should return 404 for non-existent endpoints', async () => {
      const response = await request(app)
        .get('/non-existent-endpoint');

      expect(response.status).toBe(404);
      expect(response.body.error).toHaveProperty('message');
    });
  });

  describe('10. End-to-End User Journey', () => {
    test('complete user journey: from first request to rate limit to recovery', async () => {
      const userKey = validApiKeys.free;
      const userIP = '192.168.8.1';

      // Reset rate limits first
      await request(app).post('/admin/rate-limits/Client A/reset');

      // Step 1: First successful request
      const request1 = await request(app)
        .get('/data')
        .set('X-API-Key', userKey)
        .set('X-Forwarded-For', userIP);

      expect(request1.status).toBe(200);
      expect(request1.body.message).toContain('Client A');

      // Step 2: Check tier info (will be rate limited)
      const tierInfo = await request(app)
        .get('/tier-info')
        .set('X-API-Key', userKey)
        .set('X-Forwarded-For', userIP);

      expect(tierInfo.status).toBe(429); // Rate limited because free tier is 1 req/sec
      expect(tierInfo.body.error).toHaveProperty('retryAfter');

      // Step 3: Admin resets rate limit
      const reset = await request(app)
        .post('/admin/rate-limits/Client A/reset');

      expect(reset.status).toBe(200);

      // Step 4: Try premium endpoint (should fail on tier, not rate limit)
      const premiumAttempt = await request(app)
        .get('/premium-only')
        .set('X-API-Key', userKey)
        .set('X-Forwarded-For', userIP);

      expect(premiumAttempt.status).toBe(403);
      expect(premiumAttempt.body.error.yourTier).toBe('free');

      // Step 5: Check statistics
      const stats = await request(app)
        .get('/admin/rate-limits/Client A');

      expect(stats.status).toBe(200);
      expect(stats.body.clientName).toBe('Client A');
    }, 15000); // Increase timeout for this test
  });

  describe('11. Policy Management Integration', () => {
    test('should get current policy version', async () => {
      const response = await request(app)
        .get('/admin/policies/version');

      expect([200, 404]).toContain(response.status);
      if (response.status === 200) {
        expect(response.body).toHaveProperty('version');
      }
    });

    test('should get all policies', async () => {
      const response = await request(app)
        .get('/admin/policies');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('policies');
      expect(Array.isArray(response.body.policies)).toBe(true);
    });

    test('should validate policies', async () => {
      const response = await request(app)
        .post('/admin/policies/validate')
        .send({
          policies: [
            {
              id: 'test-1',
              endpoint: '/test',
              tier: 'free',
              limit: 10,
              window: 60
            }
          ]
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('valid');
    });

    test('should get policy history', async () => {
      const response = await request(app)
        .get('/admin/policies/history?limit=5');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('versions');
      expect(Array.isArray(response.body.versions)).toBe(true);
    });
  });

  describe('12. Data Persistence and Reload', () => {
    test('should persist IP list changes across reloads', async () => {
      const testIP = '203.0.113.50';

      // Add IP to blocklist
      await request(app)
        .post('/admin/blocklist/add')
        .send({
          ip_or_cidr: testIP,
          description: 'Persistence test'
        });

      // Reload configuration
      await request(app)
        .post('/admin/reload');

      // Verify IP is still blocked
      const response = await request(app)
        .get('/data')
        .set('X-API-Key', validApiKeys.free)
        .set('X-Forwarded-For', testIP);

      expect(response.status).toBe(403);

      // Clean up
      await request(app)
        .delete('/admin/blocklist/remove')
        .send({ ip_or_cidr: testIP });
    });
  });
});
