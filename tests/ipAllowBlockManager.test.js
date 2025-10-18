/**
 * Unit tests for IPAllowBlockManager
 * 
 * Tests cover:
 * - Allowlist functionality with individual IPs and CIDR ranges
 * - Blocklist functionality with individual IPs and CIDR ranges
 * - Priority handling (blocklist takes precedence over allowlist)
 * - IPv4 and IPv6 support
 * - File operations (load/save)
 * - Statistics generation
 * - Add/remove operations
 * - Request count tracking
 */

import IPAllowBlockManager, { IPListAction } from '../src/ipAllowBlockManager.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('IPAllowBlockManager', () => {
  let ipAllowBlockManager;
  const fixturesDir = path.join(__dirname, '..', 'src', 'test_fixtures');
  const testAllowlistFile = path.join(fixturesDir, 'test_allowlist.csv');
  const testBlocklistFile = path.join(fixturesDir, 'test_blocklist.csv');

  beforeAll(() => {
    // Create test fixtures directory in src (where IPAllowBlockManager expects files)
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Create test allowlist CSV
    const allowlistData = `ip_or_cidr,description,added_date,request_count
192.168.1.0/24,Trusted internal network,2025-10-18T10:00:00Z,10
172.16.0.50,Admin workstation,2025-10-18T10:00:00Z,5
203.0.113.10,Partner API server,2025-10-18T10:00:00Z,15
2001:db8::/64,IPv6 trusted network,2025-10-18T10:00:00Z,3`;

    fs.writeFileSync(testAllowlistFile, allowlistData, 'utf-8');

    // Create test blocklist CSV
    const blocklistData = `ip_or_cidr,description,added_date,request_count
192.168.1.100,Compromised host,2025-10-18T10:00:00Z,20
10.0.0.0/8,Blocked network range,2025-10-18T10:00:00Z,50
185.220.101.0/24,Known malicious IP range,2025-10-18T10:00:00Z,100
198.51.100.42,Suspicious activity,2025-10-18T10:00:00Z,25
2001:db8:bad::/48,Malicious IPv6 range,2025-10-18T10:00:00Z,8`;

    fs.writeFileSync(testBlocklistFile, blocklistData, 'utf-8');

    // Use relative paths from src directory
    ipAllowBlockManager = new IPAllowBlockManager('test_fixtures/test_allowlist.csv', 'test_fixtures/test_blocklist.csv');
  });

  afterEach(() => {
    // Cleanup test files
    if (fs.existsSync(testAllowlistFile)) {
      fs.unlinkSync(testAllowlistFile);
    }
    if (fs.existsSync(testBlocklistFile)) {
      fs.unlinkSync(testBlocklistFile);
    }
  });

  afterAll(() => {
    if (fs.existsSync(fixturesDir)) {
      fs.rmdirSync(fixturesDir, { recursive: true });
    }
  });

  describe('Constructor and Initialization', () => {
    test('should load allowlist from CSV', () => {
      const stats = ipAllowBlockManager.getStatistics();
      expect(stats.allowlist.totalEntries).toBe(4);
      expect(stats.allowlist.totalRequests).toBe(33); // 10 + 5 + 15 + 3
    });

    test('should load blocklist from CSV', () => {
      const stats = ipAllowBlockManager.getStatistics();
      expect(stats.blocklist.totalEntries).toBe(5);
      expect(stats.blocklist.totalRequests).toBe(203); // 20 + 50 + 100 + 25 + 8
    });

    test('should create allowlist file if missing', () => {
      const newAllowlistFile = path.join(fixturesDir, 'new_allowlist.csv');
      const manager = new IPAllowBlockManager('test_fixtures/new_allowlist.csv', 'test_fixtures/test_blocklist.csv');
      
      expect(fs.existsSync(newAllowlistFile)).toBe(true);
      
      if (fs.existsSync(newAllowlistFile)) {
        fs.unlinkSync(newAllowlistFile);
      }
    });

    test('should create blocklist file if missing', () => {
      const newBlocklistFile = path.join(fixturesDir, 'new_blocklist.csv');
      const manager = new IPAllowBlockManager('test_fixtures/test_allowlist.csv', 'test_fixtures/new_blocklist.csv');
      
      expect(fs.existsSync(newBlocklistFile)).toBe(true);
      
      if (fs.existsSync(newBlocklistFile)) {
        fs.unlinkSync(newBlocklistFile);
      }
    });

    test('should correctly categorize IP and CIDR entries', () => {
      const stats = ipAllowBlockManager.getStatistics();
      
      // Allowlist: 2 CIDR ranges, 2 individual IPs
      expect(stats.allowlist.cidrEntries).toBe(2);
      expect(stats.allowlist.ipEntries).toBe(2);
      
      // Blocklist: 3 CIDR ranges, 2 individual IPs
      expect(stats.blocklist.cidrEntries).toBe(3);
      expect(stats.blocklist.ipEntries).toBe(2);
    });
  });

  describe('isAllowlisted() - Individual IPs', () => {
    test('should detect allowlisted individual IP', () => {
      const result = ipAllowBlockManager.isAllowlisted('172.16.0.50');
      expect(result).toBe(true);
    });

    test('should not detect non-allowlisted IP', () => {
      const result = ipAllowBlockManager.isAllowlisted('1.2.3.4');
      expect(result).toBe(false);
    });

    test('should increment request count for allowlisted IP', () => {
      const statsBefore = ipAllowBlockManager.getStatistics();
      
      ipAllowBlockManager.isAllowlisted('172.16.0.50');
      
      const statsAfter = ipAllowBlockManager.getStatistics();
      expect(statsAfter.allowlist.totalRequests).toBeGreaterThan(statsBefore.allowlist.totalRequests);
    });

    test('should handle null IP address', () => {
      const result = ipAllowBlockManager.isAllowlisted(null);
      expect(result).toBe(false);
    });

    test('should handle empty IP address', () => {
      const result = ipAllowBlockManager.isAllowlisted('');
      expect(result).toBe(false);
    });
  });

  describe('isAllowlisted() - CIDR Ranges', () => {
    test('should detect IP in allowlisted CIDR range', () => {
      const result = ipAllowBlockManager.isAllowlisted('192.168.1.50');
      expect(result).toBe(true);
    });

    test('should detect IP at start of allowlisted CIDR range', () => {
      const result = ipAllowBlockManager.isAllowlisted('192.168.1.0');
      expect(result).toBe(true);
    });

    test('should detect IP at end of allowlisted CIDR range', () => {
      const result = ipAllowBlockManager.isAllowlisted('192.168.1.255');
      expect(result).toBe(true);
    });

    test('should not detect IP outside allowlisted CIDR range', () => {
      const result = ipAllowBlockManager.isAllowlisted('192.168.2.50');
      expect(result).toBe(false);
    });

    test('should handle IPv6 CIDR ranges', () => {
      const result = ipAllowBlockManager.isAllowlisted('2001:db8::1234');
      expect(result).toBe(true);
    });

    test('should not detect IPv6 outside allowlisted range', () => {
      const result = ipAllowBlockManager.isAllowlisted('2001:db9::1234');
      expect(result).toBe(false);
    });
  });

  describe('isBlocklisted() - Individual IPs', () => {
    test('should detect blocklisted individual IP', () => {
      const result = ipAllowBlockManager.isBlocklisted('192.168.1.100');
      expect(result).toBe(true);
    });

    test('should not detect non-blocklisted IP', () => {
      const result = ipAllowBlockManager.isBlocklisted('1.2.3.4');
      expect(result).toBe(false);
    });

    test('should increment request count for blocklisted IP', () => {
      const statsBefore = ipAllowBlockManager.getStatistics();
      
      ipAllowBlockManager.isBlocklisted('192.168.1.100');
      
      const statsAfter = ipAllowBlockManager.getStatistics();
      expect(statsAfter.blocklist.totalRequests).toBeGreaterThan(statsBefore.blocklist.totalRequests);
    });

    test('should handle null IP address', () => {
      const result = ipAllowBlockManager.isBlocklisted(null);
      expect(result).toBe(false);
    });

    test('should handle empty IP address', () => {
      const result = ipAllowBlockManager.isBlocklisted('');
      expect(result).toBe(false);
    });
  });

  describe('isBlocklisted() - CIDR Ranges', () => {
    test('should detect IP in blocklisted CIDR range', () => {
      const result = ipAllowBlockManager.isBlocklisted('10.0.5.100');
      expect(result).toBe(true);
    });

    test('should detect IP at start of blocklisted CIDR range', () => {
      const result = ipAllowBlockManager.isBlocklisted('185.220.101.0');
      expect(result).toBe(true);
    });

    test('should detect IP at end of blocklisted CIDR range', () => {
      const result = ipAllowBlockManager.isBlocklisted('185.220.101.255');
      expect(result).toBe(true);
    });

    test('should not detect IP outside blocklisted CIDR range', () => {
      const result = ipAllowBlockManager.isBlocklisted('185.220.102.50');
      expect(result).toBe(false);
    });

    test('should handle IPv6 CIDR ranges', () => {
      const result = ipAllowBlockManager.isBlocklisted('2001:db8:bad::1234');
      expect(result).toBe(true);
    });

    test('should not detect IPv6 outside blocklisted range', () => {
      const result = ipAllowBlockManager.isBlocklisted('2001:db8:good::1234');
      expect(result).toBe(false);
    });
  });

  describe('checkIP() - Combined Logic', () => {
    test('should return BLOCK for blocklisted IP', () => {
      const result = ipAllowBlockManager.checkIP('192.168.1.100');
      expect(result.action).toBe(IPListAction.BLOCK);
      expect(result.reason).toBe('IP address is blocklisted');
      expect(result.ipAddress).toBe('192.168.1.100');
    });

    test('should return ALLOW for allowlisted IP', () => {
      const result = ipAllowBlockManager.checkIP('172.16.0.50');
      expect(result.action).toBe(IPListAction.ALLOW);
      expect(result.reason).toBe('IP address is allowlisted');
      expect(result.ipAddress).toBe('172.16.0.50');
    });

    test('should return NONE for IP not in any list', () => {
      const result = ipAllowBlockManager.checkIP('1.2.3.4');
      expect(result.action).toBe(IPListAction.NONE);
      expect(result.reason).toBe('IP address not in any list - process according to normal rules');
      expect(result.ipAddress).toBe('1.2.3.4');
    });

    test('should prioritize blocklist over allowlist', () => {
      // Add an IP to both lists
      ipAllowBlockManager.addToAllowlist('192.168.1.100', 'Test overlap');
      
      // Should still be blocked since blocklist takes priority
      const result = ipAllowBlockManager.checkIP('192.168.1.100');
      expect(result.action).toBe(IPListAction.BLOCK);
    });

    test('should handle null IP address', () => {
      const result = ipAllowBlockManager.checkIP(null);
      expect(result.action).toBe(IPListAction.NONE);
      expect(result.reason).toBe('No IP address provided');
      expect(result.ipAddress).toBe(null);
    });

    test('should handle empty IP address', () => {
      const result = ipAllowBlockManager.checkIP('');
      expect(result.action).toBe(IPListAction.NONE);
      expect(result.reason).toBe('No IP address provided');
      expect(result.ipAddress).toBe(null);
    });
  });

  describe('addToAllowlist()', () => {
    test('should add individual IP to allowlist', () => {
      const success = ipAllowBlockManager.addToAllowlist('1.2.3.4', 'Test IP');
      expect(success).toBe(true);
      
      const result = ipAllowBlockManager.isAllowlisted('1.2.3.4');
      expect(result).toBe(true);
    });

    test('should add CIDR range to allowlist', () => {
      const success = ipAllowBlockManager.addToAllowlist('172.16.0.0/16', 'Test CIDR');
      expect(success).toBe(true);
      
      const result = ipAllowBlockManager.isAllowlisted('172.16.50.100');
      expect(result).toBe(true);
    });

    test('should persist allowlist additions to file', () => {
      ipAllowBlockManager.addToAllowlist('5.6.7.8', 'Test IP');
      
      const content = fs.readFileSync(testAllowlistFile, 'utf-8');
      expect(content).toContain('5.6.7.8');
      expect(content).toContain('Test IP');
    });

    test('should handle null IP', () => {
      const success = ipAllowBlockManager.addToAllowlist(null, 'Test');
      expect(success).toBe(false);
    });

    test('should handle empty IP', () => {
      const success = ipAllowBlockManager.addToAllowlist('', 'Test');
      expect(success).toBe(false);
    });
  });

  describe('addToBlocklist()', () => {
    test('should add individual IP to blocklist', () => {
      const success = ipAllowBlockManager.addToBlocklist('9.8.7.6', 'Test malicious IP');
      expect(success).toBe(true);
      
      const result = ipAllowBlockManager.isBlocklisted('9.8.7.6');
      expect(result).toBe(true);
    });

    test('should add CIDR range to blocklist', () => {
      const success = ipAllowBlockManager.addToBlocklist('172.20.0.0/16', 'Test malicious CIDR');
      expect(success).toBe(true);
      
      const result = ipAllowBlockManager.isBlocklisted('172.20.50.100');
      expect(result).toBe(true);
    });

    test('should persist blocklist additions to file', () => {
      ipAllowBlockManager.addToBlocklist('11.12.13.14', 'Test malicious IP');
      
      const content = fs.readFileSync(testBlocklistFile, 'utf-8');
      expect(content).toContain('11.12.13.14');
      expect(content).toContain('Test malicious IP');
    });

    test('should handle null IP', () => {
      const success = ipAllowBlockManager.addToBlocklist(null, 'Test');
      expect(success).toBe(false);
    });

    test('should handle empty IP', () => {
      const success = ipAllowBlockManager.addToBlocklist('', 'Test');
      expect(success).toBe(false);
    });
  });

  describe('removeFromAllowlist()', () => {
    test('should remove existing IP from allowlist', () => {
      const success = ipAllowBlockManager.removeFromAllowlist('172.16.0.50');
      expect(success).toBe(true);
      
      const result = ipAllowBlockManager.isAllowlisted('172.16.0.50');
      expect(result).toBe(false);
    });

    test('should return false for non-existing IP', () => {
      const success = ipAllowBlockManager.removeFromAllowlist('99.99.99.99');
      expect(success).toBe(false);
    });

    test('should persist allowlist removals to file', () => {
      ipAllowBlockManager.removeFromAllowlist('172.16.0.50');
      
      const content = fs.readFileSync(testAllowlistFile, 'utf-8');
      expect(content).not.toContain('172.16.0.50');
    });
  });

  describe('removeFromBlocklist()', () => {
    test('should remove existing IP from blocklist', () => {
      const success = ipAllowBlockManager.removeFromBlocklist('192.168.1.100');
      expect(success).toBe(true);
      
      const result = ipAllowBlockManager.isBlocklisted('192.168.1.100');
      expect(result).toBe(false);
    });

    test('should return false for non-existing IP', () => {
      const success = ipAllowBlockManager.removeFromBlocklist('99.99.99.99');
      expect(success).toBe(false);
    });

    test('should persist blocklist removals to file', () => {
      ipAllowBlockManager.removeFromBlocklist('192.168.1.100');
      
      const content = fs.readFileSync(testBlocklistFile, 'utf-8');
      expect(content).not.toContain('192.168.1.100');
    });
  });

  describe('getStatistics()', () => {
    test('should return correct allowlist statistics', () => {
      const stats = ipAllowBlockManager.getStatistics();
      
      expect(stats.allowlist.totalEntries).toBe(4);
      expect(stats.allowlist.ipEntries).toBe(2); // Individual IPs
      expect(stats.allowlist.cidrEntries).toBe(2); // CIDR ranges
      expect(stats.allowlist.totalRequests).toBe(33); // Sum of request counts
    });

    test('should return correct blocklist statistics', () => {
      const stats = ipAllowBlockManager.getStatistics();
      
      expect(stats.blocklist.totalEntries).toBe(5);
      expect(stats.blocklist.ipEntries).toBe(2); // Individual IPs
      expect(stats.blocklist.cidrEntries).toBe(3); // CIDR ranges
      expect(stats.blocklist.totalRequests).toBe(203); // Sum of request counts
    });

    test('should update statistics after adding entries', () => {
      const statsBefore = ipAllowBlockManager.getStatistics();
      
      ipAllowBlockManager.addToAllowlist('1.1.1.1', 'Test');
      ipAllowBlockManager.addToBlocklist('2.2.2.2', 'Test');
      
      const statsAfter = ipAllowBlockManager.getStatistics();
      expect(statsAfter.allowlist.totalEntries).toBe(statsBefore.allowlist.totalEntries + 1);
      expect(statsAfter.blocklist.totalEntries).toBe(statsBefore.blocklist.totalEntries + 1);
    });

    test('should update statistics after removing entries', () => {
      const statsBefore = ipAllowBlockManager.getStatistics();
      
      ipAllowBlockManager.removeFromAllowlist('172.16.0.50');
      ipAllowBlockManager.removeFromBlocklist('192.168.1.100');
      
      const statsAfter = ipAllowBlockManager.getStatistics();
      expect(statsAfter.allowlist.totalEntries).toBe(statsBefore.allowlist.totalEntries - 1);
      expect(statsAfter.blocklist.totalEntries).toBe(statsBefore.blocklist.totalEntries - 1);
    });
  });

  describe('reloadAll()', () => {
    test('should reload allowlist from file', () => {
      // Modify the file
      const newAllowlistData = `ip_or_cidr,description,added_date,request_count
1.1.1.1,New test IP,2025-10-18T12:00:00Z,100`;
      
      fs.writeFileSync(testAllowlistFile, newAllowlistData, 'utf-8');
      
      // Reload
      ipAllowBlockManager.reloadAll();
      
      const stats = ipAllowBlockManager.getStatistics();
      expect(stats.allowlist.totalEntries).toBe(1);
      expect(ipAllowBlockManager.isAllowlisted('1.1.1.1')).toBe(true);
      expect(ipAllowBlockManager.isAllowlisted('10.0.0.50')).toBe(false); // Old entry gone
    });

    test('should reload blocklist from file', () => {
      // Modify the file
      const newBlocklistData = `ip_or_cidr,description,added_date,request_count
9.9.9.9,New malicious IP,2025-10-18T12:00:00Z,200`;
      
      fs.writeFileSync(testBlocklistFile, newBlocklistData, 'utf-8');
      
      // Reload
      ipAllowBlockManager.reloadAll();
      
      const stats = ipAllowBlockManager.getStatistics();
      expect(stats.blocklist.totalEntries).toBe(1);
      expect(ipAllowBlockManager.isBlocklisted('9.9.9.9')).toBe(true);
      expect(ipAllowBlockManager.isBlocklisted('192.168.1.100')).toBe(false); // Old entry gone
    });
  });

  describe('File Persistence', () => {
    test('should save allowlist entries sorted by IP', () => {
      ipAllowBlockManager.addToAllowlist('1.1.1.1', 'Test A');
      ipAllowBlockManager.addToAllowlist('9.9.9.9', 'Test Z');
      
      const content = fs.readFileSync(testAllowlistFile, 'utf-8');
      const lines = content.split('\n');
      
      // Check that 1.1.1.1 comes before 9.9.9.9
      const ip1Index = lines.findIndex(line => line.includes('1.1.1.1'));
      const ip9Index = lines.findIndex(line => line.includes('9.9.9.9'));
      
      expect(ip1Index).toBeLessThan(ip9Index);
    });

    test('should save blocklist entries sorted by IP', () => {
      ipAllowBlockManager.addToBlocklist('1.1.1.1', 'Test A');
      ipAllowBlockManager.addToBlocklist('9.9.9.9', 'Test Z');
      
      const content = fs.readFileSync(testBlocklistFile, 'utf-8');
      const lines = content.split('\n');
      
      // Check that 1.1.1.1 comes before 9.9.9.9
      const ip1Index = lines.findIndex(line => line.includes('1.1.1.1'));
      const ip9Index = lines.findIndex(line => line.includes('9.9.9.9'));
      
      expect(ip1Index).toBeLessThan(ip9Index);
    });
  });

  describe('IPv6 Support', () => {
    test('should handle IPv6 allowlist addresses', () => {
      ipAllowBlockManager.addToAllowlist('2001:db8:1234::5678', 'IPv6 test');
      
      const result = ipAllowBlockManager.isAllowlisted('2001:db8:1234::5678');
      expect(result).toBe(true);
    });

    test('should handle IPv6 blocklist addresses', () => {
      ipAllowBlockManager.addToBlocklist('2001:db8:dead::beef', 'IPv6 malicious');
      
      const result = ipAllowBlockManager.isBlocklisted('2001:db8:dead::beef');
      expect(result).toBe(true);
    });

    test('should handle compressed IPv6 notation', () => {
      const result = ipAllowBlockManager.isAllowlisted('2001:db8::');
      expect(result).toBe(true);
    });

    test('should handle IPv6 CIDR ranges correctly', () => {
      const result1 = ipAllowBlockManager.isAllowlisted('2001:db8:0:0:0:0:0:1');
      const result2 = ipAllowBlockManager.isAllowlisted('2001:db9:0:0:0:0:0:1');
      
      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle malformed CIDR ranges gracefully', () => {
      // This should be treated as an individual IP rather than CIDR
      const success = ipAllowBlockManager.addToAllowlist('123.45.67.89/999', 'Invalid CIDR');
      expect(success).toBe(true);
      
      // Should match exactly
      expect(ipAllowBlockManager.isAllowlisted('123.45.67.89/999')).toBe(true);
      expect(ipAllowBlockManager.isAllowlisted('123.45.67.89')).toBe(false);
    });

    test('should handle very large CIDR ranges', () => {
      ipAllowBlockManager.addToAllowlist('0.0.0.0/0', 'All IPv4');
      
      // Should match any IPv4
      expect(ipAllowBlockManager.isAllowlisted('8.8.8.8')).toBe(true);
      expect(ipAllowBlockManager.isAllowlisted('1.2.3.4')).toBe(true);
    });

    test('should handle overlapping ranges correctly', () => {
      ipAllowBlockManager.addToAllowlist('192.168.0.0/16', 'Large range');
      ipAllowBlockManager.addToBlocklist('192.168.1.0/24', 'Specific blocked subnet');
      
      // Should prioritize blocklist
      expect(ipAllowBlockManager.checkIP('192.168.1.50').action).toBe(IPListAction.BLOCK);
      // Should allow other IPs in the larger range
      expect(ipAllowBlockManager.checkIP('192.168.2.50').action).toBe(IPListAction.ALLOW);
    });
  });
});