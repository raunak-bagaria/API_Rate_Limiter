/* eslint-env jest,node */
import { describe, test, expect, beforeEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import AdminBlockManager from '../src/adminBlockManager.js';

const fixturesDir = path.join(process.cwd(), 'src', 'test_fixtures');
const blocksFile = path.join(fixturesDir, 'admin_blocks_test.csv');
const auditFile = path.join(fixturesDir, 'admin_block_audit_test.csv');

describe('AdminBlockManager', () => {
  beforeEach(() => {
    if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });
    if (fs.existsSync(blocksFile)) fs.unlinkSync(blocksFile);
    if (fs.existsSync(auditFile)) fs.unlinkSync(auditFile);
  });

  test('blocks and unblocks an IP permanently', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    expect(mgr.block('1.2.3.4', 'ip', 'alice', 'manual block')).toBe(true);
    expect(mgr.isBlocked('1.2.3.4')).toBe(true);

    const auditRaw = fs.readFileSync(auditFile, 'utf8');
    expect(auditRaw).toMatch(/block/);

    expect(mgr.unblock('1.2.3.4', 'alice', 'resolved')).toBe(true);
    expect(mgr.isBlocked('1.2.3.4')).toBe(false);
  });

  test('blocks an API key and respects expiry', async () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    expect(mgr.block('APIKEY-123', 'apiKey', 'bob', 'suspicious', 100)).toBe(true);
    expect(mgr.isBlocked('APIKEY-123')).toBe(true);

    await delay(150);
    expect(mgr.isBlocked('APIKEY-123')).toBe(false);
  });

  test('blocks CIDR ranges and matches IPs inside them', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    expect(mgr.block('10.0.0.0/24', 'cidr', 'carol', 'range block')).toBe(true);
    expect(mgr.isBlocked('10.0.0.5')).toBe(true);
    expect(mgr.isBlocked('10.0.1.5')).toBe(false);
  });
});
