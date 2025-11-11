/**
 * Integration tests for RateLimitPolicyManager hot-reload functionality
 */

/* eslint-env jest, node */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import RateLimitPolicyManager from '../../src/rateLimitPolicyManager.js';

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

  test('should initialize with hot-reload enabled by default', () => {
    policyManager = new RateLimitPolicyManager(TEST_POLICY_FILE, true);
    expect(policyManager.configManager).toBeTruthy();
  });
});
