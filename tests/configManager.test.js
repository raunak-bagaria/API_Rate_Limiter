/**
 * Tests for ConfigManager hot-reload functionality
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jest } from '@jest/globals';
import ConfigManager from '../src/configManager.js';

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
    
    test('should create version snapshot on initialization', () => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator);
      
      const version = configManager.getCurrentVersion();
      expect(version).toBeTruthy();
      expect(version.version).toBeTruthy();
      expect(version.appliedAt).toBeTruthy();
    });
    
    test('should fail with invalid initial config', () => {
      // Write invalid config - row without id field
      fs.writeFileSync(TEST_CONFIG_FILE, 'id,limit,window\n,100,60\n', 'utf-8');
      
      expect(() => {
        configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator);
      }).toThrow();
    });
  });
  
  describe('Configuration Validation', () => {
    beforeEach(() => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator);
    });
    
    test('should validate configuration correctly', () => {
      const validConfig = [
        { id: '1', limit: '100', window: '60' },
        { id: '2', limit: '200', window: '120' }
      ];
      
      const result = configManager.validateConfig(validConfig);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    test('should detect validation errors', () => {
      const invalidConfig = [
        { limit: '100', window: '60' }, // Missing id
        { id: '2', limit: '200', window: '120' }
      ];
      
      const result = configManager.validateConfig(invalidConfig);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
    
    test('should detect validation warnings', () => {
      const configWithWarnings = [
        { id: '1', window: '60' }, // Missing limit (warning)
        { id: '2', limit: '200', window: '120' }
      ];
      
      const result = configManager.validateConfig(configWithWarnings);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
  
  describe('Manual Reload', () => {
    beforeEach(() => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator);
    });
    
    test('should reload configuration successfully', async () => {
      // Update config file
      const newConfig = 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n';
      fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
      
      const result = await configManager.triggerReload();
      
      expect(result.success).toBe(true);
      expect(result.entriesCount).toBe(3);
      
      const config = configManager.getCurrentConfig();
      expect(config).toHaveLength(3);
    });
    
    test('should reject invalid configuration on reload', async () => {
      // Write invalid config
      const invalidConfig = 'id,limit,window\n,100,60\n'; // Missing id
      fs.writeFileSync(TEST_CONFIG_FILE, invalidConfig, 'utf-8');
      
      const result = await configManager.triggerReload();
      
      expect(result.success).toBe(false);
      expect(result.errors).toBeTruthy();
      
      // Old config should still be in place
      const config = configManager.getCurrentConfig();
      expect(config).toHaveLength(2);
    });
    
    test('should emit configChanged event on successful reload', async () => {
      const eventPromise = new Promise((resolve) => {
        configManager.once('configChanged', (event) => {
          resolve(event);
        });
      });
      
      // Update config file
      const newConfig = 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n';
      fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
      
      await configManager.triggerReload();
      
      const event = await eventPromise;
      expect(event.newConfig).toHaveLength(3);
      expect(event.oldConfig).toHaveLength(2);
    });
    
    test('should emit configValidationFailed on invalid config', async () => {
      const eventPromise = new Promise((resolve) => {
        configManager.once('configValidationFailed', (event) => {
          resolve(event);
        });
      });
      
      // Write invalid config
      const invalidConfig = 'id,limit,window\n,100,60\n';
      fs.writeFileSync(TEST_CONFIG_FILE, invalidConfig, 'utf-8');
      
      await configManager.triggerReload();
      
      const event = await eventPromise;
      expect(event.errors).toBeTruthy();
      expect(event.errors.length).toBeGreaterThan(0);
    });
  });
  
  describe('File Watching', () => {
    beforeEach(() => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator, {
        debounceMs: 500,
        watchInterval: 500
      });
    });
    
    test('should detect file changes automatically', async () => {
      const eventPromise = new Promise((resolve) => {
        configManager.once('configChanged', (event) => {
          resolve(event);
        });
      });
      
      configManager.startWatching();
      
      // Wait a bit for watcher to start
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Update config file
      const newConfig = 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n';
      fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
      
      // Wait for event (with timeout)
      const event = await Promise.race([
        eventPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000)
        )
      ]);
      
      expect(event.newConfig).toHaveLength(3);
    }, 10000);
    
    test('should stop watching when requested', () => {
      configManager.startWatching();
      expect(configManager.watcher).toBeTruthy();
      
      configManager.stopWatching();
      expect(configManager.watcher).toBeFalsy();
    });
  });
  
  describe('Version History', () => {
    beforeEach(() => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator);
    });
    
    test('should track version history', async () => {
      // Make multiple changes
      for (let i = 3; i <= 5; i++) {
        const newConfig = `id,limit,window\n${Array.from({length: i}, (_, idx) => `${idx+1},${(idx+1)*100},${(idx+1)*60}`).join('\n')}\n`;
        fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
        await configManager.triggerReload();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const history = configManager.getVersionHistory();
      expect(history.length).toBeGreaterThan(1);
    });
    
    test('should limit version history to maxVersions', async () => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator, {
        maxVersions: 3
      });
      
      // Make more than maxVersions changes
      for (let i = 3; i <= 6; i++) {
        const newConfig = `id,limit,window\n${Array.from({length: i}, (_, idx) => `${idx+1},${(idx+1)*100},${(idx+1)*60}`).join('\n')}\n`;
        fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
        await configManager.triggerReload();
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      const history = configManager.getVersionHistory(10);
      expect(history.length).toBeLessThanOrEqual(3);
    });
  });
  
  describe('Rollback', () => {
    beforeEach(() => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator);
    });
    
    test('should rollback to previous version', async () => {
      // Save initial config
      const initialConfig = configManager.getCurrentConfig();
      expect(initialConfig).toHaveLength(2);
      
      // Update config
      const newConfig = 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n';
      fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
      await configManager.triggerReload();
      
      expect(configManager.getCurrentConfig()).toHaveLength(3);
      
      // Rollback (applies immediately, no need to wait for file watcher)
      const result = await configManager.rollback();
      expect(result.success).toBe(true);
      
      // Config should be back to initial immediately
      const currentConfig = configManager.getCurrentConfig();
      expect(currentConfig).toHaveLength(2);
    }, 10000);
    
    test('should rollback to specific version', async () => {
      const version1 = configManager.getCurrentVersion();
      
      // Make first update
      let newConfig = 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n';
      fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
      await configManager.triggerReload();
      
      // Make second update
      newConfig = 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n4,400,240\n';
      fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
      await configManager.triggerReload();
      
      expect(configManager.getCurrentConfig()).toHaveLength(4);
      
      // Rollback to version1 (applies immediately)
      const result = await configManager.rollback(version1.version);
      expect(result.success).toBe(true);
      
      // Config should be rolled back immediately
      const currentConfig = configManager.getCurrentConfig();
      expect(currentConfig).toHaveLength(2);
    }, 10000);
    
    test('should fail rollback with no previous version', async () => {
      // Only one version exists (initial)
      configManager.configVersions = [configManager.configVersions[0]];
      
      const result = await configManager.rollback();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No previous version');
    });
    
    test('should fail rollback to non-existent version', async () => {
      const result = await configManager.rollback(999999);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
  
  describe('Statistics', () => {
    beforeEach(() => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator);
    });
    
    test('should track reload statistics', async () => {
      // Successful reload
      const newConfig = 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n';
      fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
      await configManager.triggerReload();
      
      // Failed reload
      const invalidConfig = 'id,limit,window\n,100,60\n';
      fs.writeFileSync(TEST_CONFIG_FILE, invalidConfig, 'utf-8');
      await configManager.triggerReload();
      
      const stats = configManager.getStatistics();
      expect(stats.totalReloads).toBeGreaterThanOrEqual(2);
      expect(stats.successfulReloads).toBeGreaterThanOrEqual(1);
      expect(stats.failedReloads).toBeGreaterThanOrEqual(1);
    });
    
    test('should track rollback statistics', async () => {
      // Make a change
      const newConfig = 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n';
      fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
      await configManager.triggerReload();
      
      // Rollback
      await configManager.rollback();
      
      const stats = configManager.getStatistics();
      expect(stats.totalRollbacks).toBeGreaterThanOrEqual(1);
    });
  });
  
  describe('Concurrent Updates', () => {
    beforeEach(() => {
      configManager = new ConfigManager(TEST_CONFIG_FILE, sampleValidator);
    });
    
    test('should handle concurrent reload requests safely', async () => {
      const newConfig = 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n';
      fs.writeFileSync(TEST_CONFIG_FILE, newConfig, 'utf-8');
      
      // Small delay to ensure file is written
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Trigger multiple reloads concurrently
      const results = await Promise.all([
        configManager.triggerReload(),
        configManager.triggerReload(),
        configManager.triggerReload()
      ]);
      
      // At least one should succeed
      const successful = results.filter(r => r.success);
      expect(successful.length).toBeGreaterThan(0);
      
      // Config should be consistent
      const config = configManager.getCurrentConfig();
      expect(config).toHaveLength(3);
    }, 10000);
  });
});
