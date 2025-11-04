/**
 * ConfigurationValidator: Validates configuration syntax and semantics before applying changes
 * 
 * Features:
 * - JSON/YAML syntax validation with schema enforcement
 * - Semantic validation for business logic errors
 * - Clear, actionable error messages with line/field references
 * - Support for rate limit configs, client configs, IP lists
 * - Pre-deploy validation for UI and API
 * 
 * Validation Types:
 * 1. Syntax: JSON/YAML structure, required fields, data types
 * 2. Semantic: Business logic, negative limits, conflicting rules, impossible windows
 * 3. Cross-reference: Tier consistency, client references, dependency validation
 */

import fs from 'fs/promises';
import { parse as parseYaml } from 'yaml';

class ConfigurationValidator {
  constructor() {
    this.schemas = this._initializeSchemas();
    this.validationRules = this._initializeSemanticRules();
    console.info('ConfigurationValidator initialized with schema and semantic validation');
  }

  /**
   * Initialize JSON schemas for different configuration types
   */
  _initializeSchemas() {
    return {
      rateLimitConfig: {
        type: 'object',
        properties: {
          tiers: {
            type: 'object',
            patternProperties: {
              '^(free|basic|standard|premium|enterprise)$': {
                type: 'object',
                properties: {
                  limits: {
                    type: 'object',
                    properties: {
                      second: { type: 'integer', minimum: 0 },
                      minute: { type: 'integer', minimum: 0 },
                      hour: { type: 'integer', minimum: 0 },
                      day: { type: 'integer', minimum: 0 }
                    },
                    additionalProperties: false,
                    minProperties: 1
                  },
                  burstAllowance: { type: 'number', minimum: 0, maximum: 2.0 },
                  priority: { type: 'integer', minimum: 1, maximum: 10 }
                },
                required: ['limits'],
                additionalProperties: false
              }
            },
            additionalProperties: false,
            minProperties: 1
          },
          globalDefaults: {
            type: 'object',
            properties: {
              windowSizeSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
              cleanupIntervalMs: { type: 'integer', minimum: 1000, maximum: 3600000 },
              accuracyMargin: { type: 'number', minimum: 0, maximum: 20 }
            },
            additionalProperties: false
          }
        },
        required: ['tiers'],
        additionalProperties: false
      },

      clientConfig: {
        type: 'object',
        properties: {
          clients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                client_name: { type: 'string', minLength: 1, maxLength: 100 },
                api_key: { 
                  type: 'string', 
                  pattern: '^[A-Za-z0-9-_]{10,50}$',
                  minLength: 10,
                  maxLength: 50
                },
                tier: { 
                  type: 'string',
                  enum: ['free', 'basic', 'standard', 'premium', 'enterprise']
                },
                active: { type: 'boolean' },
                created_date: { type: 'string', format: 'date-time' },
                description: { type: 'string', maxLength: 500 }
              },
              required: ['client_name', 'api_key', 'tier'],
              additionalProperties: false
            },
            minItems: 1
          }
        },
        required: ['clients'],
        additionalProperties: false
      },

      ipListConfig: {
        type: 'object',
        properties: {
          allowlist: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ip_or_cidr: { 
                  type: 'string',
                  pattern: '^(?:(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?:\\/[0-9]{1,2})?|(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?:\\/[0-9]{1,3})?)$'
                },
                description: { type: 'string', maxLength: 200 },
                added_date: { type: 'string', format: 'date-time' },
                expires_date: { type: 'string', format: 'date-time' }
              },
              required: ['ip_or_cidr'],
              additionalProperties: false
            }
          },
          blocklist: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ip_or_cidr: { 
                  type: 'string',
                  pattern: '^(?:(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?:\\/[0-9]{1,2})?|(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?:\\/[0-9]{1,3})?)$'
                },
                description: { type: 'string', maxLength: 200 },
                added_date: { type: 'string', format: 'date-time' },
                severity: { 
                  type: 'string',
                  enum: ['low', 'medium', 'high', 'critical']
                }
              },
              required: ['ip_or_cidr'],
              additionalProperties: false
            }
          }
        },
        additionalProperties: false
      }
    };
  }

  /**
   * Initialize semantic validation rules
   */
  _initializeSemanticRules() {
    return {
      rateLimitConfig: [
        this._validateRateLimitHierarchy,
        this._validateTimeWindowLogic,
        this._validateBurstConfiguration,
        this._validateTierPrecedence
      ],
      clientConfig: [
        this._validateClientUniqueness,
        this._validateApiKeyFormat,
        this._validateTierConsistency
      ],
      ipListConfig: [
        this._validateIpCidrFormat,
        this._validateIpListConflicts,
        this._validateExpirationDates
      ]
    };
  }

  /**
   * Main validation method - validates both syntax and semantics
   * @param {string} configType - Type of configuration (rateLimitConfig, clientConfig, ipListConfig)
   * @param {string|Object} configData - Configuration as string (JSON/YAML) or parsed object
   * @param {string} format - 'json' or 'yaml' (auto-detected if not provided)
   * @returns {Object} Validation result with success flag and detailed errors
   */
  async validateConfiguration(configType, configData, format = null) {
    const validationResult = {
      valid: true,
      errors: [],
      warnings: [],
      configType: configType,
      timestamp: new Date().toISOString()
    };

    try {
      // Step 1: Parse configuration if it's a string
      let parsedConfig;
      let actualFormat = format;

      if (typeof configData === 'string') {
        const parseResult = this._parseConfigurationString(configData, format);
        parsedConfig = parseResult.parsed;
        actualFormat = parseResult.format;
        
        if (parseResult.errors.length > 0) {
          validationResult.errors.push(...parseResult.errors);
          validationResult.valid = false;
          return validationResult;
        }
      } else {
        parsedConfig = configData;
      }

      // Step 2: Schema validation (syntax)
      const schemaErrors = this._validateSchema(configType, parsedConfig);
      if (schemaErrors.length > 0) {
        validationResult.errors.push(...schemaErrors);
        validationResult.valid = false;
      }

      // Step 3: Semantic validation (business logic)
      if (validationResult.valid) {
        const semanticErrors = await this._validateSemantics(configType, parsedConfig);
        if (semanticErrors.length > 0) {
          validationResult.errors.push(...semanticErrors);
          validationResult.valid = false;
        }
      }

      // Step 4: Generate warnings for potential issues
      const warnings = this._generateWarnings(configType, parsedConfig);
      validationResult.warnings.push(...warnings);

      console.info(
        `Configuration validation completed: ${configType} - ` +
        `Valid: ${validationResult.valid}, ` +
        `Errors: ${validationResult.errors.length}, ` +
        `Warnings: ${validationResult.warnings.length}`
      );

      return validationResult;

    } catch (error) {
      validationResult.valid = false;
      validationResult.errors.push({
        type: 'VALIDATION_ERROR',
        field: 'configuration',
        message: `Unexpected validation error: ${error.message}`,
        line: null,
        column: null,
        severity: 'error'
      });
      return validationResult;
    }
  }

  /**
   * Validate configuration file from filesystem
   * @param {string} configType - Type of configuration
   * @param {string} filePath - Path to configuration file
   * @returns {Object} Validation result
   */
  async validateConfigurationFile(configType, filePath) {
    try {
      const configContent = await fs.readFile(filePath, 'utf-8');
      const format = filePath.endsWith('.yaml') || filePath.endsWith('.yml') ? 'yaml' : 'json';
      
      const result = await this.validateConfiguration(configType, configContent, format);
      result.filePath = filePath;
      return result;
    } catch (error) {
      return {
        valid: false,
        errors: [{
          type: 'FILE_ERROR',
          field: 'file',
          message: `Cannot read configuration file: ${error.message}`,
          line: null,
          column: null,
          severity: 'error'
        }],
        warnings: [],
        configType: configType,
        filePath: filePath,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Parse configuration string (JSON or YAML)
   */
  _parseConfigurationString(configString, format) {
    const result = {
      parsed: null,
      format: format,
      errors: []
    };

    // Auto-detect format if not provided
    if (!format) {
      const trimmed = configString.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        result.format = 'json';
      } else {
        result.format = 'yaml';
      }
    }

    try {
      if (result.format === 'yaml') {
        result.parsed = parseYaml(configString);
      } else {
        result.parsed = JSON.parse(configString);
      }
    } catch (error) {
      result.errors.push({
        type: 'SYNTAX_ERROR',
        field: 'configuration',
        message: `${result.format.toUpperCase()} parsing error: ${error.message}`,
        line: error.line || null,
        column: error.column || null,
        severity: 'error'
      });
    }

    return result;
  }

  /**
   * Validate configuration against JSON schema
   */
  _validateSchema(configType, config) {
    const errors = [];
    const schema = this.schemas[configType];

    if (!schema) {
      errors.push({
        type: 'SCHEMA_ERROR',
        field: 'configType',
        message: `Unknown configuration type: ${configType}`,
        line: null,
        column: null,
        severity: 'error'
      });
      return errors;
    }

    // Simple schema validation implementation
    const validate = (obj, schema, path = '') => {
      if (schema.type === 'object') {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
          errors.push({
            type: 'TYPE_ERROR',
            field: path || 'root',
            message: `Expected object, got ${typeof obj}`,
            line: null,
            column: null,
            severity: 'error'
          });
          return;
        }

        // Check required properties
        if (schema.required) {
          for (const required of schema.required) {
            if (!(required in obj)) {
              errors.push({
                type: 'MISSING_REQUIRED',
                field: path ? `${path}.${required}` : required,
                message: `Missing required property: ${required}`,
                line: null,
                column: null,
                severity: 'error'
              });
            }
          }
        }

        // Validate properties
        if (schema.properties) {
          for (const [key, value] of Object.entries(obj)) {
            const propSchema = schema.properties[key];
            if (propSchema) {
              validate(value, propSchema, path ? `${path}.${key}` : key);
            } else if (!schema.additionalProperties && !schema.patternProperties) {
              errors.push({
                type: 'ADDITIONAL_PROPERTY',
                field: path ? `${path}.${key}` : key,
                message: `Additional property not allowed: ${key}`,
                line: null,
                column: null,
                severity: 'error'
              });
            }
          }
        }

        // Check pattern properties
        if (schema.patternProperties) {
          for (const [key, value] of Object.entries(obj)) {
            let matched = false;
            for (const [pattern, propSchema] of Object.entries(schema.patternProperties)) {
              if (new RegExp(pattern).test(key)) {
                validate(value, propSchema, path ? `${path}.${key}` : key);
                matched = true;
                break;
              }
            }
            if (!matched && !schema.additionalProperties) {
              errors.push({
                type: 'PATTERN_MISMATCH',
                field: path ? `${path}.${key}` : key,
                message: `Property key does not match any allowed pattern: ${key}`,
                line: null,
                column: null,
                severity: 'error'
              });
            }
          }
        }
      }

      // Type validation for primitives
      if (schema.type === 'string' && typeof obj !== 'string') {
        errors.push({
          type: 'TYPE_ERROR',
          field: path,
          message: `Expected string, got ${typeof obj}`,
          line: null,
          column: null,
          severity: 'error'
        });
      }

      if (schema.type === 'integer' && (!Number.isInteger(obj) || typeof obj !== 'number')) {
        errors.push({
          type: 'TYPE_ERROR',
          field: path,
          message: `Expected integer, got ${typeof obj}`,
          line: null,
          column: null,
          severity: 'error'
        });
      }

      // Range validation
      if (schema.minimum !== undefined && obj < schema.minimum) {
        errors.push({
          type: 'RANGE_ERROR',
          field: path,
          message: `Value ${obj} is below minimum ${schema.minimum}`,
          line: null,
          column: null,
          severity: 'error'
        });
      }

      if (schema.maximum !== undefined && obj > schema.maximum) {
        errors.push({
          type: 'RANGE_ERROR',
          field: path,
          message: `Value ${obj} exceeds maximum ${schema.maximum}`,
          line: null,
          column: null,
          severity: 'error'
        });
      }

      // String validation
      if (schema.pattern && typeof obj === 'string' && !new RegExp(schema.pattern).test(obj)) {
        errors.push({
          type: 'PATTERN_ERROR',
          field: path,
          message: `String does not match required pattern`,
          line: null,
          column: null,
          severity: 'error'
        });
      }

      // Array validation
      if (schema.type === 'array') {
        if (!Array.isArray(obj)) {
          errors.push({
            type: 'TYPE_ERROR',
            field: path,
            message: `Expected array, got ${typeof obj}`,
            line: null,
            column: null,
            severity: 'error'
          });
          return;
        }

        // Validate array items
        if (schema.items) {
          for (let i = 0; i < obj.length; i++) {
            const itemPath = path ? `${path}[${i}]` : `[${i}]`;
            validate(obj[i], schema.items, itemPath);
          }
        }

        // Array length validation
        if (schema.minItems !== undefined && obj.length < schema.minItems) {
          errors.push({
            type: 'ARRAY_LENGTH_ERROR',
            field: path,
            message: `Array must have at least ${schema.minItems} items`,
            line: null,
            column: null,
            severity: 'error'
          });
        }

        if (schema.maxItems !== undefined && obj.length > schema.maxItems) {
          errors.push({
            type: 'ARRAY_LENGTH_ERROR',
            field: path,
            message: `Array must have at most ${schema.maxItems} items`,
            line: null,
            column: null,
            severity: 'error'
          });
        }
      }

      // Enum validation
      if (schema.enum && !schema.enum.includes(obj)) {
        errors.push({
          type: 'ENUM_ERROR',
          field: path,
          message: `Value must be one of: ${schema.enum.join(', ')}`,
          line: null,
          column: null,
          severity: 'error'
        });
      }
    };

    validate(config, schema);
    return errors;
  }

  /**
   * Validate semantic business logic
   */
  async _validateSemantics(configType, config) {
    const errors = [];
    const rules = this.validationRules[configType] || [];

    for (const rule of rules) {
      try {
        const ruleErrors = await rule.call(this, config);
        errors.push(...ruleErrors);
      } catch (error) {
        errors.push({
          type: 'SEMANTIC_VALIDATION_ERROR',
          field: 'configuration',
          message: `Semantic validation rule failed: ${error.message}`,
          line: null,
          column: null,
          severity: 'error'
        });
      }
    }

    return errors;
  }

  /**
   * Semantic validation: Rate limit hierarchy
   */
  _validateRateLimitHierarchy(config) {
    const errors = [];
    
    if (!config.tiers) return errors;

    // Build array of tiers sorted by priority
    const tiersWithPriority = [];
    for (const [tierName, tierConfig] of Object.entries(config.tiers)) {
      if (tierConfig.priority !== undefined && tierConfig.limits) {
        tiersWithPriority.push({
          name: tierName,
          priority: tierConfig.priority,
          limits: tierConfig.limits
        });
      }
    }

    // Sort by priority (lower number = lower priority)
    tiersWithPriority.sort((a, b) => a.priority - b.priority);

    // Validate hierarchy: higher priority tiers should have higher or equal limits
    for (let i = 0; i < tiersWithPriority.length - 1; i++) {
      const lowerTier = tiersWithPriority[i];
      const higherTier = tiersWithPriority[i + 1];

      for (const window of ['second', 'minute', 'hour', 'day']) {
        const lowerLimit = lowerTier.limits[window] || 0;
        const higherLimit = higherTier.limits[window] || 0;

        if (higherLimit > 0 && lowerLimit > 0 && lowerLimit > higherLimit) {
          errors.push({
            type: 'TIER_HIERARCHY_VIOLATION',
            field: `tiers.${higherTier.name}.limits.${window}`,
            message: `Higher priority tier '${higherTier.name}' (priority ${higherTier.priority}) has lower ${window} limit (${higherLimit}) than lower priority tier '${lowerTier.name}' (priority ${lowerTier.priority}, limit ${lowerLimit})`,
            line: null,
            column: null,
            severity: 'error'
          });
        }
      }
    }

    return errors;
  }

  /**
   * Semantic validation: Time window logic
   */
  _validateTimeWindowLogic(config) {
    const errors = [];

    if (!config.tiers) return errors;

    for (const [tierName, tierConfig] of Object.entries(config.tiers)) {
      if (!tierConfig.limits) continue;

      const limits = tierConfig.limits;
      
      // Window hierarchy validation: shorter windows should not exceed longer windows
      if (limits.second && limits.minute && limits.second * 60 > limits.minute) {
        errors.push({
          type: 'WINDOW_LOGIC_ERROR',
          field: `tiers.${tierName}.limits`,
          message: `Per-second limit (${limits.second}) * 60 exceeds per-minute limit (${limits.minute})`,
          line: null,
          column: null,
          severity: 'error'
        });
      }

      if (limits.minute && limits.hour && limits.minute * 60 > limits.hour) {
        errors.push({
          type: 'WINDOW_LOGIC_ERROR',
          field: `tiers.${tierName}.limits`,
          message: `Per-minute limit (${limits.minute}) * 60 exceeds per-hour limit (${limits.hour})`,
          line: null,
          column: null,
          severity: 'error'
        });
      }

      if (limits.hour && limits.day && limits.hour * 24 > limits.day) {
        errors.push({
          type: 'WINDOW_LOGIC_ERROR',
          field: `tiers.${tierName}.limits`,
          message: `Per-hour limit (${limits.hour}) * 24 exceeds per-day limit (${limits.day})`,
          line: null,
          column: null,
          severity: 'error'
        });
      }
    }

    return errors;
  }

  /**
   * Semantic validation: Burst configuration
   */
  _validateBurstConfiguration(config) {
    const errors = [];

    if (!config.tiers) return errors;

    for (const [tierName, tierConfig] of Object.entries(config.tiers)) {
      if (tierConfig.burstAllowance !== undefined) {
        if (tierConfig.burstAllowance < 1.0) {
          errors.push({
            type: 'BURST_CONFIG_ERROR',
            field: `tiers.${tierName}.burstAllowance`,
            message: `Burst allowance (${tierConfig.burstAllowance}) cannot be less than 1.0`,
            line: null,
            column: null,
            severity: 'error'
          });
        }
      }
    }

    return errors;
  }

  /**
   * Semantic validation: Tier precedence
   */
  _validateTierPrecedence(config) {
    const errors = [];

    if (!config.tiers) return errors;

    const priorities = {};
    for (const [tierName, tierConfig] of Object.entries(config.tiers)) {
      if (tierConfig.priority !== undefined) {
        if (priorities[tierConfig.priority]) {
          errors.push({
            type: 'PRIORITY_CONFLICT',
            field: `tiers.${tierName}.priority`,
            message: `Priority ${tierConfig.priority} is already used by tier '${priorities[tierConfig.priority]}'`,
            line: null,
            column: null,
            severity: 'error'
          });
        }
        priorities[tierConfig.priority] = tierName;
      }
    }

    return errors;
  }

  /**
   * Semantic validation: Client uniqueness
   */
  _validateClientUniqueness(config) {
    const errors = [];

    if (!config.clients) return errors;

    const seenApiKeys = new Set();
    const seenNames = new Set();

    for (let i = 0; i < config.clients.length; i++) {
      const client = config.clients[i];
      const fieldPrefix = `clients[${i}]`;

      if (seenApiKeys.has(client.api_key)) {
        errors.push({
          type: 'DUPLICATE_API_KEY',
          field: `${fieldPrefix}.api_key`,
          message: `Duplicate API key: ${client.api_key}`,
          line: null,
          column: null,
          severity: 'error'
        });
      }
      seenApiKeys.add(client.api_key);

      if (seenNames.has(client.client_name)) {
        errors.push({
          type: 'DUPLICATE_CLIENT_NAME',
          field: `${fieldPrefix}.client_name`,
          message: `Duplicate client name: ${client.client_name}`,
          line: null,
          column: null,
          severity: 'error'
        });
      }
      seenNames.add(client.client_name);
    }

    return errors;
  }

  /**
   * Semantic validation: API key format
   */
  _validateApiKeyFormat(config) {
    const errors = [];

    if (!config.clients) return errors;

    for (let i = 0; i < config.clients.length; i++) {
      const client = config.clients[i];
      const fieldPrefix = `clients[${i}]`;

      // Additional API key validation beyond schema could go here
      // (Weak key warnings are handled in _generateWarnings)
    }

    return errors;
  }

  /**
   * Semantic validation: Tier consistency
   */
  _validateTierConsistency(config) {
    const errors = [];

    if (!config.clients) return errors;

    const validTiers = ['free', 'basic', 'standard', 'premium', 'enterprise'];

    for (let i = 0; i < config.clients.length; i++) {
      const client = config.clients[i];
      const fieldPrefix = `clients[${i}]`;

      if (!validTiers.includes(client.tier)) {
        errors.push({
          type: 'INVALID_TIER',
          field: `${fieldPrefix}.tier`,
          message: `Invalid tier '${client.tier}', must be one of: ${validTiers.join(', ')}`,
          line: null,
          column: null,
          severity: 'error'
        });
      }
    }

    return errors;
  }

  /**
   * Semantic validation: IP/CIDR format
   */
  _validateIpCidrFormat(config) {
    const errors = [];

    const validateIpList = (list, listType) => {
      if (!Array.isArray(list)) return;

      for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        const fieldPrefix = `${listType}[${i}]`;

        if (entry.ip_or_cidr) {
          // Additional validation beyond regex
          if (entry.ip_or_cidr.includes('/')) {
            const [ip, mask] = entry.ip_or_cidr.split('/');
            const maskNum = parseInt(mask);
            
            // IPv4 CIDR validation
            if (ip.includes('.') && (maskNum < 0 || maskNum > 32)) {
              errors.push({
                type: 'INVALID_CIDR_MASK',
                field: `${fieldPrefix}.ip_or_cidr`,
                message: `Invalid IPv4 CIDR mask: /${mask} (must be 0-32)`,
                line: null,
                column: null,
                severity: 'error'
              });
            }
            
            // IPv6 CIDR validation
            if (ip.includes(':') && (maskNum < 0 || maskNum > 128)) {
              errors.push({
                type: 'INVALID_CIDR_MASK',
                field: `${fieldPrefix}.ip_or_cidr`,
                message: `Invalid IPv6 CIDR mask: /${mask} (must be 0-128)`,
                line: null,
                column: null,
                severity: 'error'
              });
            }
          }
        }
      }
    };

    if (config.allowlist) {
      validateIpList(config.allowlist, 'allowlist');
    }

    if (config.blocklist) {
      validateIpList(config.blocklist, 'blocklist');
    }

    return errors;
  }

  /**
   * Semantic validation: IP list conflicts
   */
  _validateIpListConflicts(config) {
    const errors = [];

    if (!config.allowlist || !config.blocklist) return errors;

    // Check for IPs that appear in both allowlist and blocklist
    const allowlistIps = new Set(config.allowlist.map(entry => entry.ip_or_cidr));
    
    for (let i = 0; i < config.blocklist.length; i++) {
      const blockEntry = config.blocklist[i];
      if (allowlistIps.has(blockEntry.ip_or_cidr)) {
        errors.push({
          type: 'IP_LIST_CONFLICT',
          field: `blocklist[${i}].ip_or_cidr`,
          message: `IP ${blockEntry.ip_or_cidr} appears in both allowlist and blocklist`,
          line: null,
          column: null,
          severity: 'error'
        });
      }
    }

    return errors;
  }

  /**
   * Semantic validation: Expiration dates
   */
  _validateExpirationDates(config) {
    const errors = [];

    const validateDates = (list, listType) => {
      if (!Array.isArray(list)) return;

      for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        const fieldPrefix = `${listType}[${i}]`;

        if (entry.expires_date) {
          const expiryDate = new Date(entry.expires_date);
          const now = new Date();

          if (expiryDate <= now) {
            errors.push({
              type: 'EXPIRED_ENTRY',
              field: `${fieldPrefix}.expires_date`,
              message: `Entry expires in the past: ${entry.expires_date}`,
              line: null,
              column: null,
              severity: 'warning'
            });
          }
        }

        if (entry.added_date && entry.expires_date) {
          const addedDate = new Date(entry.added_date);
          const expiryDate = new Date(entry.expires_date);

          if (expiryDate <= addedDate) {
            errors.push({
              type: 'INVALID_DATE_RANGE',
              field: `${fieldPrefix}.expires_date`,
              message: `Expiry date must be after added date`,
              line: null,
              column: null,
              severity: 'error'
            });
          }
        }
      }
    };

    if (config.allowlist) {
      validateDates(config.allowlist, 'allowlist');
    }

    if (config.blocklist) {
      validateDates(config.blocklist, 'blocklist');
    }

    return errors;
  }

  /**
   * Generate warnings for potential issues
   */
  _generateWarnings(configType, config) {
    const warnings = [];

    if (configType === 'rateLimitConfig' && config.tiers) {
      // Check for very high limits
      for (const [tierName, tierConfig] of Object.entries(config.tiers)) {
        if (tierConfig.limits && tierConfig.limits.second && tierConfig.limits.second > 1000) {
          warnings.push({
            type: 'HIGH_RATE_LIMIT',
            field: `tiers.${tierName}.limits.second`,
            message: `Very high per-second limit (${tierConfig.limits.second}), verify this is intentional`,
            line: null,
            column: null,
            severity: 'warning'
          });
        }
      }
    }

    if (configType === 'clientConfig' && config.clients) {
      // Check for weak API keys
      for (let i = 0; i < config.clients.length; i++) {
        const client = config.clients[i];
        if (client.api_key && client.api_key.length < 16) {
          warnings.push({
            type: 'WEAK_API_KEY',
            field: `clients[${i}].api_key`,
            message: `API key too short for security (${client.api_key.length} chars, minimum 16 recommended)`,
            line: null,
            column: null,
            severity: 'warning'
          });
        }
      }
    }

    return warnings;
  }

  /**
   * Get supported configuration types
   */
  getSupportedConfigTypes() {
    return Object.keys(this.schemas);
  }

  /**
   * Get validation summary for multiple configurations
   */
  async validateMultipleConfigurations(configurations) {
    const results = {};
    
    for (const [configType, configData] of Object.entries(configurations)) {
      results[configType] = await this.validateConfiguration(configType, configData);
    }

    const summary = {
      totalConfigs: Object.keys(results).length,
      validConfigs: Object.values(results).filter(r => r.valid).length,
      totalErrors: Object.values(results).reduce((sum, r) => sum + r.errors.length, 0),
      totalWarnings: Object.values(results).reduce((sum, r) => sum + r.warnings.length, 0),
      results: results
    };

    return summary;
  }
}

export default ConfigurationValidator;