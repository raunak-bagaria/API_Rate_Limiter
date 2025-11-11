/* eslint-env jest, node */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ConfigManager from '../../src/configManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TEST_CONFIG_FILE = path.join(FIXTURES_DIR, 'test_config_extended.csv');

const validator = (config) => {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(config)) {
    return { valid: false, errors: ['Config must be an array'], warnings: [] };
  }
  for (const item of config) {
    if (!item.id) errors.push('Missing id');
    if (!item.limit) warnings.push('Missing limit');
  }
  return { valid: errors.length === 0, errors, warnings };
};

describe('ConfigManager (extended)', () => {
  let mgr;

  beforeEach(() => {
    if (!fs.existsSync(FIXTURES_DIR)) fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    // initial config
    fs.writeFileSync(TEST_CONFIG_FILE, 'id,limit,window\n1,100,60\n2,200,120\n', 'utf-8');
    mgr = new ConfigManager(TEST_CONFIG_FILE, validator, { watchEnabled: false });
  });

  afterEach(() => {
    if (mgr) mgr.destroy();
    if (fs.existsSync(TEST_CONFIG_FILE)) fs.unlinkSync(TEST_CONFIG_FILE);
  });

  test('should provide statistics and version history', () => {
    const stats = mgr.getStatistics();
    expect(stats.totalVersions).toBe(1);
    expect(stats.isWatching).toBe(false);
    const history = mgr.getVersionHistory();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
  });

  test('triggerReload returns unchanged when file not modified', async () => {
    const result = await mgr.triggerReload();
    expect(result.success).toBe(true);
    expect(result.unchanged || result.skipped).toBeTruthy();
  });

  test('triggerReload applies new configuration when file changed', async () => {
    // modify file with a third entry
    fs.writeFileSync(TEST_CONFIG_FILE, 'id,limit,window\n1,100,60\n2,200,120\n3,300,180\n', 'utf-8');
    const result = await mgr.triggerReload();
    expect(result.success).toBe(true);
    // Either success with version or unchanged depending on mtime; ensure entries reflect change
    const cfg = mgr.getCurrentConfig();
    expect(cfg.length).toBe(3);
  });

  test('rollback reports error when no previous version', async () => {
    const rb = await mgr.rollback();
    expect(rb.success).toBe(false);
    expect(rb.error).toMatch(/No previous version/);
  });

  test('rollback to previous version after a change', async () => {
    // change config (to create new version)
    fs.writeFileSync(TEST_CONFIG_FILE, 'id,limit,window\n1,100,60\n', 'utf-8');
    const reload = await mgr.triggerReload();
    expect(reload.success).toBe(true);
    expect(mgr.getCurrentConfig().length).toBe(1);

    const rb = await mgr.rollback();
    expect(rb.success).toBe(true);
    expect(mgr.getCurrentConfig().length).toBe(2);
  });

  test('rollback to specific non-existent version returns error', async () => {
    const res = await mgr.rollback(123456789); // Arbitrary non-existent version
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  test('rollback target invalid when validator rejects it', async () => {
    // Create a new version first
    fs.writeFileSync(TEST_CONFIG_FILE, 'id,limit,window\n1,100,60\n', 'utf-8');
    const reload = await mgr.triggerReload();
    expect(reload.success).toBe(true);

    // Capture the earlier version to roll back to (the initial file with 2 entries)
    const history = mgr.getVersionHistory();
    const older = history[0];
    expect(older.version).toBeDefined();

    // Make validator stricter so the older version becomes invalid
    mgr.validator = (config) => {
      const errors = [];
      // Reject if there are 2 entries (our older config)
      if (Array.isArray(config) && config.length === 2) {
        errors.push('Too many entries');
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    };

    const rb = await mgr.rollback(older.version);
    expect(rb.success).toBe(false);
    expect(rb.error).toMatch(/invalid/);
  });
  test('validateConfig returns errors for invalid input', () => {
    const result = mgr.validateConfig({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
