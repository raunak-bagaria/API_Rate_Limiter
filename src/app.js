/**
 * API Rate Limiter Application - Client Identification System
 * 
 * This application implements client identification with the following workflow:
 * 1. API key is REQUIRED (extracted from X-API-Key header)
 * 2. API key is validated to identify client and get classification
 * 3. Client IP is extracted and processed:
 *    - Check if IP is in preconfigured CIDR range (client_cidr.csv)
 *    - If not in CIDR, check/update learned IPs (client_ips.csv)
 * 
 * IMPORTANT NOTES:
 * - API key is mandatory - requests without it will be rejected
 * - IP processing is automatic and transparent to the client
 * - All CSV files are updated automatically
 * 
 * TESTING:
 * - Use test API keys from clients.csv (e.g., 12345-ABCDE for Client A)
 * - Send requests with X-API-Key header
 * - Check console logs to see IP processing in action
 */

import express from 'express';
import ClientIdentifier, { ClientTier } from './clientIdentifier.js';
import IPAllowBlockManager, { IPListAction } from './ipAllowBlockManager.js';
import RateLimiter from './rateLimiter.js';
import ErrorMessageManager, { BlockType } from './errorMessageManager.js';
import RateLimitHeaderManager from './rateLimitHeaderManager.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log(`Headers: X-API-Key=${req.headers['x-api-key'] ? '***' : 'missing'}, IP=${req.ip}`);
  next();
});

// Extract client IP helper function
function extractClientIP(req) {
  // Check X-Forwarded-For header (for proxy/load balancer scenarios)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // Take the first IP if multiple are present
    return forwardedFor.split(',')[0].trim();
  }

  // Fall back to direct connection IP
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
}

// IP allowlist/blocklist middleware - runs before all other endpoints
app.use((req, res, next) => {
  const clientIP = extractClientIP(req);
  const ipCheck = ipAllowBlockManager.checkIP(clientIP);
  
  console.log(`IP Check for ${clientIP}: ${ipCheck.action} - ${ipCheck.reason}`);
  
  if (ipCheck.action === IPListAction.BLOCK) {
    console.log(`🚫 Blocked request from ${clientIP}: ${ipCheck.reason}`);
    
    // Get custom error message
    const errorMessage = errorMessageManager.getIPBlocklistMessage({
      clientIP: clientIP,
      reason: ipCheck.reason
    });
    
    return res.status(403).json({
      error: {
        message: errorMessage,
        reason: ipCheck.reason,
        clientIP: clientIP
      }
    });
  }
  
  // For allowlisted IPs, log the special status but continue processing
  if (ipCheck.action === IPListAction.ALLOW) {
    console.log(`✅ Allowlisted IP ${clientIP} - processing according to rules`);
  }
  
  next();
});

// Initialize unified client identifier, IP allow/block manager, rate limiter, error message manager, and policy manager
const clientIdentifier = new ClientIdentifier();
const ipAllowBlockManager = new IPAllowBlockManager();
const rateLimiter = new RateLimiter();
const errorMessageManager = new ErrorMessageManager();
const rateLimitHeaderManager = new RateLimitHeaderManager();

// Import and initialize rate limit policy manager (for future use)
import RateLimitPolicyManager from './rateLimitPolicyManager.js';
const policyManager = new RateLimitPolicyManager();

console.info('Rate limit policy manager initialized with hot-reload enabled');

/**
 * Main data endpoint
 * Requires API key in X-API-Key header
 * Enforces rate limits per client
 */
app.get('/data', (req, res) => {
  const identity = clientIdentifier.identifyClient(req);

  if (!identity.valid) {
    console.log(`Unauthorized request from ${req.ip}: ${identity.error.message}`);
    
    // Get custom unauthorized error message
    const errorMessage = errorMessageManager.getUnauthorizedMessage({
      reason: identity.error.message
    });
    
    return res.status(401).json({
      ...identity.toJSON(),
      error: {
        ...identity.error,
        message: errorMessage
      }
    });
  }

  // Check rate limits
  const rateLimitResult = rateLimiter.checkRequest(identity.clientName, identity.classification);

  if (!rateLimitResult.allowed) {
    console.log(
      `⚠️  Rate limit exceeded for ${identity.clientName} (${identity.classification}) - ` +
      `${rateLimitResult.limitingWindow} window`
    );
    
    // Get custom rate limit error message
    const limitingWindowData = rateLimitResult.windows[rateLimitResult.limitingWindow];
    const errorMessage = errorMessageManager.getRateLimitMessage({
      clientName: identity.clientName,
      tier: identity.classification,
      limitingWindow: rateLimitResult.limitingWindow,
      retryAfter: rateLimitResult.retryAfter,
      currentCount: limitingWindowData?.currentCount || 0,
      limit: limitingWindowData?.limit || 0
    });
    
    res.set('Retry-After', rateLimitResult.retryAfter.toString());
    // Prepare rate limit info for headers
    const rateLimitInfo = {
      limit: rateLimitResult.windows[rateLimitResult.limitingWindow]?.limit || 0,
      remaining: 0,
      resetTime: Date.now() + (rateLimitResult.retryAfter * 1000),
      windowSeconds: rateLimitResult.windows[rateLimitResult.limitingWindow]?.windowSeconds || 60
    };
    
    // Apply rate limit headers for 429 response
    rateLimitHeaderManager.applyRateLimitedHeaders(res, rateLimitInfo);
    
    return res.status(429).json({
      error: {
        message: errorMessage,
        limitingWindow: rateLimitResult.limitingWindow,
        retryAfter: rateLimitResult.retryAfter,
        windows: rateLimitResult.windows
      }
    });
  }

  // Record the request
  rateLimiter.recordRequest(identity.clientName, identity.classification);

  // Get current rate limit status for headers
  const rateLimitStatus = rateLimiter.checkRequest(identity.clientName, identity.classification);
  const rateLimitInfo = {
    limit: rateLimitStatus.windows.second?.limit || 0,
    remaining: Math.max(0, (rateLimitStatus.windows.second?.limit || 0) - (rateLimitStatus.windows.second?.used || 0)),
    resetTime: Date.now() + 60000,
    windowSeconds: 60
  };
  
  // Apply rate limit headers
  rateLimitHeaderManager.applyHeaders(res, rateLimitInfo, false);

  console.log(
    `✓ Request from ${identity.clientName} (${identity.classification}) ` +
    `IP: ${identity.metadata.clientIP}`
  );

  res.json({
    message: `Welcome ${identity.clientName}`,
    classification: identity.classification,
    clientIP: identity.metadata.clientIP
  });
});

/**
 * Tier-based information endpoint
 * Returns features available based on client tier
 * Enforces rate limits per client
 */
app.get('/tier-info', (req, res) => {
  const identity = clientIdentifier.identifyClient(req);

  if (!identity.valid) {
    // Get custom unauthorized error message
    const errorMessage = errorMessageManager.getUnauthorizedMessage({
      reason: identity.error.message
    });
    
    return res.status(401).json({
      ...identity.toJSON(),
      error: {
        ...identity.error,
        message: errorMessage
      }
    });
  }

  // Check rate limits
  const rateLimitResult = rateLimiter.checkRequest(identity.clientName, identity.classification);

  if (!rateLimitResult.allowed) {
    console.log(
      `⚠️  Rate limit exceeded for ${identity.clientName} (${identity.classification}) - ` +
      `${rateLimitResult.limitingWindow} window`
    );
    
    // Get custom rate limit error message
    const limitingWindowData = rateLimitResult.windows[rateLimitResult.limitingWindow];
    const errorMessage = errorMessageManager.getRateLimitMessage({
      clientName: identity.clientName,
      tier: identity.classification,
      limitingWindow: rateLimitResult.limitingWindow,
      retryAfter: rateLimitResult.retryAfter,
      currentCount: limitingWindowData?.currentCount || 0,
      limit: limitingWindowData?.limit || 0
    });
    
    res.set('Retry-After', rateLimitResult.retryAfter.toString());
    // Prepare rate limit info for headers
    const rateLimitInfo = {
      limit: rateLimitResult.windows[rateLimitResult.limitingWindow]?.limit || 0,
      remaining: 0,
      resetTime: Date.now() + (rateLimitResult.retryAfter * 1000),
      windowSeconds: rateLimitResult.windows[rateLimitResult.limitingWindow]?.windowSeconds || 60
    };
    
    // Apply rate limit headers for 429 response
    rateLimitHeaderManager.applyRateLimitedHeaders(res, rateLimitInfo);
    
    return res.status(429).json({
      error: {
        message: errorMessage,
        limitingWindow: rateLimitResult.limitingWindow,
        retryAfter: rateLimitResult.retryAfter,
        windows: rateLimitResult.windows
      }
    });
  }

  // Record the request
  rateLimiter.recordRequest(identity.clientName, identity.classification);

  // Get current rate limit status for headers
  const rateLimitStatus = rateLimiter.checkRequest(identity.clientName, identity.classification);
  const rateLimitInfo = {
    limit: rateLimitStatus.windows.second?.limit || 0,
    remaining: Math.max(0, (rateLimitStatus.windows.second?.limit || 0) - (rateLimitStatus.windows.second?.used || 0)),
    resetTime: Date.now() + 60000,
    windowSeconds: 60
  };
  
  // Apply rate limit headers
  rateLimitHeaderManager.applyHeaders(res, rateLimitInfo, false);

  const tierInfo = {
    clientName: identity.clientName,
    tier: identity.classification,
    features: []
  };

  // Add features based on tier
  if (identity.isTier(ClientTier.FREE)) {
    tierInfo.features = ['basic_api', 'limited_requests'];
  } else if (identity.isTier(ClientTier.BASIC)) {
    tierInfo.features = ['basic_api', 'standard_requests', 'email_support'];
  } else if (identity.isTier(ClientTier.STANDARD)) {
    tierInfo.features = ['full_api', 'standard_requests', 'priority_support'];
  } else if (identity.isTier(ClientTier.PREMIUM)) {
    tierInfo.features = ['full_api', 'high_requests', 'priority_support', 'analytics'];
  } else if (identity.isTier(ClientTier.ENTERPRISE)) {
    tierInfo.features = ['full_api', 'unlimited_requests', 'dedicated_support', 'analytics', 'custom_features'];
  }

  console.log(`Tier info request: ${identity.clientName} (${identity.classification})`);
  res.json(tierInfo);
});

/**
 * Premium-only endpoint
 * Requires premium or enterprise tier
 * Enforces rate limits per client
 */
app.get('/premium-only', (req, res) => {
  const identity = clientIdentifier.identifyClient(req);

  if (!identity.valid) {
    // Get custom unauthorized error message
    const errorMessage = errorMessageManager.getUnauthorizedMessage({
      reason: identity.error.message
    });
    
    return res.status(401).json({
      ...identity.toJSON(),
      error: {
        ...identity.error,
        message: errorMessage
      }
    });
  }

  if (!(identity.isTier(ClientTier.PREMIUM) || identity.isTier(ClientTier.ENTERPRISE))) {
    console.log(
      `Access denied to premium endpoint for ${identity.clientName} ` +
      `(tier: ${identity.classification})`
    );
    
    // Get custom tier-restricted error message
    const errorMessage = errorMessageManager.getTierRestrictedMessage({
      clientName: identity.clientName,
      yourTier: identity.classification,
      requiredTier: 'premium or higher'
    });
    
    return res.status(403).json({
      error: {
        message: errorMessage,
        yourTier: identity.classification,
        requiredTier: 'premium or higher'
      }
    });
  }

  // Check rate limits
  const rateLimitResult = rateLimiter.checkRequest(identity.clientName, identity.classification);

  if (!rateLimitResult.allowed) {
    console.log(
      `⚠️  Rate limit exceeded for ${identity.clientName} (${identity.classification}) - ` +
      `${rateLimitResult.limitingWindow} window`
    );
    
    // Get custom rate limit error message
    const limitingWindowData = rateLimitResult.windows[rateLimitResult.limitingWindow];
    const errorMessage = errorMessageManager.getRateLimitMessage({
      clientName: identity.clientName,
      tier: identity.classification,
      limitingWindow: rateLimitResult.limitingWindow,
      retryAfter: rateLimitResult.retryAfter,
      currentCount: limitingWindowData?.currentCount || 0,
      limit: limitingWindowData?.limit || 0
    });
    
    res.set('Retry-After', rateLimitResult.retryAfter.toString());
    // Prepare rate limit info for headers
    const rateLimitInfo = {
      limit: rateLimitResult.windows[rateLimitResult.limitingWindow]?.limit || 0,
      remaining: 0,
      resetTime: Date.now() + (rateLimitResult.retryAfter * 1000),
      windowSeconds: rateLimitResult.windows[rateLimitResult.limitingWindow]?.windowSeconds || 60
    };
    
    // Apply rate limit headers for 429 response
    rateLimitHeaderManager.applyRateLimitedHeaders(res, rateLimitInfo);
    
    return res.status(429).json({
      error: {
        message: errorMessage,
        limitingWindow: rateLimitResult.limitingWindow,
        retryAfter: rateLimitResult.retryAfter,
        windows: rateLimitResult.windows
      }
    });
  }

  // Record the request
  rateLimiter.recordRequest(identity.clientName, identity.classification);

  // Get current rate limit status for headers
  const rateLimitStatus = rateLimiter.checkRequest(identity.clientName, identity.classification);
  const rateLimitInfo = {
    limit: rateLimitStatus.windows.second?.limit || 0,
    remaining: Math.max(0, (rateLimitStatus.windows.second?.limit || 0) - (rateLimitStatus.windows.second?.used || 0)),
    resetTime: Date.now() + 60000,
    windowSeconds: 60
  };
  
  // Apply rate limit headers
  rateLimitHeaderManager.applyHeaders(res, rateLimitInfo, false);

  console.log(`Premium endpoint accessed by ${identity.clientName}`);
  res.json({
    message: 'Welcome to premium features',
    data: 'premium content here',
    client: identity.clientName
  });
});

/**
 * Admin endpoint to reload configurations
 * In production, protect this with admin authentication
 */
app.post('/admin/reload', (req, res) => {
  try {
    clientIdentifier.reloadAll();
    ipAllowBlockManager.reloadAll();
    errorMessageManager.reload();
    const stats = clientIdentifier.getStatistics();
    const ipListStats = ipAllowBlockManager.getStatistics();
    const errorMessageStats = errorMessageManager.getStatistics();

    console.log('✓ Configurations reloaded successfully');
    res.json({
      message: 'Configurations reloaded successfully',
      statistics: stats,
      ipLists: ipListStats,
      errorMessages: errorMessageStats
    });
  } catch (error) {
    console.error(`Error reloading: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to reload: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get statistics
 * In production, protect this with admin authentication
 */
app.get('/admin/stats', (req, res) => {
  try {
    const stats = clientIdentifier.getStatistics();
    const ipListStats = ipAllowBlockManager.getStatistics();
    const rateLimitStats = rateLimiter.getAllStatistics();
    res.json({
      ...stats,
      ipLists: ipListStats,
      rateLimits: rateLimitStats
    });
  } catch (error) {
    console.error(`Error retrieving stats: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve stats: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to add IP to allowlist
 * In production, protect this with admin authentication
 */
app.post('/admin/allowlist/add', (req, res) => {
  try {
    const { ip_or_cidr, description } = req.body;
    
    if (!ip_or_cidr) {
      return res.status(400).json({
        error: { message: 'ip_or_cidr is required' }
      });
    }
    
    const success = ipAllowBlockManager.addToAllowlist(ip_or_cidr, description || '');
    
    if (success) {
      res.json({
        message: `Added ${ip_or_cidr} to allowlist`,
        ip_or_cidr: ip_or_cidr,
        description: description
      });
    } else {
      res.status(400).json({
        error: { message: `Failed to add ${ip_or_cidr} to allowlist` }
      });
    }
  } catch (error) {
    console.error(`Error adding to allowlist: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to add to allowlist: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to add IP to blocklist
 * In production, protect this with admin authentication
 */
app.post('/admin/blocklist/add', (req, res) => {
  try {
    const { ip_or_cidr, description } = req.body;
    
    if (!ip_or_cidr) {
      return res.status(400).json({
        error: { message: 'ip_or_cidr is required' }
      });
    }
    
    const success = ipAllowBlockManager.addToBlocklist(ip_or_cidr, description || '');
    
    if (success) {
      res.json({
        message: `Added ${ip_or_cidr} to blocklist`,
        ip_or_cidr: ip_or_cidr,
        description: description
      });
    } else {
      res.status(400).json({
        error: { message: `Failed to add ${ip_or_cidr} to blocklist` }
      });
    }
  } catch (error) {
    console.error(`Error adding to blocklist: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to add to blocklist: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to remove IP from allowlist
 * In production, protect this with admin authentication
 */
app.delete('/admin/allowlist/remove', (req, res) => {
  try {
    const { ip_or_cidr } = req.body;
    
    if (!ip_or_cidr) {
      return res.status(400).json({
        error: { message: 'ip_or_cidr is required' }
      });
    }
    
    const success = ipAllowBlockManager.removeFromAllowlist(ip_or_cidr);
    
    if (success) {
      res.json({
        message: `Removed ${ip_or_cidr} from allowlist`,
        ip_or_cidr: ip_or_cidr
      });
    } else {
      res.status(404).json({
        error: { message: `${ip_or_cidr} not found in allowlist` }
      });
    }
  } catch (error) {
    console.error(`Error removing from allowlist: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to remove from allowlist: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to remove IP from blocklist
 * In production, protect this with admin authentication
 */
app.delete('/admin/blocklist/remove', (req, res) => {
  try {
    const { ip_or_cidr } = req.body;
    
    if (!ip_or_cidr) {
      return res.status(400).json({
        error: { message: 'ip_or_cidr is required' }
      });
    }
    
    const success = ipAllowBlockManager.removeFromBlocklist(ip_or_cidr);
    
    if (success) {
      res.json({
        message: `Removed ${ip_or_cidr} from blocklist`,
        ip_or_cidr: ip_or_cidr
      });
    } else {
      res.status(404).json({
        error: { message: `${ip_or_cidr} not found in blocklist` }
      });
    }
  } catch (error) {
    console.error(`Error removing from blocklist: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to remove from blocklist: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get rate limit statistics for a specific client
 * In production, protect this with admin authentication
 */
app.get('/admin/rate-limits/:clientName', (req, res) => {
  try {
    const { clientName } = req.params;
    const stats = rateLimiter.getClientStatistics(clientName);
    
    if (!stats) {
      return res.status(404).json({
        error: { message: `No rate limit data found for client: ${clientName}` }
      });
    }
    
    res.json(stats);
  } catch (error) {
    console.error(`Error retrieving rate limit stats: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve rate limit stats: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to reset rate limits for a specific client
 * In production, protect this with admin authentication
 */
app.post('/admin/rate-limits/:clientName/reset', (req, res) => {
  try {
    const { clientName } = req.params;
    rateLimiter.resetClient(clientName);
    
    res.json({
      message: `Rate limits reset for client: ${clientName}`,
      clientName: clientName
    });
  } catch (error) {
    console.error(`Error resetting rate limits: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to reset rate limits: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to update rate limits for a tier
 * In production, protect this with admin authentication
 */
app.put('/admin/rate-limits/tier/:tier', (req, res) => {
  try {
    const { tier } = req.params;
    const { second, minute, hour, day } = req.body;
    
    if (!second && !minute && !hour && !day) {
      return res.status(400).json({
        error: { message: 'At least one time window limit is required (second, minute, hour, day)' }
      });
    }
    
    const limits = {};
    if (second !== undefined) limits.second = parseInt(second);
    if (minute !== undefined) limits.minute = parseInt(minute);
    if (hour !== undefined) limits.hour = parseInt(hour);
    if (day !== undefined) limits.day = parseInt(day);
    
    const success = rateLimiter.updateTierLimits(tier, limits);
    
    if (success) {
      const updatedLimits = rateLimiter.getTierLimits(tier);
      res.json({
        message: `Updated rate limits for tier: ${tier}`,
        tier: tier,
        limits: updatedLimits
      });
    } else {
      res.status(404).json({
        error: { message: `Unknown tier: ${tier}` }
      });
    }
  } catch (error) {
    console.error(`Error updating tier limits: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to update tier limits: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get rate limits for a tier
 * In production, protect this with admin authentication
 */
app.get('/admin/rate-limits/tier/:tier', (req, res) => {
  try {
    const { tier } = req.params;
    const limits = rateLimiter.getTierLimits(tier);
    
    if (!limits) {
      return res.status(404).json({
        error: { message: `Unknown tier: ${tier}` }
      });
    }
    
    res.json({
      tier: tier,
      limits: limits
    });
  } catch (error) {
    console.error(`Error retrieving tier limits: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve tier limits: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get rate limits for a tier
 * In production, protect this with admin authentication
 */
app.get('/admin/rate-limits/tier/:tier', (req, res) => {
  try {
    const { tier } = req.params;
    const limits = rateLimiter.getTierLimits(tier);
    
    if (!limits) {
      return res.status(404).json({
        error: { message: `Unknown tier: ${tier}` }
      });
    }
    
    res.json({
      tier: tier,
      limits: limits
    });
  } catch (error) {
    console.error(`Error retrieving tier limits: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve tier limits: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to manually trigger policy reload
 * In production, protect this with admin authentication
 */
app.post('/admin/policies/reload', async (req, res) => {
  try {
    const result = await policyManager.triggerReload();
    
    if (result.success) {
      res.json({
        message: 'Policies reloaded successfully',
        version: result.version,
        entriesCount: result.entriesCount,
        warnings: result.warnings || []
      });
    } else {
      res.status(400).json({
        error: {
          message: 'Policy reload failed',
          errors: result.errors || [],
          warnings: result.warnings || []
        }
      });
    }
  } catch (error) {
    console.error(`Error triggering policy reload: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to trigger reload: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to rollback to previous policy configuration
 * In production, protect this with admin authentication
 */
app.post('/admin/policies/rollback', async (req, res) => {
  try {
    const { version } = req.body;
    const result = await policyManager.rollback(version || null);
    
    if (result.success) {
      res.json({
        message: 'Policies rolled back successfully',
        version: result.version,
        entriesCount: result.entriesCount
      });
    } else {
      res.status(400).json({
        error: {
          message: 'Rollback failed',
          reason: result.error
        }
      });
    }
  } catch (error) {
    console.error(`Error during rollback: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to rollback: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get current policy version
 * In production, protect this with admin authentication
 */
app.get('/admin/policies/version', (req, res) => {
  try {
    const version = policyManager.getCurrentVersion();
    
    if (!version) {
      return res.status(404).json({
        error: { message: 'No version information available' }
      });
    }
    
    res.json(version);
  } catch (error) {
    console.error(`Error retrieving version: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve version: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get policy version history
 * In production, protect this with admin authentication
 */
app.get('/admin/policies/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const history = policyManager.getVersionHistory(limit);
    
    res.json({
      totalVersions: history.length,
      versions: history
    });
  } catch (error) {
    console.error(`Error retrieving history: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve history: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to validate policies without applying
 * In production, protect this with admin authentication
 */
app.post('/admin/policies/validate', (req, res) => {
  try {
    const { policies } = req.body;
    
    if (!policies || !Array.isArray(policies)) {
      return res.status(400).json({
        error: { message: 'policies array is required in request body' }
      });
    }
    
    const validation = policyManager.validatePolicies(policies);
    
    res.json({
      valid: validation.valid,
      errors: validation.errors || [],
      warnings: validation.warnings || []
    });
  } catch (error) {
    console.error(`Error validating policies: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to validate policies: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get all policies
 * In production, protect this with admin authentication
 */
app.get('/admin/policies', (req, res) => {
  try {
    const policies = policyManager.getAllPolicies();
    const version = policyManager.getCurrentVersion();
    
    res.json({
      version: version,
      totalPolicies: policies.length,
      policies: policies
    });
  } catch (error) {
    console.error(`Error retrieving policies: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve policies: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get hot-reload statistics
 * In production, protect this with admin authentication
 */
app.get('/admin/policies/stats', (req, res) => {
  try {
    const stats = policyManager.getHotReloadStats();
    
    if (!stats) {
      return res.status(404).json({
        error: { message: 'Hot-reload not enabled' }
      });
    }
    
    res.json(stats);
  } catch (error) {
    console.error(`Error retrieving hot-reload stats: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve stats: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get all error messages
 * In production, protect this with admin authentication
 */
app.get('/admin/error-messages', (req, res) => {
  try {
    const messages = errorMessageManager.getAllMessages();
    const stats = errorMessageManager.getStatistics();
    
    res.json({
      messages: messages,
      statistics: stats
    });
  } catch (error) {
    console.error(`Error retrieving error messages: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve error messages: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to get a specific error message
 * In production, protect this with admin authentication
 */
app.get('/admin/error-messages/:blockType', (req, res) => {
  try {
    const { blockType } = req.params;
    const messageTemplate = errorMessageManager.getMessageTemplate(blockType);
    
    if (!messageTemplate) {
      return res.status(404).json({
        error: { message: `No message template found for block type: ${blockType}` }
      });
    }
    
    res.json({
      blockType: blockType,
      messageTemplate: messageTemplate
    });
  } catch (error) {
    console.error(`Error retrieving error message: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve error message: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to update an error message
 * In production, protect this with admin authentication
 */
app.put('/admin/error-messages/:blockType', (req, res) => {
  try {
    const { blockType } = req.params;
    const { messageTemplate } = req.body;
    
    if (!messageTemplate) {
      return res.status(400).json({
        error: { message: 'messageTemplate is required in request body' }
      });
    }
    
    const success = errorMessageManager.updateMessage(blockType, messageTemplate);
    
    if (success) {
      res.json({
        message: `Updated error message for block type: ${blockType}`,
        blockType: blockType,
        messageTemplate: messageTemplate
      });
    } else {
      res.status(400).json({
        error: { message: `Failed to update error message for block type: ${blockType}` }
      });
    }
  } catch (error) {
    console.error(`Error updating error message: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to update error message: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to reset an error message to default
 * In production, protect this with admin authentication
 */
app.post('/admin/error-messages/:blockType/reset', (req, res) => {
  try {
    const { blockType } = req.params;
    const success = errorMessageManager.resetToDefault(blockType);
    
    if (success) {
      const messageTemplate = errorMessageManager.getMessageTemplate(blockType);
      res.json({
        message: `Reset error message to default for block type: ${blockType}`,
        blockType: blockType,
        messageTemplate: messageTemplate
      });
    } else {
      res.status(404).json({
        error: { message: `Unknown block type: ${blockType}` }
      });
    }
  } catch (error) {
    console.error(`Error resetting error message: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to reset error message: ${error.message}` }
    });
  }
});

/**
 * Admin endpoint to update contact email
 * In production, protect this with admin authentication
 */
app.put('/admin/error-messages/contact-email', (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        error: { message: 'email is required in request body' }
      });
    }
    
    errorMessageManager.setContactEmail(email);
    
    res.json({
      message: 'Contact email updated successfully',
      contactEmail: email
    });
  } catch (error) {
    console.error(`Error updating contact email: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to update contact email: ${error.message}` }
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api_rate_limiter'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`Unhandled error: ${err.message}`);
  res.status(500).json({
    error: { message: 'Internal server error' }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: { message: 'Endpoint not found' }
  });
});

// Start server
app.listen(PORT, () => {
  const stats = clientIdentifier.getStatistics();
  const ipListStats = ipAllowBlockManager.getStatistics();
  console.log('='.repeat(60));
  console.log('API Rate Limiter Starting');
  console.log(`API Key Clients: ${stats.apiKeyClients}`);
  console.log(`CIDR Ranges: ${stats.cidr.totalRanges} (${stats.cidr.totalRequests} requests)`);
  console.log(`Learned IPs: ${stats.learnedIPs.totalIPs} (${stats.learnedIPs.totalRequests} requests)`);
  console.log(`IP Allowlist: ${ipListStats.allowlist.totalEntries} entries (${ipListStats.allowlist.totalRequests} requests)`);
  console.log(`IP Blocklist: ${ipListStats.blocklist.totalEntries} entries (${ipListStats.blocklist.totalRequests} requests)`);
  console.log(`Server running on port ${PORT}`);
  console.log('='.repeat(60));
});

export default app;