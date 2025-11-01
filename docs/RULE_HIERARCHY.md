# Rate Limit Rule Hierarchy

## Overview

The API Rate Limiter implements a sophisticated rule hierarchy system that allows for flexible and granular rate limiting policies. This document explains how rules are matched, prioritized, and applied to incoming requests.

## Rule Hierarchy Levels

Rules are evaluated and prioritized according to the following hierarchy (highest to lowest priority):

1. **Client-Specific Rules** (Priority: 10,000+)
   - Rules that target specific API clients identified by their API key
   - Highest priority - allows for customized service levels per client

2. **Application/Endpoint Rules** (Priority: 100-1,000)
   - Rules that target specific API endpoints or applications
   - Includes exact matches, parameterized routes, and wildcards

3. **Global Rules** (Priority: 0-100)
   - Rules that apply to all requests regardless of client or endpoint
   - Lowest priority - serves as baseline/fallback policy

## Scoring Algorithm

Each matching rule is assigned a score based on multiple factors. The rule with the highest score is selected.

### Score Components

| Component | Score | Description |
|-----------|-------|-------------|
| **API Key Match** | +10,000 | Rule specifies the client's API key |
| **Exact Endpoint** | +1,000 | Rule matches endpoint exactly (e.g., `/api/users`) |
| **Parameterized Endpoint** | +500 | Rule matches with parameters (e.g., `/api/users/:id`) |
| **Wildcard Endpoint** | +100 | Rule uses wildcard (e.g., `/api/*`) |
| **IP Address (Exact)** | +332 | Rule matches exact IP address |
| **CIDR /24** | +324 | Rule matches /24 subnet |
| **CIDR /16** | +316 | Rule matches /16 subnet |
| **CIDR /8** | +308 | Rule matches /8 subnet |
| **Generic IP Rule** | +300 | Rule has IP condition but no specific match |
| **Tier Match** | +50 | Rule matches client's tier (premium, standard, basic, free) |

### Score Calculation Example

For a request with:
- API Key: `client-123`
- Endpoint: `/api/users/42`
- IP: `192.168.1.100`
- Tier: `premium`

**Rule A:** `api_key=client-123, endpoint=/api/users/:id, tier=premium`
- Score: 10,000 (API key) + 500 (parameterized endpoint) + 50 (tier) = **10,550**

**Rule B:** `endpoint=/api/users/:id, tier=premium`
- Score: 500 (parameterized endpoint) + 50 (tier) = **550**

**Rule C:** `endpoint=/api/*`
- Score: 100 (wildcard endpoint) = **100**

**Result:** Rule A is selected (highest score)

## Rule Matching Process

### Step 1: Filter Applicable Rules
The system first filters all policies to find those that could apply to the request:
- Check if API key matches (if rule specifies one)
- Check if endpoint matches (exact, parameterized, or wildcard)
- Check if IP address/CIDR matches
- Check if tier matches

### Step 2: Calculate Scores
For each applicable rule, calculate the total score based on all matching components.

### Step 3: Select Best Match
The rule with the highest score is selected and applied. If multiple rules have the same score, the most recently defined rule wins.

### Step 4: Apply Rate Limit
The selected rule's rate limit parameters are enforced:
- `max_requests`: Maximum number of requests allowed
- `window_seconds`: Time window for the limit (in seconds)

## Conflict Resolution

### Scenario 1: Client-Specific vs Global
**Question:** What happens if a client has both a client-specific rule and a global rule applies?

**Answer:** Client-specific rule always wins due to the +10,000 score bonus.

**Example:**
```
Rule 1: api_key=client-abc, max_requests=1000, window_seconds=60
Rule 2: endpoint=/api/*, max_requests=100, window_seconds=60

Request: api_key=client-abc, endpoint=/api/users
Result: Rule 1 applies (1000 req/min) - Score: 10,100 vs 100
```

### Scenario 2: Exact vs Wildcard Endpoint
**Question:** If both an exact endpoint match and a wildcard match exist, which wins?

**Answer:** Exact endpoint match wins due to higher score (+1,000 vs +100).

**Example:**
```
Rule 1: endpoint=/api/users, max_requests=200, window_seconds=60
Rule 2: endpoint=/api/*, max_requests=50, window_seconds=60

Request: endpoint=/api/users
Result: Rule 1 applies (200 req/min) - Score: 1,000 vs 100
```

### Scenario 3: Multiple Client-Specific Rules
**Question:** If multiple client-specific rules match, how is the best one chosen?

**Answer:** Additional factors (endpoint specificity, IP match, tier) break the tie.

**Example:**
```
Rule 1: api_key=client-xyz, endpoint=/api/users, max_requests=500
Rule 2: api_key=client-xyz, endpoint=/api/*, max_requests=1000

Request: api_key=client-xyz, endpoint=/api/users
Result: Rule 1 applies (500 req/min) - Score: 11,000 vs 10,100
```

### Scenario 4: Overlapping IP and Endpoint Rules
**Question:** When both IP-based and endpoint-based rules match, which takes precedence?

**Answer:** Depends on specificity. More specific combinations win.

**Example:**
```
Rule 1: ip_address=192.168.1.100, max_requests=300, window_seconds=60
Rule 2: endpoint=/api/users, max_requests=200, window_seconds=60

Request: ip_address=192.168.1.100, endpoint=/api/users
Result: Rule 2 applies (200 req/min) - Score: 1,000 vs 332
```

But if the endpoint is less specific:
```
Rule 1: ip_address=192.168.1.100, max_requests=300, window_seconds=60
Rule 2: endpoint=/api/*, max_requests=200, window_seconds=60

Request: ip_address=192.168.1.100, endpoint=/api/users
Result: Rule 1 applies (300 req/min) - Score: 332 vs 100
```

## Policy Examples

### Example 1: Premium Client with Custom Limits
```csv
api_key,endpoint,ip_address,tier,max_requests,window_seconds,description
premium-client-001,/api/data,,,10000,60,"Premium client - high volume data access"
```
- **Priority:** Highest (client-specific)
- **Score:** 11,000 (api_key + exact endpoint)
- **Use Case:** Give specific client higher limits for specific endpoint

### Example 2: Tiered Access by Endpoint
```csv
api_key,endpoint,ip_address,tier,max_requests,window_seconds,description
,,premium,/api/premium/*,500,60,"Premium tier users get higher limits"
,,,standard,/api/*,100,60,"Standard tier baseline"
```
- **Priority:** Medium (endpoint-based)
- **Scores:** 150 (wildcard + tier) vs 50 (tier only)
- **Use Case:** Different limits for different user tiers

### Example 3: IP-Based Restriction
```csv
api_key,endpoint,ip_address,tier,max_requests,window_seconds,description
,,192.168.1.0/24,,50,60,"Limit requests from internal network"
```
- **Priority:** Medium (IP-based)
- **Score:** 324 (CIDR /24)
- **Use Case:** Rate limit specific network ranges

### Example 4: Fallback Global Rule
```csv
api_key,endpoint,ip_address,tier,max_requests,window_seconds,description
,,,,10,60,"Default rate limit for all requests"
```
- **Priority:** Lowest (global)
- **Score:** 0 (no specific matches)
- **Use Case:** Ensure all requests have some rate limit applied

## Practical Usage Patterns

### Pattern 1: VIP Treatment
Provide premium clients with higher limits across all endpoints:
```csv
premium-vip-001,,,,5000,60,"VIP client - unrestricted"
,/api/*,,,100,60,"Default for all API endpoints"
```

### Pattern 2: Endpoint Protection
Protect expensive operations while allowing liberal access to cheap ones:
```csv
,/api/expensive/compute,,,10,60,"Limit expensive computation endpoint"
,/api/cheap/read,,,1000,60,"Allow high volume on read-only endpoint"
,/api/*,,,100,60,"Default for other endpoints"
```

### Pattern 3: Progressive Tiers
Implement tiered service levels:
```csv
,,,premium,500,60,"Premium tier"
,,,standard,200,60,"Standard tier"
,,,basic,50,60,"Basic tier"
,,,free,10,60,"Free tier"
```

### Pattern 4: Mixed Strategy
Combine multiple strategies for fine-grained control:
```csv
premium-client-001,/api/compute,,,1000,60,"Premium client special access"
premium-client-001,,,,500,60,"Premium client default"
,/api/compute,,,50,60,"Expensive endpoint limit"
,,,premium,200,60,"Premium tier default"
,/api/*,,,100,60,"API-wide default"
```

## Troubleshooting

### Issue: Rule Not Being Applied

**Symptoms:** Expected rule doesn't seem to be enforced

**Diagnosis Steps:**
1. Check that the rule is properly formatted in `rate_limit_policies.csv`
2. Verify the request attributes (API key, endpoint, IP) match the rule conditions
3. Use the match details in responses to see which rule was actually selected
4. Check for higher-priority rules that might be overriding your rule

**Solution:** Review scoring algorithm and ensure your rule has the highest score for its intended requests.

### Issue: Unexpected Rule Selected

**Symptoms:** A different rule than expected is being applied

**Diagnosis Steps:**
1. Review the scoring algorithm to understand priorities
2. Check for client-specific rules (they always have highest priority)
3. Look for more specific endpoint matches that might score higher
4. Verify tier matching if applicable

**Solution:** Either modify the conflicting rule or add more specificity to your desired rule.

### Issue: No Rule Matches

**Symptoms:** Requests are not being rate limited

**Diagnosis Steps:**
1. Ensure at least one rule exists in `rate_limit_policies.csv`
2. Check that CSV file is properly formatted and readable
3. Verify the ConfigManager is loading policies correctly
4. Add a global fallback rule (empty conditions) to catch all requests

**Solution:** Add a catch-all global rule to ensure all requests have some limit applied.

## Best Practices

### 1. Always Have a Fallback Rule
```csv
,,,,100,60,"Global fallback - catches all requests"
```

### 2. Use Descriptive Descriptions
Good descriptions help with maintenance and troubleshooting:
```csv
premium-client-001,/api/data,,,10000,60,"ABC Corp - Contract #12345 - Data API access"
```

### 3. Start Broad, Then Add Specifics
Begin with global rules, then add client-specific overrides as needed:
```csv
# Global defaults first
,/api/*,,,100,60,"Default API limit"

# Then add client-specific exceptions
special-client,/api/*,,,1000,60,"Special client higher limit"
```

### 4. Document Your Intent
Use the description field to explain why a rule exists:
```csv
test-client,,,5,60,"Limit test client to prevent abuse during development"
```

### 5. Regular Audits
Periodically review your rules to:
- Remove obsolete client-specific rules
- Adjust limits based on usage patterns
- Consolidate overlapping rules
- Ensure rules still align with business needs

## Hot Reload Support

All rule changes take effect within 30 seconds without requiring service restart:
- Add new rules
- Modify existing rules
- Delete rules
- Changes propagate via ConfigManager

See [HOT_RELOAD.md](HOT_RELOAD.md) for details on configuration management.

## Testing Rule Hierarchy

Use the comprehensive test suite to verify rule hierarchy behavior:
```bash
npm test -- rateLimitPolicyHierarchy.test.js
```

Tests cover:
- Basic hierarchy enforcement
- Conflict resolution
- Complex overlapping scenarios
- Deterministic behavior
- Match details accuracy

## API Response Headers

When rate limit rules are applied, responses include headers showing:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Timestamp when limit resets
- `X-RateLimit-Policy`: Which rule was applied (in development mode)

## Further Reading

- [RATE_LIMITER.md](RATE_LIMITER.md) - Core rate limiter implementation
- [HOT_RELOAD.md](HOT_RELOAD.md) - Configuration hot-reload system
- [api-identification.txt](api-identification.txt) - API key identification guide
