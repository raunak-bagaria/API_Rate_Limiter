# Custom Error Messages

## Overview

The API Rate Limiter now supports configurable custom error messages for blocked and rate-limited responses. This feature allows API administrators to provide helpful, branded error messages to users with dynamic content based on the situation.

## Features

- **Configurable per Block Type**: Different messages for rate limits, IP blocklists, unauthorized access, and tier restrictions
- **Template Variables**: Dynamic variable substitution (e.g., `{{clientName}}`, `{{retryAfter}}`, `{{contactEmail}}`)
- **Default Messages**: Fallback to sensible defaults if custom messages are not configured
- **Hot Reload**: Update messages without restarting the service
- **Admin API**: Manage messages through REST endpoints

## Block Types

The system supports custom messages for four different block types:

1. **rate_limit** - When a client exceeds rate limits
2. **ip_blocklist** - When an IP address is on the blocklist
3. **unauthorized** - When API key is invalid or missing
4. **tier_restricted** - When a client tries to access a higher-tier endpoint

## Configuration File

Error messages are stored in `src/error_messages.csv`:

```csv
block_type,message_template,description
rate_limit,"Rate limit exceeded for {{limitingWindow}} window. You have made {{currentCount}} requests out of {{limit}} allowed. Please wait {{retryAfter}} seconds before retrying. Contact {{contactEmail}} for assistance.",Message displayed when a client exceeds rate limits
ip_blocklist,"Access denied. Your IP address ({{clientIP}}) has been blocked. If you believe this is an error, please contact {{contactEmail}}.",Message displayed when an IP is on the blocklist
unauthorized,"Unauthorized request. Invalid or missing API key. Please provide a valid X-API-Key header. Contact {{contactEmail}} for API access.",Message displayed when API key is invalid or missing
tier_restricted,"Access denied. This endpoint requires {{requiredTier}} tier or higher. Your current tier is {{yourTier}}. Contact {{contactEmail}} to upgrade your account.",Message displayed when a client tries to access a tier-restricted endpoint
```

## Template Variables

### Available Variables by Block Type

#### Rate Limit (`rate_limit`)
- `{{clientName}}` / `{{clientId}}` - Name/ID of the client
- `{{tier}}` - Client's subscription tier
- `{{limitingWindow}}` - Time window that exceeded the limit (second, minute, hour, day)
- `{{retryAfter}}` - Seconds to wait before retrying
- `{{currentCount}}` - Current number of requests in the window
- `{{limit}}` - Maximum allowed requests in the window
- `{{contactEmail}}` - Support contact email

#### IP Blocklist (`ip_blocklist`)
- `{{clientIP}}` - The blocked IP address
- `{{reason}}` - Reason for blocking
- `{{contactEmail}}` - Support contact email

#### Unauthorized (`unauthorized`)
- `{{reason}}` - Specific reason for unauthorized access
- `{{contactEmail}}` - Support contact email

#### Tier Restricted (`tier_restricted`)
- `{{clientName}}` / `{{clientId}}` - Name/ID of the client
- `{{yourTier}}` - Client's current tier
- `{{requiredTier}}` - Required tier for access
- `{{contactEmail}}` - Support contact email

### Global Variables
- `{{contactEmail}}` - Available in all messages, can be set globally or per-message

## Admin API Endpoints

### Get All Error Messages

```bash
GET /admin/error-messages
```

Returns all configured error messages and statistics.

**Response:**
```json
{
  "messages": {
    "rate_limit": "Rate limit exceeded for {{limitingWindow}} window...",
    "ip_blocklist": "Access denied. Your IP address...",
    "unauthorized": "Unauthorized request...",
    "tier_restricted": "Access denied. This endpoint requires..."
  },
  "statistics": {
    "totalMessages": 4,
    "contactEmail": "support@api-rate-limiter.com",
    "messagesFile": "/path/to/error_messages.csv",
    "blockTypes": ["rate_limit", "ip_blocklist", "unauthorized", "tier_restricted"]
  }
}
```

### Get Specific Error Message

```bash
GET /admin/error-messages/:blockType
```

Get the message template for a specific block type.

**Example:**
```bash
curl http://localhost:3000/admin/error-messages/rate_limit
```

**Response:**
```json
{
  "blockType": "rate_limit",
  "messageTemplate": "Rate limit exceeded for {{limitingWindow}} window. You have made {{currentCount}} requests out of {{limit}} allowed. Please wait {{retryAfter}} seconds before retrying. Contact {{contactEmail}} for assistance."
}
```

### Update Error Message

```bash
PUT /admin/error-messages/:blockType
Content-Type: application/json

{
  "messageTemplate": "Your custom message with {{variables}}"
}
```

Updates the message template for a specific block type.

**Example:**
```bash
curl -X PUT http://localhost:3000/admin/error-messages/rate_limit \
  -H "Content-Type: application/json" \
  -d '{
    "messageTemplate": "Whoa there! You have exceeded your rate limit. Please slow down and try again in {{retryAfter}} seconds. Questions? Email {{contactEmail}}"
  }'
```

**Response:**
```json
{
  "message": "Updated error message for block type: rate_limit",
  "blockType": "rate_limit",
  "messageTemplate": "Whoa there! You have exceeded your rate limit..."
}
```

### Reset to Default Message

```bash
POST /admin/error-messages/:blockType/reset
```

Resets the message template to its default value.

**Example:**
```bash
curl -X POST http://localhost:3000/admin/error-messages/rate_limit/reset
```

**Response:**
```json
{
  "message": "Reset error message to default for block type: rate_limit",
  "blockType": "rate_limit",
  "messageTemplate": "Rate limit exceeded for {{limitingWindow}} window..."
}
```

### Update Contact Email

```bash
PUT /admin/error-messages/contact-email
Content-Type: application/json

{
  "email": "support@yourcompany.com"
}
```

Updates the global contact email used in all error messages.

**Example:**
```bash
curl -X PUT http://localhost:3000/admin/error-messages/contact-email \
  -H "Content-Type: application/json" \
  -d '{"email": "api-support@example.com"}'
```

**Response:**
```json
{
  "message": "Contact email updated successfully",
  "contactEmail": "api-support@example.com"
}
```

### Reload All Configurations

```bash
POST /admin/reload
```

Reloads all configurations including error messages from disk.

## Example Error Responses

### Rate Limit Error (HTTP 429)

**Request:**
```bash
curl -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data
```

**Response:**
```json
{
  "error": {
    "message": "Rate limit exceeded for second window. You have made 10 requests out of 10 allowed. Please wait 1 seconds before retrying. Contact support@api-rate-limiter.com for assistance.",
    "limitingWindow": "second",
    "retryAfter": 1,
    "windows": {
      "second": {
        "allowed": false,
        "currentCount": 10,
        "limit": 10,
        "remainingRequests": 0
      },
      ...
    }
  }
}
```

### IP Blocklist Error (HTTP 403)

**Request:**
```bash
curl -H "X-API-Key: 12345-ABCDE" \
     -H "X-Forwarded-For: 192.168.1.100" \
     http://localhost:3000/data
```

**Response:**
```json
{
  "error": {
    "message": "Access denied. Your IP address (192.168.1.100) has been blocked. If you believe this is an error, please contact support@api-rate-limiter.com.",
    "reason": "IP address is blocklisted",
    "clientIP": "192.168.1.100"
  }
}
```

### Unauthorized Error (HTTP 401)

**Request:**
```bash
curl http://localhost:3000/data
```

**Response:**
```json
{
  "valid": false,
  "error": {
    "code": "MISSING_API_KEY",
    "message": "Unauthorized request. Invalid or missing API key. Please provide a valid X-API-Key header. Contact support@api-rate-limiter.com for API access."
  },
  ...
}
```

### Tier Restricted Error (HTTP 403)

**Request:**
```bash
curl -H "X-API-Key: 12345-ABCDE" http://localhost:3000/premium-only
```

**Response:**
```json
{
  "error": {
    "message": "Access denied. This endpoint requires premium or higher tier or higher. Your current tier is free. Contact support@api-rate-limiter.com to upgrade your account.",
    "yourTier": "free",
    "requiredTier": "premium or higher"
  }
}
```

## Best Practices

### 1. Use Clear, Actionable Messages

Good:
```
"Rate limit exceeded. Please wait {{retryAfter}} seconds before retrying."
```

Bad:
```
"Error 429"
```

### 2. Include Contact Information

Always include `{{contactEmail}}` so users know how to get help:
```
"If this persists, contact {{contactEmail}} for assistance."
```

### 3. Be Specific About the Problem

Tell users exactly what went wrong:
```
"You have made {{currentCount}} requests out of {{limit}} allowed in the {{limitingWindow}} window."
```

### 4. Provide Next Steps

Tell users what to do:
```
"Please wait {{retryAfter}} seconds before retrying."
"Contact {{contactEmail}} to upgrade your account."
```

### 5. Test Your Messages

After updating messages, test them with:
```bash
# Get a rate limit error
for i in {1..15}; do curl -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data; done

# Get an unauthorized error
curl http://localhost:3000/data

# Get a tier restriction error
curl -H "X-API-Key: 12345-ABCDE" http://localhost:3000/premium-only
```

## Template Syntax

### Variable Syntax
Use double curly braces: `{{variableName}}`

### Multiple Occurrences
Variables can be used multiple times in a message:
```
"Client {{clientName}} has exceeded the limit. Contact {{clientName}}'s administrator."
```

### Optional Variables
Variables that are not provided will be replaced with empty strings, so design your messages to handle missing data gracefully.

### Special Characters
Messages can include special characters, punctuation, and line breaks:
```
"Error! You've hit your limit.\nPlease wait {{retryAfter}} seconds."
```

## Hot Reload

Error messages support hot reload. You can:

1. **Edit the CSV file directly** and call the reload endpoint
2. **Use the admin API** to update messages (automatically saved to CSV)

**Manual file edit + reload:**
```bash
# Edit src/error_messages.csv
vim src/error_messages.csv

# Reload
curl -X POST http://localhost:3000/admin/reload
```

**API update (automatic save):**
```bash
curl -X PUT http://localhost:3000/admin/error-messages/rate_limit \
  -H "Content-Type: application/json" \
  -d '{"messageTemplate": "New message here"}'
```

## Troubleshooting

### Messages Not Updating

1. Check that the CSV file has correct syntax
2. Verify the reload was successful: `POST /admin/reload`
3. Check server logs for errors

### Variables Not Being Replaced

1. Verify variable name matches exactly (case-sensitive)
2. Check that the variable is available for that block type
3. Ensure variables use double curly braces: `{{variable}}`

### File Permission Errors

The application needs read/write access to `src/error_messages.csv`:
```bash
chmod 666 src/error_messages.csv
```

## Development

### Adding New Block Types

1. Add the block type to `BlockType` enum in `errorMessageManager.js`
2. Add default message in `DEFAULT_MESSAGES`
3. Create a getter method (e.g., `getNewBlockTypeMessage()`)
4. Update the CSV file with the new block type
5. Add tests for the new block type

### Adding New Template Variables

1. Update the getter method to accept new variables in context
2. Document the new variables in this file
3. Update default message templates to use new variables (optional)
4. Add tests for new variable substitution

## Security Considerations

- Error messages should not reveal sensitive system information
- Avoid exposing internal IPs, server names, or file paths
- Sanitize user-provided data in messages
- Be careful with rate limit details in public-facing APIs
- Consider what information you expose to different client tiers

## Performance

- Error messages are loaded from CSV at startup
- Messages are cached in memory (Map data structure)
- Template variable substitution is performed on each error response
- Minimal performance impact (< 1ms per message generation)
- CSV updates are debounced and atomic

## Related Documentation

- [Rate Limiter Documentation](RATE_LIMITER.md)
- [API Documentation](api.md) 
- [User Guide](user-guide.md)
