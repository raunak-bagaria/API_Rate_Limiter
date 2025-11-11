/* eslint-env jest,node */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import AdminBlockManager from '../../src/adminBlockManager.js';

const fixturesDir = path.join(process.cwd(), 'src', 'test_fixtures');
const blocksFile = path.join(fixturesDir, 'admin_blocks_test.csv');
const auditFile = path.join(fixturesDir, 'admin_block_audit_test.csv');

describe('AdminBlockManager', () => {
  beforeEach(() => {
    if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });
    if (fs.existsSync(blocksFile)) fs.unlinkSync(blocksFile);
    if (fs.existsSync(auditFile)) fs.unlinkSync(auditFile);
  });

  afterEach(() => {
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

  test('should not block IP when no reason given', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    expect(mgr.block('1.2.3.4', 'ip', 'alice')).toBe(true);
    expect(mgr.isBlocked('1.2.3.4')).toBe(true);
  });

  test('should return false when blocking empty source', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    expect(mgr.block('', 'ip', 'alice', 'test')).toBe(false);
    expect(mgr.block(null, 'ip', 'alice', 'test')).toBe(false);
  });

  test('should return false when unblocking non-existent source', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    expect(mgr.unblock('99.99.99.99', 'alice', 'cleanup')).toBe(false);
  });

  test('should handle multiple blocks', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    expect(mgr.block('1.1.1.1', 'ip', 'alice', 'block1')).toBe(true);
    expect(mgr.block('2.2.2.2', 'ip', 'bob', 'block2')).toBe(true);
    expect(mgr.block('3.3.3.3', 'ip', 'carol', 'block3')).toBe(true);

    expect(mgr.isBlocked('1.1.1.1')).toBe(true);
    expect(mgr.isBlocked('2.2.2.2')).toBe(true);
    expect(mgr.isBlocked('3.3.3.3')).toBe(true);
    expect(mgr.isBlocked('4.4.4.4')).toBe(false);
  });

  test('should list blocks', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    mgr.block('1.1.1.1', 'ip', 'alice');
    mgr.block('2.2.2.2', 'ip', 'bob');
    mgr.block('3.3.3.3', 'ip', 'carol');

    const blocks = mgr.listBlocks();
    expect(blocks.length).toBe(3);
    expect(blocks.some(b => b.source === '1.1.1.1')).toBe(true);
    expect(blocks.some(b => b.source === '2.2.2.2')).toBe(true);
    expect(blocks.some(b => b.source === '3.3.3.3')).toBe(true);
  });

  test('should handle persistence - reload from file', () => {
    const mgr1 = new AdminBlockManager(blocksFile, auditFile);
    mgr1.block('1.2.3.4', 'ip', 'alice', 'test');

    // Create new manager instance that reads from same file
    const mgr2 = new AdminBlockManager(blocksFile, auditFile);
    expect(mgr2.isBlocked('1.2.3.4')).toBe(true);
  });

  test('should handle IPv6 addresses', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    const ipv6 = '2001:db8::1';
    mgr.block(ipv6, 'ip', 'alice', 'ipv6 block');

    expect(mgr.isBlocked(ipv6)).toBe(true);
  });

  test('should handle IPv6 CIDR ranges', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    mgr.block('2001:db8::/32', 'cidr', 'alice', 'ipv6 cidr');

    expect(mgr.isBlocked('2001:db8::5')).toBe(true);
  });

  test('should track block types in listBlocks', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    mgr.block('1.2.3.4', 'ip', 'alice', 'ip block');
    mgr.block('TEST-KEY', 'apiKey', 'bob', 'api block');
    mgr.block('10.0.0.0/24', 'cidr', 'carol', 'cidr block');

    const blocks = mgr.listBlocks();
    expect(blocks.find(b => b.source === '1.2.3.4').type).toBe('ip');
    expect(blocks.find(b => b.source === 'TEST-KEY').type).toBe('apiKey');
    expect(blocks.find(b => b.source === '10.0.0.0/24').type).toBe('cidr');
  });

  test('should list blocks with all sources', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    mgr.block('1.1.1.1', 'ip', 'alice');
    mgr.block('2.2.2.2', 'ip', 'bob');
    mgr.block('3.3.3.3', 'ip', 'carol');

    const blocks = mgr.listBlocks();
    expect(blocks.length).toBe(3);
    expect(blocks.map(b => b.source)).toContain('1.1.1.1');
    expect(blocks.map(b => b.source)).toContain('2.2.2.2');
    expect(blocks.map(b => b.source)).toContain('3.3.3.3');
  });

  test('should handle persistence - reload from file', () => {
    const mgr1 = new AdminBlockManager(blocksFile, auditFile);
    mgr1.block('1.2.3.4', 'ip', 'alice', 'test');

    // Create new manager instance that reads from same file
    const mgr2 = new AdminBlockManager(blocksFile, auditFile);
    expect(mgr2.isBlocked('1.2.3.4')).toBe(true);
  });

  test('should track block types correctly', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    mgr.block('1.2.3.4', 'ip', 'alice', 'ip block');
    mgr.block('TEST-KEY', 'apiKey', 'bob', 'api block');
    mgr.block('10.0.0.0/24', 'cidr', 'carol', 'cidr block');

    const blocks = mgr.listBlocks();
    expect(blocks.find(b => b.source === '1.2.3.4').type).toBe('ip');
    expect(blocks.find(b => b.source === 'TEST-KEY').type).toBe('apiKey');
    expect(blocks.find(b => b.source === '10.0.0.0/24').type).toBe('cidr');
  });

  test('should export audit trail', () => {
    const mgr = new AdminBlockManager(blocksFile, auditFile);
    mgr.block('1.2.3.4', 'ip', 'alice', 'block');
    mgr.unblock('1.2.3.4', 'bob', 'unblock');

    const auditRaw = fs.readFileSync(auditFile, 'utf8');
    expect(auditRaw).toContain('block');
    expect(auditRaw).toContain('unblock');
  });
});
