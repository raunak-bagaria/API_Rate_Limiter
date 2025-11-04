/**
 * Unit tests for ErrorMessageManager
 * 
 * Tests cover:
 * - Loading error messages from CSV
 * - Template variable substitution
 * - Default messages when custom not configured
 * - Message updates and reloading
 * - Contact email management
 * - Admin operations
 */

import ErrorMessageManager, { BlockType } from '../src/errorMessageManager.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('ErrorMessageManager', () => {
  let errorMessageManager;
  const testMessagesFile = 'test_error_messages.csv';
  const testMessagesPath = path.join(__dirname, '..', 'src', testMessagesFile);

  beforeEach(() => {
    // Clean up test file if it exists
    if (fs.existsSync(testMessagesPath)) {
      fs.unlinkSync(testMessagesPath);
    }
  });

  afterEach(() => {
    // Clean up test file after each test
    if (fs.existsSync(testMessagesPath)) {
      fs.unlinkSync(testMessagesPath);
    }
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with default messages when file does not exist', () => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
      
      expect(errorMessageManager).toBeDefined();
      expect(errorMessageManager.messages.size).toBeGreaterThan(0);
      
      // Check that file was created
      expect(fs.existsSync(testMessagesPath)).toBe(true);
    });

    test('should use default contact email when not specified', () => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
      
      expect(errorMessageManager.getContactEmail()).toBeDefined();
      expect(errorMessageManager.getContactEmail()).toContain('@');
    });

    test('should use custom contact email when specified', () => {
      const customEmail = 'custom@example.com';
      errorMessageManager = new ErrorMessageManager(testMessagesFile, customEmail);
      
      expect(errorMessageManager.getContactEmail()).toBe(customEmail);
    });
  });

  describe('Message Template Retrieval', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
    });

    test('should get message template for rate limit', () => {
      const template = errorMessageManager.getMessageTemplate(BlockType.RATE_LIMIT);
      
      expect(template).toBeDefined();
      expect(template).toContain('{{limitingWindow}}');
      expect(template).toContain('{{retryAfter}}');
    });

    test('should get message template for IP blocklist', () => {
      const template = errorMessageManager.getMessageTemplate(BlockType.IP_BLOCKLIST);
      
      expect(template).toBeDefined();
      expect(template).toContain('{{clientIP}}');
    });

    test('should get message template for unauthorized', () => {
      const template = errorMessageManager.getMessageTemplate(BlockType.UNAUTHORIZED);
      
      expect(template).toBeDefined();
      expect(template).toContain('{{contactEmail}}');
    });

    test('should get message template for tier restricted', () => {
      const template = errorMessageManager.getMessageTemplate(BlockType.TIER_RESTRICTED);
      
      expect(template).toBeDefined();
      expect(template).toContain('{{yourTier}}');
      expect(template).toContain('{{requiredTier}}');
    });

    test('should return null for unknown block type', () => {
      const template = errorMessageManager.getMessageTemplate('unknown_type');
      
      expect(template).toBeNull();
    });
  });

  describe('Rate Limit Message Generation', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile, 'support@test.com');
    });

    test('should generate rate limit message with all variables replaced', () => {
      const context = {
        clientName: 'TestClient',
        tier: 'free',
        limitingWindow: 'second',
        retryAfter: 5,
        currentCount: 10,
        limit: 10
      };

      const message = errorMessageManager.getRateLimitMessage(context);
      
      expect(message).toBeDefined();
      expect(message).toContain('second');
      expect(message).toContain('5');
      expect(message).toContain('10');
      expect(message).toContain('support@test.com');
      expect(message).not.toContain('{{');
    });

    test('should use default values for missing context properties', () => {
      const context = {
        limitingWindow: 'minute'
      };

      const message = errorMessageManager.getRateLimitMessage(context);
      
      expect(message).toBeDefined();
      expect(message).toContain('minute');
      expect(message).not.toContain('{{limitingWindow}}');
    });

    test('should use custom contact email when provided in context', () => {
      const context = {
        clientName: 'TestClient',
        tier: 'premium',
        limitingWindow: 'hour',
        retryAfter: 60,
        currentCount: 100,
        limit: 100,
        contactEmail: 'custom@example.com'
      };

      const message = errorMessageManager.getRateLimitMessage(context);
      
      expect(message).toContain('custom@example.com');
      expect(message).not.toContain('support@test.com');
    });
  });

  describe('IP Blocklist Message Generation', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile, 'support@test.com');
    });

    test('should generate IP blocklist message with variables replaced', () => {
      const context = {
        clientIP: '192.168.1.100',
        reason: 'Suspicious activity detected'
      };

      const message = errorMessageManager.getIPBlocklistMessage(context);
      
      expect(message).toBeDefined();
      expect(message).toContain('192.168.1.100');
      expect(message).toContain('support@test.com');
      expect(message).not.toContain('{{');
    });

    test('should handle missing clientIP', () => {
      const context = {
        reason: 'Blocked'
      };

      const message = errorMessageManager.getIPBlocklistMessage(context);
      
      expect(message).toBeDefined();
      expect(message).not.toContain('{{clientIP}}');
    });
  });

  describe('Unauthorized Message Generation', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile, 'support@test.com');
    });

    test('should generate unauthorized message', () => {
      const message = errorMessageManager.getUnauthorizedMessage();
      
      expect(message).toBeDefined();
      expect(message).toContain('support@test.com');
      expect(message).not.toContain('{{');
    });

    test('should include custom reason when provided', () => {
      const context = {
        reason: 'API key expired'
      };

      const message = errorMessageManager.getUnauthorizedMessage(context);
      
      expect(message).toBeDefined();
      expect(message).toContain('support@test.com');
    });
  });

  describe('Tier Restricted Message Generation', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile, 'support@test.com');
    });

    test('should generate tier restricted message with all variables', () => {
      const context = {
        clientName: 'BasicClient',
        yourTier: 'basic',
        requiredTier: 'premium'
      };

      const message = errorMessageManager.getTierRestrictedMessage(context);
      
      expect(message).toBeDefined();
      expect(message).toContain('basic');
      expect(message).toContain('premium');
      expect(message).toContain('support@test.com');
      expect(message).not.toContain('{{');
    });
  });

  describe('Message Updates', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
    });

    test('should update message template', () => {
      const newTemplate = 'Custom rate limit message: {{clientName}} exceeded limit';
      
      const success = errorMessageManager.updateMessage(BlockType.RATE_LIMIT, newTemplate);
      
      expect(success).toBe(true);
      
      const retrievedTemplate = errorMessageManager.getMessageTemplate(BlockType.RATE_LIMIT);
      expect(retrievedTemplate).toBe(newTemplate);
    });

    test('should persist message updates to file', () => {
      const newTemplate = 'Updated message for testing';
      
      errorMessageManager.updateMessage(BlockType.IP_BLOCKLIST, newTemplate);
      
      // Create new instance to verify persistence
      const newManager = new ErrorMessageManager(testMessagesFile);
      const retrievedTemplate = newManager.getMessageTemplate(BlockType.IP_BLOCKLIST);
      
      expect(retrievedTemplate).toBe(newTemplate);
    });

    test('should return false when updating with invalid parameters', () => {
      const result1 = errorMessageManager.updateMessage(null, 'message');
      const result2 = errorMessageManager.updateMessage(BlockType.RATE_LIMIT, null);
      
      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });
  });

  describe('Reset to Default', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
    });

    test('should reset message to default', () => {
      // Update message first
      const customTemplate = 'Custom message';
      errorMessageManager.updateMessage(BlockType.RATE_LIMIT, customTemplate);
      
      // Reset to default
      const success = errorMessageManager.resetToDefault(BlockType.RATE_LIMIT);
      
      expect(success).toBe(true);
      
      const template = errorMessageManager.getMessageTemplate(BlockType.RATE_LIMIT);
      expect(template).not.toBe(customTemplate);
      expect(template).toContain('{{limitingWindow}}');
    });

    test('should return false for unknown block type', () => {
      const success = errorMessageManager.resetToDefault('unknown_type');
      
      expect(success).toBe(false);
    });
  });

  describe('Get All Messages', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
    });

    test('should return all message templates', () => {
      const allMessages = errorMessageManager.getAllMessages();
      
      expect(allMessages).toBeDefined();
      expect(Object.keys(allMessages).length).toBe(4); // 4 block types
      expect(allMessages[BlockType.RATE_LIMIT]).toBeDefined();
      expect(allMessages[BlockType.IP_BLOCKLIST]).toBeDefined();
      expect(allMessages[BlockType.UNAUTHORIZED]).toBeDefined();
      expect(allMessages[BlockType.TIER_RESTRICTED]).toBeDefined();
    });

    test('should include both custom and default messages', () => {
      const customTemplate = 'Custom rate limit message';
      errorMessageManager.updateMessage(BlockType.RATE_LIMIT, customTemplate);
      
      const allMessages = errorMessageManager.getAllMessages();
      
      expect(allMessages[BlockType.RATE_LIMIT]).toBe(customTemplate);
      expect(allMessages[BlockType.IP_BLOCKLIST]).toBeDefined();
    });
  });

  describe('Contact Email Management', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile, 'initial@test.com');
    });

    test('should update contact email', () => {
      const newEmail = 'updated@example.com';
      
      errorMessageManager.setContactEmail(newEmail);
      
      expect(errorMessageManager.getContactEmail()).toBe(newEmail);
    });

    test('should not update contact email with null value', () => {
      const initialEmail = errorMessageManager.getContactEmail();
      
      errorMessageManager.setContactEmail(null);
      
      expect(errorMessageManager.getContactEmail()).toBe(initialEmail);
    });

    test('should use updated contact email in generated messages', () => {
      errorMessageManager.setContactEmail('new@example.com');
      
      const message = errorMessageManager.getUnauthorizedMessage();
      
      expect(message).toContain('new@example.com');
    });
  });

  describe('Reload Functionality', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
    });

    test('should reload messages from file', () => {
      // Update message
      errorMessageManager.updateMessage(BlockType.RATE_LIMIT, 'Custom message 1');
      
      // Manually modify the file
      const content = fs.readFileSync(testMessagesPath, 'utf-8');
      const newContent = content.replace('Custom message 1', 'Custom message 2');
      fs.writeFileSync(testMessagesPath, newContent);
      
      // Reload
      errorMessageManager.reload();
      
      const template = errorMessageManager.getMessageTemplate(BlockType.RATE_LIMIT);
      expect(template).toBe('Custom message 2');
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile, 'stats@test.com');
    });

    test('should return statistics', () => {
      const stats = errorMessageManager.getStatistics();
      
      expect(stats).toBeDefined();
      expect(stats.totalMessages).toBeGreaterThan(0);
      expect(stats.contactEmail).toBe('stats@test.com');
      expect(stats.messagesFile).toBeDefined();
      expect(stats.blockTypes).toBeDefined();
      expect(Array.isArray(stats.blockTypes)).toBe(true);
    });

    test('should include all block types in statistics', () => {
      const stats = errorMessageManager.getStatistics();
      
      expect(stats.blockTypes.length).toBe(4);
      expect(stats.blockTypes).toContain(BlockType.RATE_LIMIT);
      expect(stats.blockTypes).toContain(BlockType.IP_BLOCKLIST);
      expect(stats.blockTypes).toContain(BlockType.UNAUTHORIZED);
      expect(stats.blockTypes).toContain(BlockType.TIER_RESTRICTED);
    });
  });

  describe('Template Variable Handling', () => {
    beforeEach(() => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
    });

    test('should handle undefined variables gracefully', () => {
      const context = {
        clientName: 'TestClient',
        tier: undefined,
        limitingWindow: 'second'
      };

      const message = errorMessageManager.getRateLimitMessage(context);
      
      expect(message).toBeDefined();
      expect(message).not.toContain('undefined');
    });

    test('should handle null variables gracefully', () => {
      const context = {
        clientName: null,
        tier: 'free',
        limitingWindow: null
      };

      const message = errorMessageManager.getRateLimitMessage(context);
      
      expect(message).toBeDefined();
      expect(message).not.toContain('null');
    });

    test('should replace all occurrences of a variable', () => {
      // Create a custom template with duplicate variables
      const customTemplate = '{{clientName}} made too many requests. Contact {{clientName}} administrator.';
      errorMessageManager.updateMessage(BlockType.RATE_LIMIT, customTemplate);
      
      const context = {
        clientName: 'TestClient'
      };

      const message = errorMessageManager.getRateLimitMessage(context);
      
      expect(message).toContain('TestClient made too many requests');
      expect(message).toContain('Contact TestClient administrator');
      expect(message).not.toContain('{{clientName}}');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty context object', () => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
      
      const message = errorMessageManager.getRateLimitMessage({});
      
      expect(message).toBeDefined();
      expect(typeof message).toBe('string');
    });

    test('should handle messages with special characters', () => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
      
      const specialTemplate = 'Error! Client {{clientName}} @ {{tier}} - Rate limit: ${{limit}}';
      errorMessageManager.updateMessage(BlockType.RATE_LIMIT, specialTemplate);
      
      const context = {
        clientName: 'Test&Client',
        tier: 'free',
        limit: 100
      };

      const message = errorMessageManager.getRateLimitMessage(context);
      
      expect(message).toContain('Test&Client');
      expect(message).toContain('$100');
    });

    test('should handle very long messages', () => {
      errorMessageManager = new ErrorMessageManager(testMessagesFile);
      
      const longTemplate = 'A'.repeat(1000) + ' {{clientName}} ' + 'B'.repeat(1000);
      errorMessageManager.updateMessage(BlockType.RATE_LIMIT, longTemplate);
      
      const context = {
        clientName: 'TestClient'
      };

      const message = errorMessageManager.getRateLimitMessage(context);
      
      expect(message).toContain('TestClient');
      expect(message.length).toBeGreaterThan(2000);
    });
  });
});
