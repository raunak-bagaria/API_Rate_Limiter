/**
 * ErrorMessageManager: Manages configurable custom error messages for blocked/rate-limited responses
 * 
 * Features:
 * - Configurable error messages per block type (rate-limit, ip-blocklist, unauthorized, tier-restricted)
 * - Template variable substitution ({{clientId}}, {{contactEmail}}, {{retryAfter}}, etc.)
 * - Default messages if custom messages not configured
 * - Hot-reload support for message updates
 * - CSV-based configuration storage
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Block type constants
 */
export const BlockType = {
  RATE_LIMIT: 'rate_limit',
  IP_BLOCKLIST: 'ip_blocklist',
  UNAUTHORIZED: 'unauthorized',
  TIER_RESTRICTED: 'tier_restricted'
};

/**
 * Default error messages
 */
const DEFAULT_MESSAGES = {
  [BlockType.RATE_LIMIT]: 'Rate limit exceeded for {{limitingWindow}} window. You have made {{currentCount}} requests out of {{limit}} allowed. Please wait {{retryAfter}} seconds before retrying. Contact {{contactEmail}} for assistance.',
  [BlockType.IP_BLOCKLIST]: 'Access denied. Your IP address ({{clientIP}}) has been blocked. If you believe this is an error, please contact {{contactEmail}}.',
  [BlockType.UNAUTHORIZED]: 'Unauthorized request. Invalid or missing API key. Please provide a valid X-API-Key header. Contact {{contactEmail}} for API access.',
  [BlockType.TIER_RESTRICTED]: 'Access denied. This endpoint requires {{requiredTier}} tier or higher. Your current tier is {{yourTier}}. Contact {{contactEmail}} to upgrade your account.'
};

/**
 * Default contact email
 */
const DEFAULT_CONTACT_EMAIL = 'support@api-rate-limiter.com';

/**
 * ErrorMessageManager class
 */
class ErrorMessageManager {
  /**
   * Initialize ErrorMessageManager
   * @param {string} messagesFile - Path to CSV file with error messages
   * @param {string} contactEmail - Default contact email for support
   */
  constructor(messagesFile = 'error_messages.csv', contactEmail = DEFAULT_CONTACT_EMAIL) {
    this.messagesFile = path.join(__dirname, messagesFile);
    this.contactEmail = contactEmail;
    
    // Map<block_type, message_template>
    this.messages = new Map();
    
    this._loadMessages();
  }

  /**
   * Load error messages from CSV file
   * @private
   */
  _loadMessages() {
    try {
      if (!fs.existsSync(this.messagesFile)) {
        console.warn(`Error messages file not found: ${this.messagesFile}`);
        this._createMessagesFile();
        return;
      }

      const fileContent = fs.readFileSync(this.messagesFile, 'utf-8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      this.messages.clear();

      for (const row of records) {
        const blockType = row.block_type?.trim();
        const messageTemplate = row.message_template?.trim();

        if (!blockType || !messageTemplate) continue;

        this.messages.set(blockType, messageTemplate);
      }

      console.info(`Loaded ${this.messages.size} custom error messages`);
    } catch (error) {
      console.error(`Error reading error messages file: ${error.message}`);
      // Continue with defaults
    }
  }

  /**
   * Create error messages CSV file with defaults
   * @private
   */
  _createMessagesFile() {
    try {
      const records = [
        {
          block_type: BlockType.RATE_LIMIT,
          message_template: DEFAULT_MESSAGES[BlockType.RATE_LIMIT],
          description: 'Message displayed when a client exceeds rate limits'
        },
        {
          block_type: BlockType.IP_BLOCKLIST,
          message_template: DEFAULT_MESSAGES[BlockType.IP_BLOCKLIST],
          description: 'Message displayed when an IP is on the blocklist'
        },
        {
          block_type: BlockType.UNAUTHORIZED,
          message_template: DEFAULT_MESSAGES[BlockType.UNAUTHORIZED],
          description: 'Message displayed when API key is invalid or missing'
        },
        {
          block_type: BlockType.TIER_RESTRICTED,
          message_template: DEFAULT_MESSAGES[BlockType.TIER_RESTRICTED],
          description: 'Message displayed when a client tries to access a tier-restricted endpoint'
        }
      ];

      const csvContent = stringify(records, {
        header: true,
        columns: ['block_type', 'message_template', 'description']
      });

      fs.writeFileSync(this.messagesFile, csvContent, 'utf-8');
      console.info(`Created ${this.messagesFile} with default messages`);
      
      // Reload to populate the messages map
      this._loadMessages();
    } catch (error) {
      console.error(`Error creating error messages file: ${error.message}`);
    }
  }

  /**
   * Save error messages to CSV file
   * @private
   */
  _saveMessages() {
    try {
      const records = [];
      
      // Default descriptions for each block type
      const descriptions = {
        [BlockType.RATE_LIMIT]: 'Message displayed when a client exceeds rate limits',
        [BlockType.IP_BLOCKLIST]: 'Message displayed when an IP is on the blocklist',
        [BlockType.UNAUTHORIZED]: 'Message displayed when API key is invalid or missing',
        [BlockType.TIER_RESTRICTED]: 'Message displayed when a client tries to access a tier-restricted endpoint'
      };

      for (const [blockType, messageTemplate] of this.messages.entries()) {
        records.push({
          block_type: blockType,
          message_template: messageTemplate,
          description: descriptions[blockType] || ''
        });
      }

      const csvContent = stringify(records, {
        header: true,
        columns: ['block_type', 'message_template', 'description']
      });

      fs.writeFileSync(this.messagesFile, csvContent, 'utf-8');
      console.info(`Saved ${records.length} error messages`);
    } catch (error) {
      console.error(`Error saving error messages file: ${error.message}`);
    }
  }

  /**
   * Replace template variables in a message string
   * @param {string} template - Message template with {{variables}}
   * @param {Object} variables - Object with variable values
   * @returns {string} Message with variables replaced
   * @private
   */
  _replaceVariables(template, variables) {
    let message = template;

    // Replace all template variables
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      message = message.replace(regex, value !== undefined && value !== null ? value : '');
    }

    // Always include contact email if not provided
    if (!variables.contactEmail) {
      message = message.replace(/\{\{contactEmail\}\}/g, this.contactEmail);
    }

    return message;
  }

  /**
   * Get error message for rate limit exceeded
   * @param {Object} context - Context object with rate limit details
   * @param {string} context.clientName - Name of the client
   * @param {string} context.tier - Client tier
   * @param {string} context.limitingWindow - Time window that exceeded limit
   * @param {number} context.retryAfter - Seconds until retry
   * @param {number} context.currentCount - Current request count
   * @param {number} context.limit - Request limit for the window
   * @param {string} context.contactEmail - Optional custom contact email
   * @returns {string} Error message with variables replaced
   */
  getRateLimitMessage(context) {
    const template = this.messages.get(BlockType.RATE_LIMIT) || DEFAULT_MESSAGES[BlockType.RATE_LIMIT];
    
    const variables = {
      clientName: context.clientName || 'Unknown',
      clientId: context.clientName || 'Unknown',
      tier: context.tier || 'unknown',
      limitingWindow: context.limitingWindow || 'unknown',
      retryAfter: context.retryAfter || 0,
      currentCount: context.currentCount || 0,
      limit: context.limit || 0,
      contactEmail: context.contactEmail || this.contactEmail
    };

    return this._replaceVariables(template, variables);
  }

  /**
   * Get error message for IP blocklist
   * @param {Object} context - Context object with IP details
   * @param {string} context.clientIP - IP address that is blocked
   * @param {string} context.reason - Optional reason for blocking
   * @param {string} context.contactEmail - Optional custom contact email
   * @returns {string} Error message with variables replaced
   */
  getIPBlocklistMessage(context) {
    const template = this.messages.get(BlockType.IP_BLOCKLIST) || DEFAULT_MESSAGES[BlockType.IP_BLOCKLIST];
    
    const variables = {
      clientIP: context.clientIP || 'Unknown',
      reason: context.reason || 'IP address is blocklisted',
      contactEmail: context.contactEmail || this.contactEmail
    };

    return this._replaceVariables(template, variables);
  }

  /**
   * Get error message for unauthorized access
   * @param {Object} context - Context object with auth details
   * @param {string} context.reason - Optional specific reason
   * @param {string} context.contactEmail - Optional custom contact email
   * @returns {string} Error message with variables replaced
   */
  getUnauthorizedMessage(context = {}) {
    const template = this.messages.get(BlockType.UNAUTHORIZED) || DEFAULT_MESSAGES[BlockType.UNAUTHORIZED];
    
    const variables = {
      reason: context.reason || 'Invalid or missing API key',
      contactEmail: context.contactEmail || this.contactEmail
    };

    return this._replaceVariables(template, variables);
  }

  /**
   * Get error message for tier-restricted access
   * @param {Object} context - Context object with tier details
   * @param {string} context.clientName - Name of the client
   * @param {string} context.yourTier - Current tier of the client
   * @param {string} context.requiredTier - Required tier for access
   * @param {string} context.contactEmail - Optional custom contact email
   * @returns {string} Error message with variables replaced
   */
  getTierRestrictedMessage(context) {
    const template = this.messages.get(BlockType.TIER_RESTRICTED) || DEFAULT_MESSAGES[BlockType.TIER_RESTRICTED];
    
    const variables = {
      clientName: context.clientName || 'Unknown',
      clientId: context.clientName || 'Unknown',
      yourTier: context.yourTier || 'unknown',
      requiredTier: context.requiredTier || 'premium',
      contactEmail: context.contactEmail || this.contactEmail
    };

    return this._replaceVariables(template, variables);
  }

  /**
   * Get message template for a specific block type
   * @param {string} blockType - Block type
   * @returns {string|null} Message template or null if not found
   */
  getMessageTemplate(blockType) {
    return this.messages.get(blockType) || DEFAULT_MESSAGES[blockType] || null;
  }

  /**
   * Update message template for a specific block type
   * @param {string} blockType - Block type
   * @param {string} messageTemplate - New message template
   * @returns {boolean} True if updated successfully
   */
  updateMessage(blockType, messageTemplate) {
    if (!blockType || !messageTemplate) {
      return false;
    }

    this.messages.set(blockType, messageTemplate);
    this._saveMessages();
    
    console.info(`Updated error message for block type: ${blockType}`);
    return true;
  }

  /**
   * Get all message templates
   * @returns {Object} Object with all message templates by block type
   */
  getAllMessages() {
    const allMessages = {};
    
    // Include both custom and default messages
    for (const blockType of Object.values(BlockType)) {
      allMessages[blockType] = this.messages.get(blockType) || DEFAULT_MESSAGES[blockType];
    }
    
    return allMessages;
  }

  /**
   * Reset message template to default for a specific block type
   * @param {string} blockType - Block type
   * @returns {boolean} True if reset successfully
   */
  resetToDefault(blockType) {
    if (!DEFAULT_MESSAGES[blockType]) {
      return false;
    }

    this.messages.set(blockType, DEFAULT_MESSAGES[blockType]);
    this._saveMessages();
    
    console.info(`Reset error message to default for block type: ${blockType}`);
    return true;
  }

  /**
   * Reload error messages from file
   */
  reload() {
    const oldCount = this.messages.size;
    this._loadMessages();
    console.info(`Error messages reloaded: ${oldCount} -> ${this.messages.size}`);
  }

  /**
   * Update contact email
   * @param {string} email - New contact email
   */
  setContactEmail(email) {
    if (email) {
      this.contactEmail = email;
      console.info(`Contact email updated to: ${email}`);
    }
  }

  /**
   * Get current contact email
   * @returns {string} Current contact email
   */
  getContactEmail() {
    return this.contactEmail;
  }

  /**
   * Get statistics
   * @returns {Object} Statistics object
   */
  getStatistics() {
    return {
      totalMessages: this.messages.size,
      contactEmail: this.contactEmail,
      messagesFile: this.messagesFile,
      blockTypes: Object.values(BlockType)
    };
  }
}

export default ErrorMessageManager;
