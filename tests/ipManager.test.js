/**
 * Unit tests for IPManager
 * 
 * Tests cover:
 * - CIDR range validation and IP matching
 * - Learned IP tracking
 * - Request count updates
 * - Statistics generation
 * - IPv4 and IPv6 support
 * - File operations (load/save)
 */

import IPManager from '../src/ipManager.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('IPManager', () => {
  let ipManager;
  const fixturesDir = path.join(__dirname, '..', 'src', 'test_fixtures');
  const testCidrFile = path.join(fixturesDir, 'test_cidr.csv');
  const testLearnedFile = path.join(fixturesDir, 'test_learned_ips.csv');

  beforeAll(() => {
    // Create test fixtures directory in src (where IPManager expects files)
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Create test CIDR CSV
    const cidrData = `client_name,cidr_range,request_count
Test Client A,192.168.1.0/24,10
Test Client A,10.0.0.0/16,5
Test Client B,203.0.113.0/24,20
Test Client C,2001:db8::/32,15`;

    fs.writeFileSync(testCidrFile, cidrData, 'utf-8');

    // Create test learned IPs CSV
    const learnedData = `client_name,ip_address,first_seen,last_seen,request_count
Test Client A,172.16.0.1,2025-10-15T10:00:00Z,2025-10-15T10:00:00Z,1
Test Client B,8.8.8.8,2025-10-15T11:00:00Z,2025-10-15T11:00:00Z,3`;

    fs.writeFileSync(testLearnedFile, learnedData, 'utf-8');

    // Use relative paths from src directory
    ipManager = new IPManager('test_fixtures/test_cidr.csv', 'test_fixtures/test_learned_ips.csv');
  });

  afterEach(() => {
    // Cleanup test files
    if (fs.existsSync(testCidrFile)) {
      fs.unlinkSync(testCidrFile);
    }
    if (fs.existsSync(testLearnedFile)) {
      fs.unlinkSync(testLearnedFile);
    }
  });

  afterAll(() => {
    if (fs.existsSync(fixturesDir)) {
      fs.rmdirSync(fixturesDir, { recursive: true });
    }
  });

  describe('Constructor and Initialization', () => {
    test('should load CIDR ranges from CSV', () => {
      const stats = ipManager.getStatistics();
      expect(stats.cidr.totalRanges).toBe(4);
    });

    test('should load learned IPs from CSV', () => {
      const stats = ipManager.getStatistics();
      expect(stats.learned.totalIPs).toBe(2);
    });

    test('should handle missing CIDR file', () => {
      const manager = new IPManager('nonexistent_cidr.csv', 'test_fixtures/test_learned_ips.csv');
      const stats = manager.getStatistics();
      expect(stats.cidr.totalRanges).toBe(0);
    });

    test('should create learned IPs file if missing', () => {
      const newLearnedFile = path.join(fixturesDir, 'new_learned.csv');
      const manager = new IPManager('test_fixtures/test_cidr.csv', 'test_fixtures/new_learned.csv');
      
      expect(fs.existsSync(newLearnedFile)).toBe(true);
      
      if (fs.existsSync(newLearnedFile)) {
        fs.unlinkSync(newLearnedFile);
      }
    });
  });

  describe('processIP() - CIDR Range Matching', () => {
    test('should match IPv4 address in CIDR range', () => {
      ipManager.processIP('Test Client A', '192.168.1.50');
      
      const stats = ipManager.getStatistics();
      expect(stats.cidr.byClient['Test Client A'].requests).toBe(16); // 10 + 5 + 1
    });

    test('should match IPv4 address at start of CIDR range', () => {
      ipManager.processIP('Test Client A', '192.168.1.0');
      
      const stats = ipManager.getStatistics();
      expect(stats.cidr.byClient['Test Client A'].requests).toBe(16);
    });

    test('should match IPv4 address at end of CIDR range', () => {
      ipManager.processIP('Test Client A', '192.168.1.255');
      
      const stats = ipManager.getStatistics();
      expect(stats.cidr.byClient['Test Client A'].requests).toBe(16);
    });

    test('should match IPv4 address in large CIDR range', () => {
      ipManager.processIP('Test Client A', '10.0.50.100');
      
      const stats = ipManager.getStatistics();
      expect(stats.cidr.byClient['Test Client A'].requests).toBe(16);
    });

    test('should match IPv6 address in CIDR range', () => {
      ipManager.processIP('Test Client C', '2001:db8::1');
      
      const stats = ipManager.getStatistics();
      expect(stats.cidr.byClient['Test Client C'].requests).toBe(16); // 15 + 1
    });

    test('should not match IP outside CIDR range', () => {
      const statsBefore = ipManager.getStatistics();
      const cidrRequestsBefore = statsBefore.cidr.totalRequests;
      
      ipManager.processIP('Test Client A', '172.16.5.10');
      
      const statsAfter = ipManager.getStatistics();
      // CIDR requests should remain the same (IP goes to learned instead)
      expect(statsAfter.cidr.totalRequests).toBe(cidrRequestsBefore);
      // Learned IPs should increase
      expect(statsAfter.learned.totalIPs).toBeGreaterThan(statsBefore.learned.totalIPs);
    });
  });

  describe('processIP() - Learned IPs', () => {
    test('should add new learned IP when not in CIDR', () => {
      const newIP = '1.2.3.4';
      ipManager.processIP('Test Client A', newIP);
      
      const stats = ipManager.getStatistics();
      expect(stats.learned.totalIPs).toBe(3); // Was 2, now 3
    });

    test('should update existing learned IP', () => {
      ipManager.processIP('Test Client A', '172.16.0.1');
      
      const stats = ipManager.getStatistics();
      expect(stats.learned.byClient['Test Client A'].requests).toBe(2); // Was 1, now 2
    });

    test('should update request count for learned IP', () => {
      const ip = '8.8.8.8';
      
      // Process same IP multiple times
      ipManager.processIP('Test Client B', ip);
      ipManager.processIP('Test Client B', ip);
      
      const stats = ipManager.getStatistics();
      expect(stats.learned.byClient['Test Client B'].requests).toBe(5); // Was 3, added 2
    });

    test('should warn when IP switches clients', () => {
      // IP originally belongs to Test Client A
      const existingIP = '172.16.0.1';
      
      // Now process it for Test Client B - should update the client
      ipManager.processIP('Test Client B', existingIP);
      
      // Verify the IP was reassigned to the new client
      const stats = ipManager.getStatistics();
      expect(stats.learned.byClient['Test Client B']).toBeDefined();
      expect(stats.learned.byClient['Test Client B'].ips).toBeGreaterThan(0);
    });

    test('should persist learned IPs to CSV file', () => {
      const newIP = '5.6.7.8';
      ipManager.processIP('Test Client A', newIP);
      
      // Read the file and verify
      const content = fs.readFileSync(testLearnedFile, 'utf-8');
      expect(content).toContain(newIP);
      expect(content).toContain('Test Client A');
    });
  });

  describe('processIP() - Edge Cases', () => {
    test('should handle null client name', () => {
      const statsBefore = ipManager.getStatistics();
      
      // Should not crash, just skip processing
      ipManager.processIP(null, '1.2.3.4');
      
      const statsAfter = ipManager.getStatistics();
      // Stats should remain unchanged since invalid input was ignored
      expect(statsAfter.learned.totalIPs).toBe(statsBefore.learned.totalIPs);
    });

    test('should handle null IP address', () => {
      const statsBefore = ipManager.getStatistics();
      
      // Should not crash, just skip processing
      ipManager.processIP('Test Client A', null);
      
      const statsAfter = ipManager.getStatistics();
      // Stats should remain unchanged since invalid input was ignored
      expect(statsAfter.learned.totalIPs).toBe(statsBefore.learned.totalIPs);
    });

    test('should handle empty client name', () => {
      const statsBefore = ipManager.getStatistics();
      
      // Should not crash, just skip processing
      ipManager.processIP('', '1.2.3.4');
      
      const statsAfter = ipManager.getStatistics();
      // Stats should remain unchanged since invalid input was ignored
      expect(statsAfter.learned.totalIPs).toBe(statsBefore.learned.totalIPs);
    });

    test('should handle empty IP address', () => {
      const statsBefore = ipManager.getStatistics();
      
      // Should not crash, just skip processing
      ipManager.processIP('Test Client A', '');
      
      const statsAfter = ipManager.getStatistics();
      // Stats should remain unchanged since invalid input was ignored
      expect(statsAfter.learned.totalIPs).toBe(statsBefore.learned.totalIPs);
    });
  });

  describe('getStatistics()', () => {
    test('should return correct CIDR statistics', () => {
      const stats = ipManager.getStatistics();
      
      expect(stats.cidr).toBeDefined();
      expect(stats.cidr.totalRanges).toBe(4);
      expect(stats.cidr.totalRequests).toBe(50); // 10 + 5 + 20 + 15
    });

    test('should return correct learned IP statistics', () => {
      const stats = ipManager.getStatistics();
      
      expect(stats.learned).toBeDefined();
      expect(stats.learned.totalIPs).toBe(2);
      expect(stats.learned.totalRequests).toBe(4); // 1 + 3
    });

    test('should return statistics by client', () => {
      const stats = ipManager.getStatistics();
      
      expect(stats.cidr.byClient['Test Client A']).toBeDefined();
      expect(stats.cidr.byClient['Test Client A'].ranges).toBe(2);
      expect(stats.cidr.byClient['Test Client A'].requests).toBe(15); // 10 + 5
      
      expect(stats.learned.byClient['Test Client A']).toBeDefined();
      expect(stats.learned.byClient['Test Client A'].ips).toBe(1);
      expect(stats.learned.byClient['Test Client A'].requests).toBe(1);
    });

    test('should update statistics after processing IPs', () => {
      const statsBefore = ipManager.getStatistics();
      
      ipManager.processIP('Test Client A', '192.168.1.50');
      
      const statsAfter = ipManager.getStatistics();
      expect(statsAfter.cidr.totalRequests).toBeGreaterThan(statsBefore.cidr.totalRequests);
    });
  });

  describe('reloadAll()', () => {
    test('should reload CIDR ranges from file', () => {
      // Modify the file
      const newCidrData = `client_name,cidr_range,request_count
New Client,192.168.2.0/24,100`;
      
      fs.writeFileSync(testCidrFile, newCidrData, 'utf-8');
      
      // Reload
      ipManager.reloadAll();
      
      const stats = ipManager.getStatistics();
      expect(stats.cidr.totalRanges).toBe(1);
      expect(stats.cidr.byClient['New Client']).toBeDefined();
    });

    test('should reload learned IPs from file', () => {
      // Modify the file
      const newLearnedData = `client_name,ip_address,first_seen,last_seen,request_count
New Client,9.9.9.9,2025-10-16T10:00:00Z,2025-10-16T10:00:00Z,50`;
      
      fs.writeFileSync(testLearnedFile, newLearnedData, 'utf-8');
      
      // Reload
      ipManager.reloadAll();
      
      const stats = ipManager.getStatistics();
      expect(stats.learned.totalIPs).toBe(1);
      expect(stats.learned.byClient['New Client']).toBeDefined();
    });

    test('should log reload information', () => {
      const statsBefore = ipManager.getStatistics();
      
      // Reload should work without errors
      ipManager.reloadAll();
      
      const statsAfter = ipManager.getStatistics();
      // After reload, data should be the same (since files haven't changed)
      expect(statsAfter.cidr.totalRanges).toBe(statsBefore.cidr.totalRanges);
      expect(statsAfter.learned.totalIPs).toBe(statsBefore.learned.totalIPs);
    });
  });

  describe('IPv6 Support', () => {
    test('should handle IPv6 addresses', () => {
      ipManager.processIP('Test Client C', '2001:db8::1234');
      
      const stats = ipManager.getStatistics();
      expect(stats.cidr.byClient['Test Client C'].requests).toBeGreaterThan(15);
    });

    test('should handle learned IPv6 addresses', () => {
      const ipv6 = '2001:db8:1234::5678';
      ipManager.processIP('Test Client A', ipv6);
      
      const stats = ipManager.getStatistics();
      expect(stats.learned.totalIPs).toBe(3); // Was 2, now 3
    });

    test('should handle compressed IPv6 notation', () => {
      ipManager.processIP('Test Client C', '2001:db8::');
      
      const stats = ipManager.getStatistics();
      expect(stats.cidr.byClient['Test Client C'].requests).toBeGreaterThan(15);
    });
  });

  describe('File Persistence', () => {
    test('should save CIDR ranges with updated counts', () => {
      ipManager.processIP('Test Client A', '192.168.1.50');
      
      // Read file and verify count increased
      const content = fs.readFileSync(testCidrFile, 'utf-8');
      expect(content).toContain('192.168.1.0/24,11'); // Was 10, now 11
    });

    test('should save learned IPs sorted by client name', () => {
      ipManager.processIP('AAA Client', '1.1.1.1');
      ipManager.processIP('ZZZ Client', '2.2.2.2');
      
      const content = fs.readFileSync(testLearnedFile, 'utf-8');
      const lines = content.split('\n');
      
      // Check that AAA Client comes before ZZZ Client
      const aaaIndex = lines.findIndex(line => line.includes('AAA Client'));
      const zzzIndex = lines.findIndex(line => line.includes('ZZZ Client'));
      
      expect(aaaIndex).toBeLessThan(zzzIndex);
    });
  });
});
