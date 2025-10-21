# Rate Limiter Implementation

## Overview

The Rate Limiter enforces request limits per client across multiple time windows (second, minute, hour, day). It returns HTTP 429 responses when limits are exceeded and includes appropriate retry-after headers.

## Features

**Multiple Time Windows**: Enforces limits across second, minute, hour, and day windows simultaneously
**Per-Client Limiting**: Rate limits are tracked independently per client
**Tier-Based Limits**: Different rate limits for different client tiers (free, basic, standard, premium, enterprise)
**HTTP 429 Responses**: Returns proper HTTP 429 status when any limit is exceeded
**Retry-After Header**: Includes retry-after time in both header and response body
**Concurrent Window Management**: All windows are properly managed simultaneously
**Automatic Cleanup**: Inactive clients are automatically cleaned up to prevent memory leaks
**Configurable Limits**: Limits can be updated per tier without restart

## Default Rate Limits by Tier

| Tier       | Per Second | Per Minute | Per Hour  | Per Day   |
|------------|------------|------------|-----------|-----------|
| Free       | 1          | 10         | 100       | 1,000     |
| Basic      | 5          | 50         | 500       | 5,000     |
| Standard   | 10         | 100        | 1,000     | 10,000    |
| Premium    | 50         | 500        | 5,000     | 50,000    |
| Enterprise | 100        | 1,000      | 10,000    | 100,000   |

## Architecture

### Components

1. **RateLimiter** - Main class managing all clients and tier configurations
2. **ClientRateLimiter** - Manages rate limits for a single client across all windows
3. **WindowTracker** - Tracks requests within a specific time window

### Time Windows

- **Second**: 1,000ms window
- **Minute**: 60,000ms window
- **Hour**: 3,600,000ms window
- **Day**: 86,400,000ms window

### How It Works

1. **Request Check**: When a request arrives, the rate limiter checks all time windows for the client
2. **Limit Enforcement**: If ANY window limit is exceeded, the request is blocked
3. **Response**: Returns HTTP 429 with retry-after information
4. **Recording**: If allowed, the request is recorded in all windows
5. **Cleanup**: Old timestamps are automatically removed from windows

## API Endpoints

### Client Endpoints

All protected endpoints now enforce rate limits:

- `GET /data` - Main data endpoint with rate limiting
- `GET /tier-info` - Tier information with rate limiting
- `GET /premium-only` - Premium endpoint with rate limiting

### Admin Endpoints

#### Get All Statistics
```bash
GET /admin/stats
```

Returns statistics including rate limit data for all clients.

#### Get Client Rate Limit Statistics
```bash
GET /admin/rate-limits/:clientName
```

Returns rate limit statistics for a specific client.

**Response:**
```json
{
  "clientName": "Client A",
  "windows": {
    "second": {
      "currentCount": 5,
      "limit": 10,
      "remainingRequests": 5
    },
    "minute": {
      "currentCount": 20,
      "limit": 100,
      "remainingRequests": 80
    },
    ...
  }
}
```

#### Reset Client Rate Limits
```bash
POST /admin/rate-limits/:clientName/reset
```

Resets rate limits for a specific client.

#### Get Tier Limits
```bash
GET /admin/rate-limits/tier/:tier
```

Returns rate limits configuration for a specific tier.

**Response:**
```json
{
  "tier": "free",
  "limits": {
    "second": 1,
    "minute": 10,
    "hour": 100,
    "day": 1000
  }
}
```

#### Update Tier Limits
```bash
PUT /admin/rate-limits/tier/:tier
Content-Type: application/json

{
  "second": 5,
  "minute": 50,
  "hour": 500,
  "day": 5000
}
```

Updates rate limits for a specific tier. Partial updates are supported.

## Error Responses

### HTTP 429 - Rate Limit Exceeded

When a rate limit is exceeded, the API returns:

**Status**: `429 Too Many Requests`

**Headers**:
```
Retry-After: 3
```

**Body**:
```json
{
  "error": {
    "message": "Rate limit exceeded for second window",
    "limitingWindow": "second",
    "retryAfter": 3,
    "windows": {
      "second": {
        "allowed": false,
        "currentCount": 10,
        "limit": 10,
        "remainingRequests": 0
      },
      "minute": {
        "allowed": true,
        "currentCount": 45,
        "limit": 100,
        "remainingRequests": 55
      },
      "hour": {
        "allowed": true,
        "currentCount": 234,
        "limit": 1000,
        "remainingRequests": 766
      },
      "day": {
        "allowed": true,
        "currentCount": 1234,
        "limit": 10000,
        "remainingRequests": 8766
      }
    }
  }
}
```

### Fields Explained

- `message`: Human-readable error message indicating which window caused the limit
- `limitingWindow`: The time window that exceeded its limit (second/minute/hour/day)
- `retryAfter`: Number of seconds to wait before retrying (also in header)
- `windows`: Detailed status of all time windows
  - `allowed`: Whether this specific window would allow the request
  - `currentCount`: Current number of requests in this window
  - `limit`: Maximum allowed requests in this window
  - `remainingRequests`: Number of requests remaining in this window

## Example Usage

### Testing with curl

#### Free Tier Client (1 request/second)

```bash
# First request - succeeds
curl -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data

# Second request immediately - gets rate limited
curl -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data
# Returns: HTTP 429 with Retry-After header

# Wait 1 second, then succeeds again
sleep 1
curl -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data
```

#### Premium Tier Client (50 requests/second)

```bash
# Can make 50 requests rapidly
for i in {1..50}; do
  curl -H "X-API-Key: 67890-ZYXWV" http://localhost:3000/data
done

# 51st request gets rate limited
curl -H "X-API-Key: 67890-ZYXWV" http://localhost:3000/data
# Returns: HTTP 429
```

### Checking Statistics

```bash
# Get all rate limit statistics
curl http://localhost:3000/admin/stats

# Get statistics for specific client
curl http://localhost:3000/admin/rate-limits/Client%20A

# Get limits for a tier
curl http://localhost:3000/admin/rate-limits/tier/free

# Update tier limits
curl -X PUT http://localhost:3000/admin/rate-limits/tier/free \
  -H "Content-Type: application/json" \
  -d '{"second": 5, "minute": 50}'

# Reset client rate limits
curl -X POST http://localhost:3000/admin/rate-limits/Client%20A/reset
```