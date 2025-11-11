import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import ClientIdentifier, { ClientIdentity, ClientTier } from '../src/clientIdentifier.js';
import fs from 'fs';

describe('ClientIdentity', () => {
  test('should create valid ClientIdentity', () => {
    const identity = new ClientIdentity({
      valid: true,
      clientName: 'client1',
      classification: 'premium'
    });

    expect(identity.valid).toBe(true);
    expect(identity.clientName).toBe('client1');
    expect(identity.classification).toBe('premium');
  });

  test('should create invalid ClientIdentity with error', () => {
    const identity = new ClientIdentity({
      valid: false,
      error: { message: 'Invalid key' }
    });

    expect(identity.valid).toBe(false);
    expect(identity.error.message).toBe('Invalid key');
  });

  test('should serialize valid identity to JSON', () => {
    const identity = new ClientIdentity({
      valid: true,
      clientName: 'client1',
      classification: 'premium',
      metadata: { tier: 'premium', features: ['feature1'] }
    });

    const json = identity.toJSON();
    expect(json.valid).toBe(true);
    expect(json.clientName).toBe('client1');
    expect(json.classification).toBe('premium');
    expect(json.tier).toBe('premium');
    expect(json.features).toEqual(['feature1']);
  });

  test('should serialize invalid identity to JSON without metadata', () => {
    const identity = new ClientIdentity({
      valid: false,
      error: { message: 'Invalid key' }
    });

    const json = identity.toJSON();
    expect(json.valid).toBe(false);
    expect(json.error.message).toBe('Invalid key');
    expect(json.clientName).toBeUndefined();
  });

  test('should check tier membership correctly', () => {
    const identity = new ClientIdentity({
      valid: true,
      clientName: 'client1',
      classification: 'premium'
    });

    expect(identity.isTier('premium')).toBe(true);
    expect(identity.isTier('standard')).toBe(false);
    expect(identity.isTier('PREMIUM')).toBe(true);
  });

  test('should handle null classification in isTier', () => {
    const identity = new ClientIdentity({
      valid: true,
      clientName: 'client1',
      classification: null
    });

    expect(identity.isTier('premium')).toBe(false);
  });

  test('should handle empty metadata', () => {
    const identity = new ClientIdentity({
      valid: true,
      clientName: 'client1',
      classification: 'premium',
      metadata: {}
    });

    const json = identity.toJSON();
    expect(json.valid).toBe(true);
    expect(Object.keys(json).length).toBe(3);
  });
});

describe('ClientIdentifier', () => {
  let clientIdentifier;
  // Create absolute paths for test files in src directory since APIKeyManager joins with __dirname
  const srcDir = './src';
  const testClientsFile = './src/test_clients_identifier.csv';
  const testCidrFile = './src/test_cidr_identifier.csv';
  const testLearnedIpsFile = './src/test_learned_ips_identifier.csv';
  const testAllowlistFile = './src/test_allowlist_identifier.csv';
  const testBlocklistFile = './src/test_blocklist_identifier.csv';

  beforeEach(() => {
    // Create test CSV files in src directory with proper API key format
    // APIKeyManager expects files relative to src directory
    fs.writeFileSync(
      testClientsFile,
      'api_key,client_name,classification\n' +
      'key123,client1,premium\n' +
      'key456,client2,basic\n' +
      'key789,client3,standard\n'
    );

    fs.writeFileSync(testCidrFile, 'client_name,cidr_range\n');
    fs.writeFileSync(testLearnedIpsFile, 'client_name,ip_address,first_seen,last_seen,seen_count\n');
    fs.writeFileSync(testAllowlistFile, 'ip_address,reason\n');
    fs.writeFileSync(testBlocklistFile, 'ip_address,reason\n');

    clientIdentifier = new ClientIdentifier({
      apiKeyFile: 'test_clients_identifier.csv',
      cidrFile: 'test_cidr_identifier.csv',
      learnedIpsFile: 'test_learned_ips_identifier.csv',
      allowlistFile: 'test_allowlist_identifier.csv',
      blocklistFile: 'test_blocklist_identifier.csv'
    });
  });

  afterEach(() => {
    [testClientsFile, testCidrFile, testLearnedIpsFile, testAllowlistFile, testBlocklistFile].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  test('should identify client with valid API key', () => {
    const mockReq = {
      headers: { 'x-api-key': 'key123' },
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(true);
    expect(identity.clientName).toBe('client1');
    expect(identity.classification).toBe('premium');
  });

  test('should reject request with missing API key', () => {
    const mockReq = {
      headers: {},
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(false);
    expect(identity.error).toBeDefined();
    expect(identity.error.message).toContain('API key is required');
  });

  test('should reject request with invalid API key', () => {
    const mockReq = {
      headers: { 'x-api-key': 'invalid_key' },
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(false);
    expect(identity.error).toBeDefined();
  });

  test('should extract IP from X-Forwarded-For header', () => {
    const mockReq = {
      headers: { 
        'x-api-key': 'key123',
        'x-forwarded-for': '10.0.0.1, 192.168.1.1'
      },
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(true);
    expect(identity.metadata.clientIP).toBe('10.0.0.1');
  });

  test('should handle case-insensitive API key header', () => {
    const mockReq = {
      headers: { 'X-API-Key': 'key123' },
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(true);
    expect(identity.clientName).toBe('client1');
  });

  test('should extract IP from req.connection.remoteAddress', () => {
    const mockReq = {
      headers: { 'x-api-key': 'key123' },
      connection: { remoteAddress: '172.16.0.1' }
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(true);
    expect(identity.metadata.clientIP).toBe('172.16.0.1');
  });

  test('should handle null IP gracefully', () => {
    const mockReq = {
      headers: { 'x-api-key': 'key123' }
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(true);
  });

  test('should identify with basic tier client', () => {
    const mockReq = {
      headers: { 'x-api-key': 'key456' },
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(true);
    expect(identity.classification).toBe('basic');
  });

  test('should identify with standard tier client', () => {
    const mockReq = {
      headers: { 'x-api-key': 'key789' },
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(true);
    expect(identity.classification).toBe('standard');
  });

  test('should return all ClientTier enum values', () => {
    expect(ClientTier.FREE).toBe('free');
    expect(ClientTier.BASIC).toBe('basic');
    expect(ClientTier.STANDARD).toBe('standard');
    expect(ClientTier.PREMIUM).toBe('premium');
    expect(ClientTier.ENTERPRISE).toBe('enterprise');
  });

  test('should check tier with isTier method', () => {
    const mockReq = {
      headers: { 'x-api-key': 'key123' },
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.isTier(ClientTier.PREMIUM)).toBe(true);
    expect(identity.isTier(ClientTier.FREE)).toBe(false);
    expect(identity.isTier(ClientTier.ENTERPRISE)).toBe(false);
  });

  test('should include IP list status in metadata', () => {
    const mockReq = {
      headers: { 'x-api-key': 'key123' },
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(true);
    expect(identity.metadata).toHaveProperty('ipListStatus');
    expect(identity.metadata).toHaveProperty('ipListReason');
  });

  test('should extract socket remoteAddress if available', () => {
    const mockReq = {
      headers: { 'x-api-key': 'key123' },
      socket: { remoteAddress: '10.10.0.1' }
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(true);
    expect(identity.metadata.clientIP).toBe('10.10.0.1');
  });

  test('should handle missing headers object gracefully', () => {
    const mockReq = {
      headers: {},
      ip: '192.168.1.1'
    };

    const identity = clientIdentifier.identifyClient(mockReq);

    expect(identity.valid).toBe(false);
    expect(identity.error.message).toContain('API key is required');
  });
});
