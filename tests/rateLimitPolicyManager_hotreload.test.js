/**
 * Integration tests for RateLimitPolicyManager hot-reload functionality
 */

/* eslint-env jest, node */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import RateLimitPolicyManager from '../src/rateLimitPolicyManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test fixtures directory
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TEST_POLICY_FILE = path.join(FIXTURES_DIR, 'test_policies.csv');

describe('RateLimitPolicyManager Hot-Reload', () => {
  let policyManager;
  
  beforeEach(() => {
    // Ensure fixtures directory exists
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }
    
    // Create initial test policies
    const initialPolicies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
      '1,/data,12345-ABCDE,,premium,100,60\n' +
      '2,/tier-info,,,free,10,60\n';
    fs.writeFileSync(TEST_POLICY_FILE, initialPolicies, 'utf-8');
  });
  
  afterEach(() => {
    // Cleanup
    if (policyManager) {
      policyManager.destroy();
      policyManager = null;
    }
    
    // Remove test file
    if (fs.existsSync(TEST_POLICY_FILE)) {
      fs.unlinkSync(TEST_POLICY_FILE);
    }
  });
  
  describe('Initialization with Hot-Reload', () => {
    test('should initialize with hot-reload enabled by default', () => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
      
      expect(policyManager.configManager).toBeTruthy();
      expect(policyManager.enableHotReload).toBe(true);
      
      const policies = policyManager.getAllPolicies();
      expect(policies).toHaveLength(2);
    });
    
    test('should initialize without hot-reload when disabled', () => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);
      
      expect(policyManager.configManager).toBeFalsy();
      expect(policyManager.enableHotReload).toBe(false);
    });
    
    test('should get current version info', () => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
      
      const version = policyManager.getCurrentVersion();
      expect(version).toBeTruthy();
      expect(version.version).toBeTruthy();
      expect(version.timestamp).toBeTruthy();
    });
  });
  
  describe('Policy Validation', () => {
    beforeEach(() => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
    });
    
    test('should validate valid policies', () => {
      const validPolicies = [
        { id: '1', endpoint: '/test', api_key: 'key123', ip_or_cidr: '', tier: '', limit: '100', window: '60' },
        { id: '2', endpoint: '/test2', api_key: '', ip_or_cidr: '192.168.1.0/24', tier: '', limit: '200', window: '120' }
      ];
      
      const result = policyManager.validatePolicies(validPolicies);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    test('should detect missing required fields', () => {
      const invalidPolicies = [
        { id: '1', endpoint: '/test', api_key: '', ip_or_cidr: '', tier: '', limit: '', window: '60' } // Missing limit
      ];
      
      const result = policyManager.validatePolicies(invalidPolicies);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join(' ')).toContain('limit is required');
    });
    
    test('should detect missing matching criteria', () => {
      const invalidPolicies = [
        { id: '1', endpoint: '', api_key: '', ip_or_cidr: '', tier: '', limit: '100', window: '60' }
      ];
      
      const result = policyManager.validatePolicies(invalidPolicies);
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('at least one');
    });
    
    test('should detect duplicate IDs', () => {
      const invalidPolicies = [
        { id: '1', endpoint: '/test1', api_key: '', ip_or_cidr: '', tier: '', limit: '100', window: '60' },
        { id: '1', endpoint: '/test2', api_key: '', ip_or_cidr: '', tier: '', limit: '200', window: '120' }
      ];
      
      const result = policyManager.validatePolicies(invalidPolicies);
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('Duplicate');
    });
    
    test('should validate and sanitize limit values', () => {
      const policies = [
        { id: '1', endpoint: '/test', api_key: '', ip_or_cidr: '', tier: '', limit: '1e10', window: '60' }
      ];
      
      const result = policyManager.validatePolicies(policies);
      expect(result.valid).toBe(true);
      // Limit should be sanitized to a proper number
      expect(policies[0].limit).toBeTruthy();
    });
  });
  
  describe('Manual Reload', () => {
    beforeEach(() => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
    });
    
    test('should reload policies successfully', async () => {
      // Update policy file
      const newPolicies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
        '1,/data,12345-ABCDE,,premium,100,60\n' +
        '2,/tier-info,,,free,10,60\n' +
        '3,/premium-only,,,premium,50,60\n';
      fs.writeFileSync(TEST_POLICY_FILE, newPolicies, 'utf-8');
      
      const result = await policyManager.triggerReload();
      
      expect(result.success).toBe(true);
      expect(result.entriesCount).toBe(3);
      
      const policies = policyManager.getAllPolicies();
      expect(policies).toHaveLength(3);
    });
    
    test('should reject invalid policies on reload', async () => {
      // Write invalid policies
      const invalidPolicies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
        '1,,,,,100,60\n'; // Missing matching criteria
      fs.writeFileSync(TEST_POLICY_FILE, invalidPolicies, 'utf-8');
      
      const result = await policyManager.triggerReload();
      
      expect(result.success).toBe(false);
      expect(result.errors).toBeTruthy();
      
      // Old policies should still be in place
      const policies = policyManager.getAllPolicies();
      expect(policies).toHaveLength(2);
    });
    
    test('should fail gracefully when hot-reload disabled', async () => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);
      
      const result = await policyManager.triggerReload();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });
  });
  
  describe('Automatic File Watching', () => {
    beforeEach(() => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
    });
    
    test('should detect and reload file changes automatically', async () => {
      // Wait for watcher to start
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Setup event listener
      const changePromise = new Promise((resolve) => {
        policyManager.configManager.once('configChanged', (event) => {
          resolve(event);
        });
      });
      
      // Update policy file
      const newPolicies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
        '1,/data,12345-ABCDE,,premium,100,60\n' +
        '2,/tier-info,,,free,10,60\n' +
        '3,/premium-only,,,premium,50,60\n' +
        '4,/test,,,basic,25,60\n';
      fs.writeFileSync(TEST_POLICY_FILE, newPolicies, 'utf-8');
      
      // Wait for change event (with timeout)
      const event = await Promise.race([
        changePromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout waiting for config change')), 10000)
        )
      ]);
      
      expect(event.newConfig).toHaveLength(4);
      
      // Verify policies were updated
      const policies = policyManager.getAllPolicies();
      expect(policies).toHaveLength(4);
    }, 15000);
    
    test('should not reload invalid file changes', async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const initialPolicies = policyManager.getAllPolicies();
      
      // Setup event listener for validation failure
      const failPromise = new Promise((resolve) => {
        policyManager.configManager.once('configValidationFailed', (event) => {
          resolve(event);
        });
      });
      
      // Write invalid policies
      const invalidPolicies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
        '1,,,,,100,60\n';
      fs.writeFileSync(TEST_POLICY_FILE, invalidPolicies, 'utf-8');
      
      // Wait for validation failure event
      const event = await Promise.race([
        failPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        )
      ]);
      
      expect(event.errors).toBeTruthy();
      
      // Policies should remain unchanged
      const currentPolicies = policyManager.getAllPolicies();
      expect(currentPolicies).toHaveLength(initialPolicies.length);
    }, 15000);
  });
  
  describe('Rollback', () => {
    beforeEach(() => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
    });
    
    test('should rollback to previous policy version', async () => {
      const initialPolicies = policyManager.getAllPolicies();
      expect(initialPolicies).toHaveLength(2);
      
      // Make a change
      const newPolicies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
        '1,/data,12345-ABCDE,,premium,100,60\n' +
        '2,/tier-info,,,free,10,60\n' +
        '3,/premium-only,,,premium,50,60\n';
      fs.writeFileSync(TEST_POLICY_FILE, newPolicies, 'utf-8');
      await policyManager.triggerReload();
      
      expect(policyManager.getAllPolicies()).toHaveLength(3);
      
      // Rollback
      const result = await policyManager.rollback();
      expect(result.success).toBe(true);
      
      // Wait for file watcher to detect rollback
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Policies should be back to initial state
      const currentPolicies = policyManager.getAllPolicies();
      expect(currentPolicies).toHaveLength(2);
    }, 10000);
    
    test('should fail rollback when hot-reload disabled', async () => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);
      
      const result = await policyManager.rollback();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });
  });
  
  describe('Version History', () => {
    beforeEach(() => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
    });
    
    test('should track version history', async () => {
      // Make multiple changes
      for (let i = 3; i <= 5; i++) {
        const policies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
          Array.from({length: i}, (_, idx) => 
            `${idx+1},/test${idx+1},,,free,${(idx+1)*10},60`
          ).join('\n') + '\n';
        
        fs.writeFileSync(TEST_POLICY_FILE, policies, 'utf-8');
        await policyManager.triggerReload();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const history = policyManager.getVersionHistory();
      expect(history.length).toBeGreaterThan(1);
    });
    
    test('should return empty history when hot-reload disabled', () => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);
      
      const history = policyManager.getVersionHistory();
      expect(history).toHaveLength(0);
    });
  });
  
  describe('Statistics', () => {
    beforeEach(() => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
    });
    
    test('should get hot-reload statistics', async () => {
      // Make a successful reload
      const newPolicies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
        '1,/data,12345-ABCDE,,premium,100,60\n' +
        '2,/tier-info,,,free,10,60\n' +
        '3,/test,,,basic,25,60\n';
      fs.writeFileSync(TEST_POLICY_FILE, newPolicies, 'utf-8');
      await policyManager.triggerReload();
      
      const stats = policyManager.getHotReloadStats();
      expect(stats).toBeTruthy();
      expect(stats.totalReloads).toBeGreaterThan(0);
      expect(stats.currentVersion).toBeTruthy();
    });
    
    test('should return null when hot-reload disabled', () => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, false);
      
      const stats = policyManager.getHotReloadStats();
      expect(stats).toBeNull();
    });
  });
  
  describe('Request Handling During Reload', () => {
    beforeEach(() => {
      policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
    });
    
    test('should handle requests during config reload without dropping them', async () => {
      // Start a reload
      const newPolicies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
        '1,/data,12345-ABCDE,,premium,100,60\n' +
        '2,/tier-info,,,free,10,60\n' +
        '3,/test,,,basic,25,60\n';
      fs.writeFileSync(TEST_POLICY_FILE, newPolicies, 'utf-8');
      
      const reloadPromise = policyManager.triggerReload();
      
      // Try to find policies while reload is in progress
      const result = policyManager.findPoliciesForRequest({
        endpoint: '/data',
        apiKey: '12345-ABCDE',
        ip: '192.168.1.1',
        tier: 'premium'
      });
      
      // Should still work (either old or new config)
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      
      await reloadPromise;
    });
    
    test('should maintain consistency during concurrent operations', async () => {
      const operations = [];
      
      // Start multiple operations concurrently
      for (let i = 0; i < 5; i++) {
        // Reload operation
        const newPolicies = 'id,endpoint,api_key,ip_or_cidr,tier,limit,window\n' +
          Array.from({length: i + 2}, (_, idx) => 
            `${idx+1},/test${idx+1},,,free,${(idx+1)*10},60`
          ).join('\n') + '\n';
        fs.writeFileSync(TEST_POLICY_FILE, newPolicies, 'utf-8');
        operations.push(policyManager.triggerReload());
        
        // Query operations
        operations.push(Promise.resolve(policyManager.getAllPolicies()));
        operations.push(Promise.resolve(policyManager.findPoliciesForRequest({
          endpoint: '/test1',
          apiKey: '',
          ip: '',
          tier: 'free'
        })));
      }
      
      // All operations should complete without errors
      const results = await Promise.all(operations);
      expect(results).toBeDefined();
      
      // Final state should be consistent
      const finalPolicies = policyManager.getAllPolicies();
      expect(Array.isArray(finalPolicies)).toBe(true);
    });
  });
});
