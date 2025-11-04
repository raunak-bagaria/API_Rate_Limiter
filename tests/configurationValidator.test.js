/**
 * Comprehensive tests for ConfigurationValidator
 * 
 * Test Categories:
 * 1. Schema validation (syntax errors, missing fields, type errors)
 * 2. Semantic validation (business logic, negative limits, conflicting rules)
 * 3. Cross-validation (tier consistency, duplicate keys, IP conflicts)
 * 4. Error message quality (actionable, field references, line numbers)
 * 5. File validation and format detection
 * 6. Edge cases and performance
 */

import ConfigurationValidator from '../src/configurationValidator.js';
import fs from 'fs/promises';
import path from 'path';

describe('ConfigurationValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new ConfigurationValidator();
  });

  describe('Initialization', () => {
    test('should initialize with schemas and validation rules', () => {
      expect(validator.schemas).toBeDefined();
      expect(validator.validationRules).toBeDefined();
      expect(validator.getSupportedConfigTypes()).toContain('rateLimitConfig');
      expect(validator.getSupportedConfigTypes()).toContain('clientConfig');
      expect(validator.getSupportedConfigTypes()).toContain('ipListConfig');
    });
  });

  describe('Schema Validation - Rate Limit Config', () => {
    test('should validate correct rate limit configuration', async () => {
      const validConfig = {
        tiers: {
          free: {
            limits: {
              second: 1,
              minute: 60,
              hour: 3600,
              day: 86400
            },
            burstAllowance: 1.5,
            priority: 1
          },
          premium: {
            limits: {
              second: 10,
              minute: 600,
              hour: 36000,
              day: 864000
            },
            burstAllowance: 2.0,
            priority: 2
          }
        },
        globalDefaults: {
          windowSizeSeconds: 60,
          cleanupIntervalMs: 30000,
          accuracyMargin: 5
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', validConfig);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.configType).toBe('rateLimitConfig');
    });

    test('should reject configuration with missing required fields', async () => {
      const invalidConfig = {
        globalDefaults: {
          windowSizeSeconds: 60
        }
        // Missing required 'tiers' field
      };

      const result = await validator.validateConfiguration('rateLimitConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('MISSING_REQUIRED');
      expect(result.errors[0].field).toBe('tiers');
      expect(result.errors[0].message).toContain('Missing required property: tiers');
    });

    test('should reject configuration with negative limits', async () => {
      const invalidConfig = {
        tiers: {
          free: {
            limits: {
              second: -1,
              minute: 10
            }
          }
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.type === 'RANGE_ERROR')).toBe(true);
    });

    test('should reject configuration with invalid tier names', async () => {
      const invalidConfig = {
        tiers: {
          'invalid-tier': {
            limits: {
              second: 1
            }
          }
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'PATTERN_MISMATCH')).toBe(true);
    });

    test('should reject configuration with additional properties when not allowed', async () => {
      const invalidConfig = {
        tiers: {
          free: {
            limits: {
              second: 1
            },
            invalidProperty: 'should not be here'
          }
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'ADDITIONAL_PROPERTY')).toBe(true);
    });
  });

  describe('Schema Validation - Client Config', () => {
    test('should validate correct client configuration', async () => {
      const validConfig = {
        clients: [
          {
            client_name: 'Test Client',
            api_key: 'test-api-key-123',
            tier: 'premium',
            active: true,
            created_date: '2025-01-01T00:00:00Z',
            description: 'Test client for validation'
          }
        ]
      };

      const result = await validator.validateConfiguration('clientConfig', validConfig);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject clients with invalid API keys', async () => {
      const invalidConfig = {
        clients: [
          {
            client_name: 'Test Client',
            api_key: 'short',
            tier: 'free'
          }
        ]
      };

      const result = await validator.validateConfiguration('clientConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field.includes('api_key'))).toBe(true);
    });

    test('should reject clients with invalid tiers', async () => {
      const invalidConfig = {
        clients: [
          {
            client_name: 'Test Client',
            api_key: 'valid-api-key-123',
            tier: 'invalid-tier'
          }
        ]
      };

      const result = await validator.validateConfiguration('clientConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'ENUM_ERROR' && e.field.includes('tier'))).toBe(true);
    });
  });

  describe('Schema Validation - IP List Config', () => {
    test('should validate correct IP list configuration', async () => {
      const validConfig = {
        allowlist: [
          {
            ip_or_cidr: '192.168.1.100',
            description: 'Admin workstation',
            added_date: '2025-01-01T00:00:00Z'
          },
          {
            ip_or_cidr: '10.0.0.0/24',
            description: 'Internal network',
            added_date: '2025-01-01T00:00:00Z'
          }
        ],
        blocklist: [
          {
            ip_or_cidr: '203.0.113.42',
            description: 'Malicious IP',
            added_date: '2025-01-01T00:00:00Z',
            severity: 'high'
          }
        ]
      };

      const result = await validator.validateConfiguration('ipListConfig', validConfig);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject invalid IP addresses', async () => {
      const invalidConfig = {
        allowlist: [
          {
            ip_or_cidr: 'not-an-ip',
            description: 'Invalid IP'
          }
        ]
      };

      const result = await validator.validateConfiguration('ipListConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'PATTERN_ERROR')).toBe(true);
    });
  });

  describe('Semantic Validation - Rate Limits', () => {
    test('should detect tier hierarchy violations', async () => {
      const invalidConfig = {
        tiers: {
          free: {
            limits: {
              second: 10
            },
            priority: 1
          },
          premium: {
            limits: {
              second: 5  // Lower than free tier
            },
            priority: 2  // Higher priority should have higher limits
          }
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'TIER_HIERARCHY_VIOLATION')).toBe(true);
    });

    test('should detect time window logic errors', async () => {
      const invalidConfig = {
        tiers: {
          free: {
            limits: {
              second: 100,
              minute: 50  // 100 * 60 > 50
            }
          }
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'WINDOW_LOGIC_ERROR')).toBe(true);
    });

    test('should detect invalid burst configurations', async () => {
      const invalidConfig = {
        tiers: {
          free: {
            limits: {
              second: 1
            },
            burstAllowance: 0.5  // Cannot be less than 1.0
          }
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'BURST_CONFIG_ERROR')).toBe(true);
    });

    test('should detect priority conflicts', async () => {
      const invalidConfig = {
        tiers: {
          free: {
            limits: { second: 1 },
            priority: 1
          },
          basic: {
            limits: { second: 2 },
            priority: 1  // Same priority as free
          }
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'PRIORITY_CONFLICT')).toBe(true);
    });
  });

  describe('Semantic Validation - Clients', () => {
    test('should detect duplicate API keys', async () => {
      const invalidConfig = {
        clients: [
          {
            client_name: 'Client 1',
            api_key: 'duplicate-key-123',
            tier: 'free'
          },
          {
            client_name: 'Client 2',
            api_key: 'duplicate-key-123',
            tier: 'basic'
          }
        ]
      };

      const result = await validator.validateConfiguration('clientConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'DUPLICATE_API_KEY')).toBe(true);
    });

    test('should detect duplicate client names', async () => {
      const invalidConfig = {
        clients: [
          {
            client_name: 'Test Client',
            api_key: 'valid-key-1234',
            tier: 'free'
          },
          {
            client_name: 'Test Client',
            api_key: 'valid-key-5678',
            tier: 'basic'
          }
        ]
      };

      const result = await validator.validateConfiguration('clientConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'DUPLICATE_CLIENT_NAME')).toBe(true);
    });

    test('should warn about weak API keys', async () => {
      const configWithWeakKey = {
        clients: [
          {
            client_name: 'Test Client',
            api_key: 'shortbutvalid',  // 14 chars, valid but weak
            tier: 'free'
          }
        ]
      };

      const result = await validator.validateConfiguration('clientConfig', configWithWeakKey);
      
      expect(result.warnings.some(w => w.type === 'WEAK_API_KEY')).toBe(true);
    });
  });

  describe('Semantic Validation - IP Lists', () => {
    test('should detect invalid CIDR masks', async () => {
      const invalidConfig = {
        allowlist: [
          {
            ip_or_cidr: '192.168.1.0/40',  // Invalid IPv4 mask
            description: 'Invalid CIDR'
          }
        ]
      };

      const result = await validator.validateConfiguration('ipListConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'INVALID_CIDR_MASK')).toBe(true);
    });

    test('should detect IP list conflicts', async () => {
      const conflictConfig = {
        allowlist: [
          {
            ip_or_cidr: '192.168.1.100',
            description: 'Allowed IP'
          }
        ],
        blocklist: [
          {
            ip_or_cidr: '192.168.1.100',
            description: 'Blocked IP'
          }
        ]
      };

      const result = await validator.validateConfiguration('ipListConfig', conflictConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'IP_LIST_CONFLICT')).toBe(true);
    });

    test('should detect invalid date ranges', async () => {
      const invalidConfig = {
        allowlist: [
          {
            ip_or_cidr: '192.168.1.100',
            added_date: '2025-01-01T00:00:00Z',
            expires_date: '2024-12-31T00:00:00Z'  // Expires before added
          }
        ]
      };

      const result = await validator.validateConfiguration('ipListConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'INVALID_DATE_RANGE')).toBe(true);
    });
  });

  describe('JSON/YAML Parsing', () => {
    test('should parse valid JSON configuration', async () => {
      const jsonConfig = JSON.stringify({
        tiers: {
          free: {
            limits: { second: 1 }
          }
        }
      });

      const result = await validator.validateConfiguration('rateLimitConfig', jsonConfig, 'json');
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should detect JSON syntax errors', async () => {
      const invalidJson = '{ "tiers": { "free": { "limits": { "second": 1 } } }'; // Missing closing brace

      const result = await validator.validateConfiguration('rateLimitConfig', invalidJson, 'json');
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'SYNTAX_ERROR')).toBe(true);
    });

    test('should auto-detect JSON format', async () => {
      const jsonConfig = '{ "tiers": { "free": { "limits": { "second": 1 } } } }';

      const result = await validator.validateConfiguration('rateLimitConfig', jsonConfig);
      
      expect(result.valid).toBe(true);
    });

    test('should handle YAML configuration', async () => {
      const yamlConfig = `
tiers:
  free:
    limits:
      second: 1
`;

      const result = await validator.validateConfiguration('rateLimitConfig', yamlConfig, 'yaml');
      
      expect(result.valid).toBe(true);
    });
  });

  describe('Error Message Quality', () => {
    test('should provide actionable error messages', async () => {
      const invalidConfig = {
        tiers: {
          free: {
            limits: {
              second: -1
            }
          }
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      const rangeError = result.errors.find(e => e.type === 'RANGE_ERROR');
      expect(rangeError).toBeDefined();
      expect(rangeError.field).toBe('tiers.free.limits.second');
      expect(rangeError.message).toContain('below minimum');
      expect(rangeError.severity).toBe('error');
    });

    test('should include field references in error messages', async () => {
      const invalidConfig = {
        clients: [
          {
            client_name: 'Test',
            api_key: 'duplicate-key-123',
            tier: 'free'
          },
          {
            client_name: 'Test2',
            api_key: 'duplicate-key-123',
            tier: 'basic'
          }
        ]
      };

      const result = await validator.validateConfiguration('clientConfig', invalidConfig);
      
      expect(result.valid).toBe(false);
      const duplicateError = result.errors.find(e => e.type === 'DUPLICATE_API_KEY');
      expect(duplicateError.field).toMatch(/clients\[\d+\]\.api_key/);
    });
  });

  describe('File Validation', () => {
    const testConfigDir = 'test-configs';

    beforeAll(async () => {
      // Create test config files
      await fs.mkdir(testConfigDir, { recursive: true });
      
      const validConfig = {
        tiers: {
          free: { limits: { second: 1 } }
        }
      };
      
      await fs.writeFile(
        path.join(testConfigDir, 'valid.json'),
        JSON.stringify(validConfig, null, 2)
      );

      await fs.writeFile(
        path.join(testConfigDir, 'invalid.json'),
        '{ invalid json'
      );
    });

    afterAll(async () => {
      // Cleanup test files
      await fs.rm(testConfigDir, { recursive: true, force: true });
    });

    test('should validate configuration from file', async () => {
      const result = await validator.validateConfigurationFile(
        'rateLimitConfig',
        path.join(testConfigDir, 'valid.json')
      );
      
      expect(result.valid).toBe(true);
      expect(result.filePath).toContain('valid.json');
    });

    test('should handle file read errors', async () => {
      const result = await validator.validateConfigurationFile(
        'rateLimitConfig',
        'nonexistent-file.json'
      );
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'FILE_ERROR')).toBe(true);
    });

    test('should handle syntax errors in files', async () => {
      const result = await validator.validateConfigurationFile(
        'rateLimitConfig',
        path.join(testConfigDir, 'invalid.json')
      );
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'SYNTAX_ERROR')).toBe(true);
    });
  });

  describe('Multiple Configuration Validation', () => {
    test('should validate multiple configurations at once', async () => {
      const configurations = {
        rateLimitConfig: {
          tiers: {
            free: { 
              limits: { 
                second: 1,
                minute: 60
              } 
            }
          }
        },
        clientConfig: {
          clients: [
            {
              client_name: 'Test',
              api_key: 'test-key-123',
              tier: 'free'
            }
          ]
        }
      };

      const summary = await validator.validateMultipleConfigurations(configurations);
      
      expect(summary.totalConfigs).toBe(2);
      expect(summary.validConfigs).toBe(2);
      expect(summary.totalErrors).toBe(0);
      expect(summary.results.rateLimitConfig.valid).toBe(true);
      expect(summary.results.clientConfig.valid).toBe(true);
    });

    test('should report summary of validation failures', async () => {
      const configurations = {
        rateLimitConfig: {
          // Missing required tiers
        },
        clientConfig: {
          clients: [
            {
              client_name: 'Test',
              api_key: 'short',
              tier: 'invalid'
            }
          ]
        }
      };

      const summary = await validator.validateMultipleConfigurations(configurations);
      
      expect(summary.totalConfigs).toBe(2);
      expect(summary.validConfigs).toBe(0);
      expect(summary.totalErrors).toBeGreaterThan(0);
    });
  });

  describe('Warnings Generation', () => {
    test('should generate warnings for potential issues', async () => {
      const configWithHighLimits = {
        tiers: {
          free: {
            limits: {
              second: 5000  // Very high limit
            }
          }
        }
      };

      const result = await validator.validateConfiguration('rateLimitConfig', configWithHighLimits);
      
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.type === 'HIGH_RATE_LIMIT')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty configuration', async () => {
      const result = await validator.validateConfiguration('rateLimitConfig', {});
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'MISSING_REQUIRED')).toBe(true);
    });

    test('should handle null configuration', async () => {
      const result = await validator.validateConfiguration('rateLimitConfig', null);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should handle unknown configuration type', async () => {
      const result = await validator.validateConfiguration('unknownType', {});
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'SCHEMA_ERROR')).toBe(true);
    });

    test('should handle malformed YAML', async () => {
      const malformedYaml = `
tiers:
  free:
    limits:
      second: 1
    - invalid: structure
`;

      const result = await validator.validateConfiguration('rateLimitConfig', malformedYaml, 'yaml');
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.type === 'SYNTAX_ERROR')).toBe(true);
    });
  });

  describe('Performance', () => {
    test('should validate large configurations efficiently', async () => {
      const largeConfig = {
        clients: Array.from({ length: 1000 }, (_, i) => ({
          client_name: `Client-${i}`,
          api_key: `key-${i.toString().padStart(6, '0')}-${Math.random().toString(36).substring(2, 10)}`,
          tier: ['free', 'basic', 'standard', 'premium', 'enterprise'][i % 5]
        }))
      };

      const startTime = Date.now();
      const result = await validator.validateConfiguration('clientConfig', largeConfig);
      const endTime = Date.now();

      expect(result.valid).toBe(true);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    }, 10000);
  });
});