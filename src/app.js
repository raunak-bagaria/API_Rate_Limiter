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

// Initialize unified client identifier
const clientIdentifier = new ClientIdentifier();

/**
 * Main data endpoint
 * Requires API key in X-API-Key header
 */
app.get('/data', (req, res) => {
  const identity = clientIdentifier.identifyClient(req);

  if (!identity.valid) {
    console.log(`Unauthorized request from ${req.ip}: ${identity.error.message}`);
    return res.status(401).json(identity.toJSON());
  }

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
 */
app.get('/tier-info', (req, res) => {
  const identity = clientIdentifier.identifyClient(req);

  if (!identity.valid) {
    return res.status(401).json(identity.toJSON());
  }

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
 */
app.get('/premium-only', (req, res) => {
  const identity = clientIdentifier.identifyClient(req);

  if (!identity.valid) {
    return res.status(401).json(identity.toJSON());
  }

  if (!(identity.isTier(ClientTier.PREMIUM) || identity.isTier(ClientTier.ENTERPRISE))) {
    console.log(
      `Access denied to premium endpoint for ${identity.clientName} ` +
      `(tier: ${identity.classification})`
    );
    return res.status(403).json({
      error: {
        message: 'This endpoint requires premium or enterprise tier',
        yourTier: identity.classification,
        requiredTier: 'premium or higher'
      }
    });
  }

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
    const stats = clientIdentifier.getStatistics();

    console.log('✓ Configurations reloaded successfully');
    res.json({
      message: 'Configurations reloaded successfully',
      statistics: stats
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
    res.json(stats);
  } catch (error) {
    console.error(`Error retrieving stats: ${error.message}`);
    res.status(500).json({
      error: { message: `Failed to retrieve stats: ${error.message}` }
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
  console.log('='.repeat(60));
  console.log('API Rate Limiter Starting');
  console.log(`API Key Clients: ${stats.apiKeyClients}`);
  console.log(`CIDR Ranges: ${stats.cidr.totalRanges} (${stats.cidr.totalRequests} requests)`);
  console.log(`Learned IPs: ${stats.learnedIPs.totalIPs} (${stats.learnedIPs.totalRequests} requests)`);
  console.log(`Server running on port ${PORT}`);
  console.log('='.repeat(60));
});

export default app;