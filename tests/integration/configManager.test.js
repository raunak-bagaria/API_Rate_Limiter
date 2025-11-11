/**
 * Tests for ConfigManager hot-reload functionality
 */

/* eslint-env jest, node */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ConfigManager from '../../src/configManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test fixtures directory
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TEST_CONFIG_FILE = path.join(FIXTURES_DIR, 'test_config.csv');

// Sample validator
const sampleValidator = (config) => {
  const errors = [];
  const warnings = [];
  
  if (!Array.isArray(config)) {
    return { valid: false, errors: ['Config must be an array'], warnings: [] };
  }
  
  config.forEach((item, idx) => {
    if (!item.id) errors.push(`Item ${idx} missing id`);
    if (!item.limit) warnings.push(`Item ${idx} missing limit`);
  });
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

describe('ConfigManager', () => {
  let configManager;
  
  beforeEach(() => {
    // Ensure fixtures directory exists
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }
    
    // Create initial test config
    const initialConfig = 'id,limit,window\n1,100,60\n2,200,120\n';
    fs.writeFileSync(TEST_CONFIG_FILE, initialConfig, 'utf-8');
  });
  
  afterEach(() => {
    // Cleanup
    if (configManager) {
      configManager.destroy();
      configManager = null;
    }
    
    // Remove test file
    if (fs.existsSync(TEST_CONFIG_FILE)) {
      fs.unlinkSync(TEST_CONFIG_FILE);
    }
  });
  
  describe('Initialization', () => {
    test('should load initial configuration', () => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator);
      
      const config = configManager.getCurrentConfig();
      expect(config).toHaveLength(2);
      expect(config[0].id).toBe('1');
      expect(config[0].limit).toBe('100');
    });
  });
});
