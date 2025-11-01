# Rate Limit Response Headers

This API exposes rate limit information in HTTP response headers to allow clients to understand their rate limit status and adjust their request pacing accordingly.

## Header Format

All rate limit information is provided via response headers with the `X-RateLimit-*` prefix, following industry standards.

### Standard Headers (All Responses)

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `X-RateLimit-Limit` | Integer | Total number of requests allowed in the current window | `100` |
| `X-RateLimit-Remaining` | Integer | Number of requests remaining in the current window | `42` |
| `X-RateLimit-Reset` | Unix Timestamp | Time when the rate limit window resets (seconds since epoch) | `1761885479` |
| `X-RateLimit-Window` | Integer | Duration of the rate limit window in seconds | `60` |
| `X-RateLimit-Accuracy-Margin` | Percentage | Accuracy margin for rate limit calculations | `5%` |

### Rate Limited Response (429 Status)

When a request is rate limited, additional headers are included:

| Header | Type | Description | Example |
|--------|------|-------------|---------|
| `Retry-After` | Integer | Seconds to wait before retrying (RFC 6585 compliant) | `45` |
| `X-RateLimit-Retry-After` | Integer | Custom header: seconds to wait before retrying | `45` |

## HTTP Status Codes

- **200 OK**: Request successful, rate limit headers included
- **429 Too Many Requests**: Rate limit exceeded, retry information provided
- **401 Unauthorized**: Invalid or missing API key (no rate limit headers)
- **403 Forbidden**: IP address blocked or access denied (no rate limit headers)

## Example Response Headers

### Successful Request (HTTP 200)

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1761885479
X-RateLimit-Window: 60
X-RateLimit-Accuracy-Margin: 5%
```

### Rate Limited Request (HTTP 429)

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1761885524
X-RateLimit-Window: 60
X-RateLimit-Accuracy-Margin: 5%
Retry-After: 45
X-RateLimit-Retry-After: 45
```

## Client Implementation Examples

### JavaScript/Node.js Client

```javascript
import axios from 'axios';

class APIClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'http://localhost:3000',
      headers: {
        'X-API-Key': apiKey
      }
    });
  }

  /**
   * Extract rate limit info from response headers
   */
  getRateLimitInfo(response) {
    return {
      limit: parseInt(response.headers['x-ratelimit-limit']),
      remaining: parseInt(response.headers['x-ratelimit-remaining']),
      reset: new Date(parseInt(response.headers['x-ratelimit-reset']) * 1000),
      window: parseInt(response.headers['x-ratelimit-window']),
      resetInSeconds: parseInt(response.headers['x-ratelimit-reset']) - Math.floor(Date.now() / 1000)
    };
  }

  /**
   * Make request with automatic rate limit handling
   */
  async makeRequest(endpoint, options = {}) {
    try {
      const response = await this.client.get(endpoint, options);
      
      // Extract and log rate limit info
      const rateLimitInfo = this.getRateLimitInfo(response);
      console.log(`Rate Limit Status: ${rateLimitInfo.remaining}/${rateLimitInfo.limit} requests remaining`);
      console.log(`Window resets in ${rateLimitInfo.resetInSeconds} seconds`);
      
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after']);
        console.warn(`Rate limited. Wait ${retryAfter} seconds before retrying.`);
        
        // Option 1: Throw error with retry info
        const rateLimitInfo = this.getRateLimitInfo(error.response);
        throw new Error(`Rate limited. Retry after ${retryAfter}s. ` +
                       `Window resets at ${rateLimitInfo.reset.toISOString()}`);
        
        // Option 2: Automatically retry (with exponential backoff)
        // await this.delay(retryAfter * 1000);
        // return this.makeRequest(endpoint, options);
      }
      throw error;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Make multiple requests with intelligent pacing
   */
  async makeConcurrentRequests(endpoints, { maxConcurrent = 5 } = {}) {
    const results = [];
    const rateLimitInfo = { remaining: null, limit: null };

    for (let i = 0; i < endpoints.length; i += maxConcurrent) {
      const batch = endpoints.slice(i, i + maxConcurrent);
      
      // Check if we're getting close to limit
      if (rateLimitInfo.remaining && rateLimitInfo.remaining < batch.length) {
        console.log(`Approaching rate limit. Waiting before next batch...`);
        await this.delay(5000);
      }
      
      const batchResults = await Promise.all(
        batch.map(endpoint => 
          this.client.get(endpoint)
            .then(response => {
              Object.assign(rateLimitInfo, this.getRateLimitInfo(response));
              return response.data;
            })
        )
      );
      
      results.push(...batchResults);
    }

    return results;
  }
}

// Usage
const client = new APIClient('12345-ABCDE');

try {
  const data = await client.makeRequest('/data');
  console.log('Data:', data);
} catch (error) {
  console.error('Error:', error.message);
}
```

### Python Client

```python
import requests
import time
from datetime import datetime
from typing import Dict, Optional

class APIClient:
    def __init__(self, api_key: str, base_url: str = 'http://localhost:3000'):
        self.api_key = api_key
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({'X-API-Key': api_key})

    def get_rate_limit_info(self, response: requests.Response) -> Dict:
        """Extract rate limit information from response headers"""
        return {
            'limit': int(response.headers.get('x-ratelimit-limit', 0)),
            'remaining': int(response.headers.get('x-ratelimit-remaining', 0)),
            'reset': int(response.headers.get('x-ratelimit-reset', 0)),
            'window_seconds': int(response.headers.get('x-ratelimit-window', 0)),
            'reset_datetime': datetime.fromtimestamp(int(response.headers.get('x-ratelimit-reset', 0)))
        }

    def make_request(self, endpoint: str, **kwargs) -> Dict:
        """Make request with rate limit handling"""
        try:
            response = self.session.get(
                f'{self.base_url}{endpoint}',
                **kwargs
            )
            
            # Extract and log rate limit info
            rate_limit_info = self.get_rate_limit_info(response)
            print(f"Rate Limit: {rate_limit_info['remaining']}/{rate_limit_info['limit']} remaining")
            
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 429:
                retry_after = int(e.response.headers.get('retry-after', 60))
                print(f"Rate limited. Waiting {retry_after} seconds...")
                
                # Option 1: Raise with info
                rate_limit_info = self.get_rate_limit_info(e.response)
                raise Exception(f"Rate limited. Retry after {retry_after}s. "
                              f"Window resets at {rate_limit_info['reset_datetime']}")
                
                # Option 2: Automatically retry
                # time.sleep(retry_after)
                # return self.make_request(endpoint, **kwargs)
            raise

    def make_concurrent_requests(self, endpoints: list, batch_size: int = 5) -> list:
        """Make multiple requests with intelligent pacing"""
        results = []
        rate_limit_info = {}

        for i in range(0, len(endpoints), batch_size):
            batch = endpoints[i:i + batch_size]
            
            # Check if approaching rate limit
            if rate_limit_info.get('remaining', 100) < len(batch):
                print("Approaching rate limit. Waiting before next batch...")
                time.sleep(5)
            
            for endpoint in batch:
                try:
                    data = self.make_request(endpoint)
                    results.append(data)
                except Exception as e:
                    print(f"Error fetching {endpoint}: {e}")
                    continue

        return results

# Usage
client = APIClient('12345-ABCDE')

try:
    data = client.make_request('/data')
    print('Data:', data)
except Exception as error:
    print(f'Error: {error}')
```

### cURL Examples

```bash
# Basic request with headers display
curl -v -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data

# Extract rate limit headers only
curl -s -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data | jq -r 'empty'
curl -D - -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data -o /dev/null | grep "X-RateLimit"

# Handle 429 responses
curl -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data \
  && echo "Success" \
  || if [ $? -eq 22 ]; then \
       RETRY_AFTER=$(curl -I -H "X-API-Key: 12345-ABCDE" http://localhost:3000/data | grep "Retry-After"); \
       echo "Rate limited: $RETRY_AFTER"; \
     fi
```

### Best Practices for Clients

1. **Always Check Rate Limit Headers**
   - Monitor `X-RateLimit-Remaining` to predict when you'll hit the limit
   - Use `X-RateLimit-Reset` to know when limits reset

2. **Implement Intelligent Backoff**
   ```javascript
   // Pseudocode
   if (remaining < threshold) {
     // Reduce request rate or add delays
     await delay(calculateBackoffDelay(remaining, limit));
   }
   ```

3. **Respect Retry-After Header**
   - When receiving 429 responses, always wait the time specified in `Retry-After`
   - Don't immediately retry without waiting

4. **Batch Requests When Possible**
   - Combine multiple requests into single operations
   - Reduces total number of API calls

5. **Cache Results**
   - Cache successful responses to minimize redundant requests
   - Consider cache TTL based on data freshness requirements

6. **Implement Circuit Breaker Pattern**
   - Track failure rates and temporarily stop requests if failures are too frequent
   - Prevents cascading failures during outages

7. **Monitor Rate Limit Trends**
   - Track usage patterns over time
   - Adjust request rates based on historical data
   - Alert if usage approaches limits

## Accuracy Guarantee

The rate limit headers are accurate within ±5% margin. This means:
- If `X-RateLimit-Remaining` shows 100 requests, you have between 95-105 requests
- Timing information (reset timestamps) may vary by ±5 seconds
- Use these headers for intelligent pacing, not as exact values

## Troubleshooting

### Headers Missing
- Verify API key is valid (400s still return headers for rate-limited endpoints)
- Check response status code (401, 403 don't include rate limit headers)
- Ensure headers are case-insensitive (HTTP headers are case-insensitive)

### Incorrect Remaining Count
- Rate limits reset at the window boundary (Unix timestamp in `X-RateLimit-Reset`)
- Remember the ±5% accuracy margin
- Multiple windows (second, minute, hour, day) may apply - the most restrictive wins

### Keep Getting 429
- Respect the `Retry-After` header value
- Implement exponential backoff for automatic retries
- Consider upgrading to higher tier for increased limits

## Additional Resources

- [RFC 6585 - HTTP Status Code 429](https://tools.ietf.org/html/rfc6585)
- [GitHub Rate Limiting API](https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api)
- [Stripe Rate Limiting](https://stripe.com/docs/rate-limits)
