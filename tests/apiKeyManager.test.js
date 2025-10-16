/**
 * Unit tests for APIKeyManager
 * 
 * Tests cover:
 * - API key validation (valid, invalid, malformed)
 * - Client data retrieval
 * - Error handling
 * - Edge cases (empty keys, null values, etc.)
 */

import APIKeyManager from '../src/apiKeyManager.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('APIKeyManager', () => {
  let keyManager;
  const fixturesDir = path.join(__dirname, '..', 'src', 'test_fixtures');
  const testClientsFile = path.join(fixturesDir, 'test_clients.csv');

  beforeAll(() => {
    // Create test fixtures directory in src (where APIKeyManager expects files)
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    // Create test clients CSV
    const testData = `api_key,client_name,classification
test-key-123,Test Client A,free
test-key-456,Test Client B,premium
test-key-789,Test Client C,enterprise
test-key-basic,Test Client D,basic
test-key-standard,Test Client E,standard`;

    fs.writeFileSync(testClientsFile, testData, 'utf-8');
  });

  beforeEach(() => {
    // Use relative path from src directory
    keyManager = new APIKeyManager('test_fixtures/test_clients.csv');
  });

  afterAll(() => {
    // Cleanup test files
    if (fs.existsSync(testClientsFile)) {
      fs.unlinkSync(testClientsFile);
    }
    if (fs.existsSync(fixturesDir)) {
      // Remove all files in the directory first
      const files = fs.readdirSync(fixturesDir);
      for (const file of files) {
        fs.unlinkSync(path.join(fixturesDir, file));
      }
      fs.rmdirSync(fixturesDir);
    }
  });

  describe('Constructor and Initialization', () => {
    test('should load clients from CSV file', () => {
      expect(keyManager.getClientCount()).toBe(5);
    });

    test('should handle missing CSV file gracefully', () => {
      const badManager = new APIKeyManager('nonexistent.csv');
      expect(badManager.getClientCount()).toBe(0);
    });
  });

  describe('validateKey() - Valid Keys', () => {
    test('should validate correct API key for free tier', () => {
      const result = keyManager.validateKey('test-key-123');
      expect(result.valid).toBe(true);
      expect(result.clientName).toBe('Test Client A');
      expect(result.classification).toBe('free');
      expect(result.identificationMethod).toBe('api_key');
    });

    test('should validate correct API key for premium tier', () => {
      const result = keyManager.validateKey('test-key-456');
      expect(result.valid).toBe(true);
      expect(result.clientName).toBe('Test Client B');
      expect(result.classification).toBe('premium');
    });

    test('should validate correct API key for enterprise tier', () => {
      const result = keyManager.validateKey('test-key-789');
      expect(result.valid).toBe(true);
      expect(result.clientName).toBe('Test Client C');
      expect(result.classification).toBe('enterprise');
    });

    test('should validate correct API key for basic tier', () => {
      const result = keyManager.validateKey('test-key-basic');
      expect(result.valid).toBe(true);
      expect(result.classification).toBe('basic');
    });

    test('should validate correct API key for standard tier', () => {
      const result = keyManager.validateKey('test-key-standard');
      expect(result.valid).toBe(true);
      expect(result.classification).toBe('standard');
    });

    test('should handle API keys with whitespace', () => {
      const result = keyManager.validateKey('  test-key-123  ');
      expect(result.valid).toBe(true);
      expect(result.clientName).toBe('Test Client A');
    });
  });

  describe('validateKey() - Invalid Keys', () => {
    test('should reject invalid API key', () => {
      const result = keyManager.validateKey('invalid-key-999');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.message).toBe('API key not found');
    });

    test('should reject empty API key', () => {
      const result = keyManager.validateKey('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.message).toBe('Invalid API key format');
    });

    test('should reject null API key', () => {
      const result = keyManager.validateKey(null);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.message).toBe('Invalid API key format');
    });

    test('should reject undefined API key', () => {
      const result = keyManager.validateKey(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.message).toBe('Invalid API key format');
    });

    test('should reject non-string API key', () => {
      const result = keyManager.validateKey(12345);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should reject API key that is only whitespace', () => {
      const result = keyManager.validateKey('   ');
      expect(result.valid).toBe(false);
      expect(result.error.message).toBe('API key not found');
    });
  });

  describe('reloadClients()', () => {
    test('should reload clients after file update', () => {
      // Initial count
      expect(keyManager.getClientCount()).toBe(5);

      // Update CSV file
      const newData = `api_key,client_name,classification
test-key-123,Test Client A,free
test-key-new,New Client,premium`;

      fs.writeFileSync(testClientsFile, newData, 'utf-8');

      // Reload
      keyManager.reloadClients();

      // Check new count
      expect(keyManager.getClientCount()).toBe(2);

      // Verify new key works
      const result = keyManager.validateKey('test-key-new');
      expect(result.valid).toBe(true);
      expect(result.clientName).toBe('New Client');

      // Verify old key that was removed no longer works
      const oldResult = keyManager.validateKey('test-key-456');
      expect(oldResult.valid).toBe(false);

      // Restore original data for other tests
      const originalData = `api_key,client_name,classification
test-key-123,Test Client A,free
test-key-456,Test Client B,premium
test-key-789,Test Client C,enterprise
test-key-basic,Test Client D,basic
test-key-standard,Test Client E,standard`;

      fs.writeFileSync(testClientsFile, originalData, 'utf-8');
      keyManager.reloadClients();
    });
  });

  describe('getClientCount()', () => {
    test('should return correct client count', () => {
      expect(keyManager.getClientCount()).toBe(5);
    });

    test('should return 0 for empty manager', () => {
      const emptyManager = new APIKeyManager('nonexistent.csv');
      expect(emptyManager.getClientCount()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    test('should handle CSV with missing columns', () => {
      const badCsvFile = path.join(fixturesDir, 'bad_clients.csv');
      const badData = `api_key,client_name
key1,Client1`;
      
      fs.writeFileSync(badCsvFile, badData, 'utf-8');
      const badManager = new APIKeyManager('test_fixtures/bad_clients.csv');
      
      expect(badManager.getClientCount()).toBe(0);
      
      fs.unlinkSync(badCsvFile);
    });

    test('should handle CSV with duplicate API keys', () => {
      const dupCsvFile = path.join(fixturesDir, 'dup_clients.csv');
      const dupData = `api_key,client_name,classification
dup-key,Client A,free
dup-key,Client B,premium`;
      
      fs.writeFileSync(dupCsvFile, dupData, 'utf-8');
      const dupManager = new APIKeyManager('test_fixtures/dup_clients.csv');
      
      // Should only keep first occurrence
      expect(dupManager.getClientCount()).toBe(1);
      
      const result = dupManager.validateKey('dup-key');
      expect(result.valid).toBe(true);
      expect(result.clientName).toBe('Client A'); // First occurrence
      
      fs.unlinkSync(dupCsvFile);
    });

    test('should handle CSV with empty rows', () => {
      const emptyCsvFile = path.join(fixturesDir, 'empty_rows.csv');
      const emptyData = `api_key,client_name,classification
test-key,Test Client,free

another-key,Another Client,premium`;
      
      fs.writeFileSync(emptyCsvFile, emptyData, 'utf-8');
      const emptyManager = new APIKeyManager('test_fixtures/empty_rows.csv');
      
      expect(emptyManager.getClientCount()).toBe(2);
      
      fs.unlinkSync(emptyCsvFile);
    });
  });
});
