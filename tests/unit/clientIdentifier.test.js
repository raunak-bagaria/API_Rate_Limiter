import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import ClientIdentifier, { ClientIdentity, ClientTier } from '../../src/clientIdentifier.js';
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
});

describe('ClientIdentifier', () => {
  let clientIdentifier;
  const testClientsFile = './src/test_clients_identifier.csv';
  const testCidrFile = './src/test_cidr_identifier.csv';
  const testLearnedIpsFile = './src/test_learned_ips_identifier.csv';
  const testAllowlistFile = './src/test_allowlist_identifier.csv';
  const testBlocklistFile = './src/test_blocklist_identifier.csv';

  beforeEach(() => {
    fs.writeFileSync(
      testClientsFile,
      'api_key,client_name,classification\n' +
      'key123,client1,premium\n'
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
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
  });

  test('should identify client with valid API key', () => {
    const mockReq = { headers: { 'x-api-key': 'key123' }, ip: '192.168.1.1' };
    const identity = clientIdentifier.identifyClient(mockReq);
    expect(identity.valid).toBe(true);
    expect(identity.clientName).toBe('client1');
  });
});
