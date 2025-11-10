/**
 * Client Identification Module
 * 
 * This module provides client identification with the following workflow:
 * - API key is REQUIRED - if missing, return error
 * - Validate API key to get client name and classification
 * - Extract client IP and process it through IPManager
 * - IPManager handles CIDR range checking and IP learning
 * - Client classification data is available for policy application
 */

import APIKeyManager from './apiKeyManager.js';
import IPManager from './ipManager.js';
import IPAllowBlockManager, { IPListAction } from './ipAllowBlockManager.js';

/**
 * Client service tier classifications
 */
export const ClientTier = {
  FREE: 'free',
  BASIC: 'basic',
  STANDARD: 'standard',
  PREMIUM: 'premium',
  ENTERPRISE: 'enterprise'
};

/**
 * Class representing a successfully identified client
 */
export class ClientIdentity {
  /**
   * Create a ClientIdentity
   * @param {Object} options - Identity options
   */
  constructor(options = {}) {
    this.valid = options.valid || false;
    this.clientName = options.clientName || null;
    this.classification = options.classification || null;
    this.metadata = options.metadata || {};
    this.error = options.error || null;
  }

  /**
   * Convert ClientIdentity to plain object
   * @returns {Object} Plain object representation
   */
  toJSON() {
    if (!this.valid) {
      return {
        valid: false,
        error: this.error || { message: 'Client identification failed' }
      };
    }

    const result = {
      valid: true,
      clientName: this.clientName,
      classification: this.classification
    };

    // Add metadata if present
    if (Object.keys(this.metadata).length > 0) {
      Object.assign(result, this.metadata);
    }

    return result;
  }

  /**
   * Check if client belongs to a specific tier
   * @param {string} tier - Tier to check against
   * @returns {boolean} True if client is in specified tier
   */
  isTier(tier) {
    if (!this.classification) {
      return false;
    }
    return this.classification.toLowerCase() === tier.toLowerCase();
  }
}


class ClientIdentifier {
  /**
   * Initialize the unified client identifier
   * @param {Object} options - Configuration options
   * @param {string} options.apiKeyFile - Path to API key CSV file
   * @param {string} options.cidrFile - Path to CIDR ranges CSV file
   * @param {string} options.learnedIpsFile - Path to learned IPs CSV file
   * @param {string} options.allowlistFile - Path to IP allowlist CSV file
   * @param {string} options.blocklistFile - Path to IP blocklist CSV file
   */
  constructor(options = {}) {
    const apiKeyFile = options.apiKeyFile || 'clients.csv';
    const cidrFile = options.cidrFile || 'client_cidr.csv';
    const learnedIpsFile = options.learnedIpsFile || 'client_ips.csv';
    const allowlistFile = options.allowlistFile || 'ip_allowlist.csv';
    const blocklistFile = options.blocklistFile || 'ip_blocklist.csv';

    this.apiKeyManager = new APIKeyManager(apiKeyFile);
    this.ipManager = new IPManager(cidrFile, learnedIpsFile);
    this.ipAllowBlockManager = new IPAllowBlockManager(allowlistFile, blocklistFile);

    console.info(
      `ClientIdentifier initialized with ${this.apiKeyManager.getClientCount()} API key clients`
    );
  }

  /**
   * Identify client from Express request object
   * 
   * Workflow:
   * 1. Extract API key from X-API-Key header (REQUIRED)
   * 2. Validate API key to get client name and classification
   * 3. Extract client IP and check allowlist/blocklist status
   * 4. Process IP through IPManager for learning/tracking
   * 
   * Note: IP blocklist checking should be done at middleware level,
   * but we also check here for completeness and metadata
   * 
   * @param {Object} req - Express request object
   * @returns {ClientIdentity} Object containing identification results
   */
  identifyClient(req) {
    // Step 1: Extract API key (REQUIRED)
    const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];
    
    if (!apiKey) {
      return new ClientIdentity({
        valid: false,
        error: { message: 'API key is required. Please provide X-API-Key header.' }
      });
    }

    // Step 2: Validate API key
    const result = this.apiKeyManager.validateKey(apiKey);

    if (!result.valid) {
      return new ClientIdentity({
        valid: false,
        error: result.error
      });
    }

    // Step 3: Extract and check client IP
    const clientIP = this._extractClientIP(req);
    let ipStatus = { action: IPListAction.NONE, reason: 'Not checked' };
    
    if (clientIP) {
      // Check IP allowlist/blocklist status
      ipStatus = this.ipAllowBlockManager.checkIP(clientIP);
      
      // If IP is blocklisted, return error (though this should be caught by middleware)
      if (ipStatus.action === IPListAction.BLOCK) {
        return new ClientIdentity({
          valid: false,
          error: { 
            message: 'Access denied: IP address is blocklisted',
            ipAddress: clientIP
          }
        });
      }
      
      // Process IP through normal learning/tracking
      this.ipManager.processIP(result.clientName, clientIP);
    }

    // Return successful identification with IP list status
    return new ClientIdentity({
      valid: true,
      clientName: result.clientName,
      classification: result.classification,
      metadata: {
        clientIP: clientIP,
        ipListStatus: ipStatus.action,
        ipListReason: ipStatus.reason
      }
    });
  }

  /**
   * Extract client IP address from request
   * Handles proxy scenarios by checking X-Forwarded-For header
   * @private
   * @param {Object} req - Express request object
   * @returns {string} Client IP address
   */
  _extractClientIP(req) {
    // Check X-Forwarded-For header (for proxy/load balancer scenarios)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      // Take the first IP if multiple are present
      return forwardedFor.split(',')[0].trim();
    }

    // Fall back to direct connection IP
    return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
  }

  /**
   * Reload all client configurations from files
   */
  reloadAll() {
    this.apiKeyManager.reloadClients();
    this.ipManager.reloadAll();
    this.ipAllowBlockManager.reloadAll();
    console.info('All client configurations reloaded');
  }

  /**
   * Get statistics about registered clients and IPs
   * @returns {Object} Statistics
   */
  getStatistics() {
    const ipStats = this.ipManager.getStatistics();
    const ipListStats = this.ipAllowBlockManager.getStatistics();
    
    return {
      apiKeyClients: this.apiKeyManager.getClientCount(),
      cidr: ipStats.cidr,
      learnedIPs: ipStats.learned,
      ipLists: ipListStats
    };
  }
}

export default ClientIdentifier;
