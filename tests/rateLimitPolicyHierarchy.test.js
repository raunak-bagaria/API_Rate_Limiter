/**
 * Tests for Rate Limit Policy Hierarchy and Conflict Resolution
 * 
 * Tests the rule hierarchy: Client-specific > Endpoint-specific > Global
 * Validates deterministic conflict resolution
 */

import { jest } from '@jest/globals';
import RateLimitPolicyManager from '../src/rateLimitPolicyManager.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test fixtures directory
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TEST_POLICY_FILE = path.join(FIXTURES_DIR, 'test_hierarchy_policies.csv');

describe('Rate Limit Policy Hierarchy', () => {
  let policyManager;

  beforeEach(() => {
    // Ensure fixtures directory exists
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (policyManager) {
      policyManager.destroy();
      policyManager = null;
    }
    
    // Cleanup test file
    if (fs.existsSync(TEST_POLICY_FILE)) {
      fs.unlinkSync(TEST_POLICY_FILE);
    }
  });

  describe('Rule Hierarchy - Client-Specific > Endpoint-Specific > Global', () => {
    test('should prioritize client-specific rule over endpoint-specific', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,client123,,,1000,60\n' +  // Client-specific
                      '2,/api/users,,,,500,60\n';            // Endpoint-specific

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users',
        apiKey: 'client123',
        tier: 'free'
      });

      expect(result).not.toBeNull();
      expect(result.policy.id).toBe('1');
      expect(result.hierarchyLevel).toBe('client-specific');
      expect(result.matchDetails.hasApiKey).toBe(true);
      expect(result.policy.limit).toBe('1000');
    });

    test('should prioritize endpoint-specific rule over global tier', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,,,,500,60\n' +   // Endpoint-specific
                      '2,,,,,100,60\n';              // Global (tier-only)

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users',
        tier: 'free'
      });

      expect(result).not.toBeNull();
      expect(result.policy.id).toBe('1');
      expect(result.hierarchyLevel).toBe('endpoint-specific');
      expect(result.matchDetails.hasEndpoint).toBe(true);
      expect(result.policy.limit).toBe('500');
    });

    test('should fall back to global tier rule when no specific rules match', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/admin,,,,1000,60\n' +  // Different endpoint
                      '2,,,,free,100,60\n';          // Global tier

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users',
        tier: 'free'
      });

      expect(result).not.toBeNull();
      expect(result.policy.id).toBe('2');
      expect(result.hierarchyLevel).toBe('global');
      expect(result.matchDetails.hasTier).toBe(true);
      expect(result.policy.limit).toBe('100');
    });
  });

  describe('Conflict Resolution - Overlapping Rules', () => {
    test('should resolve conflict with all three rule types present', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,client123,,,1000,60\n' +  // Client-specific
                      '2,/api/users,,,,500,60\n' +            // Endpoint-specific
                      '3,,,,free,100,60\n';                   // Global

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users',
        apiKey: 'client123',
        tier: 'free'
      });

      // Client-specific should win
      expect(result.policy.id).toBe('1');
      expect(result.hierarchyLevel).toBe('client-specific');
      expect(result.score).toBeGreaterThan(10000);
    });

    test('should handle multiple endpoint-specific rules with different specificity', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,,,,500,60\n' +            // Exact match
                      '2,/api/users/:id,,,,300,60\n' +        // Parameterized
                      '3,*,,,,100,60\n';                      // Wildcard

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users'
      });

      // Exact match should win over parameterized and wildcard
      expect(result.policy.id).toBe('1');
      expect(result.policy.limit).toBe('500');
    });

    test('should match parameterized endpoint correctly', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users/:id,,,,300,60\n' +
                      '2,*,,,,100,60\n';

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users/123'
      });

      // Parameterized should match and win over wildcard
      expect(result.policy.id).toBe('1');
      expect(result.policy.limit).toBe('300');
    });

    test('should handle IP/CIDR rules correctly', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,,,192.168.1.100,,800,60\n' +        // Exact IP
                      '2,,,192.168.1.0/24,,600,60\n' +       // CIDR range
                      '3,,,,free,100,60\n';                  // Global

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      // Test exact IP match
      let result = policyManager.selectBestMatchingPolicy({
        ip: '192.168.1.100',
        tier: 'free'
      });

      expect(result.policy.id).toBe('1');
      expect(result.hierarchyLevel).toBe('ip-specific');
      expect(result.policy.limit).toBe('800');

      // Test CIDR match
      result = policyManager.selectBestMatchingPolicy({
        ip: '192.168.1.50',
        tier: 'free'
      });

      expect(result.policy.id).toBe('2');
      expect(result.hierarchyLevel).toBe('ip-specific');
      expect(result.policy.limit).toBe('600');
    });
  });

  describe('Complex Scenarios', () => {
    test('should handle client-specific with endpoint and tier', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,client123,,premium,2000,60\n' +  // Most specific
                      '2,/api/users,client123,,,1500,60\n' +         // Client + endpoint
                      '3,/api/users,,,,500,60\n';                    // Endpoint only

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users',
        apiKey: 'client123',
        tier: 'premium'
      });

      // Most specific (all criteria) should win
      expect(result.policy.id).toBe('1');
      expect(result.policy.limit).toBe('2000');
      expect(result.matchDetails.hasApiKey).toBe(true);
      expect(result.matchDetails.hasEndpoint).toBe(true);
      expect(result.matchDetails.hasTier).toBe(true);
    });

    test('should return null when no rules match', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/admin,,,,1000,60\n';

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users',
        tier: 'free'
      });

      expect(result).toBeNull();
    });

    test('should handle case-insensitive tier matching', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,,,,premium,1000,60\n';

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        tier: 'PREMIUM'
      });

      expect(result).not.toBeNull();
      expect(result.policy.id).toBe('1');
      expect(result.matchDetails.hasTier).toBe(true);
    });
  });

  describe('Deterministic Behavior', () => {
    test('should always return the same result for identical requests', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,client123,,,1000,60\n' +
                      '2,/api/users,,,,500,60\n' +
                      '3,,,,free,100,60\n';

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const request = {
        endpoint: '/api/users',
        apiKey: 'client123',
        tier: 'free'
      };

      // Call multiple times
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(policyManager.selectBestMatchingPolicy(request));
      }

      // All results should be identical
      results.forEach(result => {
        expect(result.policy.id).toBe('1');
        expect(result.hierarchyLevel).toBe('client-specific');
        expect(result.score).toBe(results[0].score);
      });
    });

    test('should provide consistent scoring across multiple requests', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,client123,,,1000,60\n' +
                      '2,/api/products,client456,,,1000,60\n';

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result1 = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users',
        apiKey: 'client123'
      });

      const result2 = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/products',
        apiKey: 'client456'
      });

      // Both should have same hierarchy level and similar scores
      expect(result1.hierarchyLevel).toBe(result2.hierarchyLevel);
      expect(result1.score).toBe(result2.score);
    });
  });

  describe('Match Details Validation', () => {
    test('should correctly report all match details', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,client123,192.168.1.0/24,premium,1000,60\n';

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users',
        apiKey: 'client123',
        ip: '192.168.1.50',
        tier: 'premium'
      });

      expect(result.matchDetails.hasApiKey).toBe(true);
      expect(result.matchDetails.hasEndpoint).toBe(true);
      expect(result.matchDetails.hasIpOrCidr).toBe(true);
      expect(result.matchDetails.hasTier).toBe(true);
    });

    test('should report partial matches correctly', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,client123,,,1000,60\n';

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const result = policyManager.selectBestMatchingPolicy({
        endpoint: '/api/users',
        apiKey: 'client123'
      });

      expect(result.matchDetails.hasApiKey).toBe(true);
      expect(result.matchDetails.hasEndpoint).toBe(true);
      expect(result.matchDetails.hasIpOrCidr).toBe(false);
      expect(result.matchDetails.hasTier).toBe(false);
    });
  });

  describe('Backward Compatibility', () => {
    test('should maintain compatibility with findPoliciesForRequest', () => {
      const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
                      '1,/api/users,client123,,,1000,60\n' +
                      '2,/api/users,,,,500,60\n';

      fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);

      const request = {
        endpoint: '/api/users',
        apiKey: 'client123'
      };

      const oldMethod = policyManager.findPoliciesForRequest(request);
      const newMethod = policyManager.selectBestMatchingPolicy(request);

      // First policy from old method should match the new method
      expect(newMethod.policy.id).toBe(oldMethod[0].id);
    });
  });
});
