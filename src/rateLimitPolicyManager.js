/**
 * RateLimitPolicyManager: Manages CRUD for rate limit policies in CSV format
 *
 * Policy fields:
 * id, endpoint, api_key, ip_or_cidr, tier, limit, window
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POLICY_FILE = path.join(__dirname, 'rate_limit_policies.csv');

class RateLimitPolicyManager {
  constructor(policyFile = POLICY_FILE) {
    this.policyFile = policyFile;
    this.policies = [];
    this._loadPolicies();
  }

  _validatePolicy(policy) {
    const errors = [];
    const validatedPolicy = { ...policy };

    // Required fields
    if (validatedPolicy.limit === undefined || validatedPolicy.limit === '') errors.push('limit is required');
    if (validatedPolicy.window === undefined || validatedPolicy.window === '') errors.push('window is required');

    // Convert and validate limit
    if (validatedPolicy.limit) {
      let limitStr = validatedPolicy.limit.toString();

      try {
        if (limitStr.toLowerCase().includes('e')) {
          const num = BigInt(Math.floor(Number(limitStr)));
          limitStr = num.toString();
        }

        limitStr = limitStr.replace(/[^\d]/g, '');

        if (!limitStr || /^0+$/.test(limitStr)) {
          validatedPolicy.limit = '0';
        } else {
          validatedPolicy.limit = limitStr.replace(/^0+/, '') || '0';
        }
      } catch (e) {
        validatedPolicy.limit = '0';
      }
    }

    // Convert and validate window
    if (validatedPolicy.window) {
      let windowStr = validatedPolicy.window.toString();
      let windowNum;

      try {
        if (windowStr.length > 10) {
          validatedPolicy.window = '60';
          return { policy: validatedPolicy, errors };
        }

        if (windowStr.toLowerCase().includes('e')) {
          try {
            windowNum = BigInt(Math.floor(Number(windowStr)));
          } catch (e) {
            windowNum = 0;
          }
        } else {
          windowStr = windowStr.replace(/[^\d.-]/g, '');
          windowNum = parseInt(windowStr);
        }
      } catch (e) {
        windowNum = 0;
      }

      if (isNaN(windowNum) || windowNum <= 0) {
        validatedPolicy.window = '60';
      } else {
        validatedPolicy.window = windowNum > 86400 ? '86400' : String(windowNum);
      }
    } else {
      validatedPolicy.window = '60';
    }

    // Validate priority if present
    if (validatedPolicy.priority !== undefined) {
      const prioNum = parseInt(validatedPolicy.priority);
      validatedPolicy.priority = isNaN(prioNum) ? '0' : Math.max(0, prioNum).toString();
    } else {
      validatedPolicy.priority = '0';
    }

    // Endpoint sanitization
    if (validatedPolicy.endpoint) {
      const normalized = path.normalize(validatedPolicy.endpoint)
        .replace(/\\/g, '/') // Convert Windows paths
        .replace(/\/+/g, '/'); // Remove duplicate slashes
      if (normalized === '.' || normalized === '..') {
        validatedPolicy.endpoint = '/';
      } else {
        validatedPolicy.endpoint = normalized;
      }
    }

    // Convert undefined/null to empty strings
    validatedPolicy.api_key = validatedPolicy.api_key || '';
    validatedPolicy.endpoint = validatedPolicy.endpoint || '';
    validatedPolicy.ip_or_cidr = validatedPolicy.ip_or_cidr || '';
    validatedPolicy.tier = validatedPolicy.tier || '';

    // Validate CIDR notation
    if (validatedPolicy.ip_or_cidr) {
      const parts = validatedPolicy.ip_or_cidr.split('/');
      if (parts.length === 2) {
        const [ip, bits] = parts;
        const ipParts = ip.split('.');
        const bitsNum = parseInt(bits);
        if (ipParts.length !== 4 || ipParts.some(p => parseInt(p) > 255) || 
            bitsNum < 0 || bitsNum > 32) {
          validatedPolicy.ip_or_cidr = '';
        }
      } else if (!validatedPolicy.ip_or_cidr.match(/^(?:\d{1,3}\.){3}\d{1,3}$/)) {
        validatedPolicy.ip_or_cidr = '';
      }
    }

    // Case-insensitive tier
    if (validatedPolicy.tier) {
      validatedPolicy.tier = validatedPolicy.tier.toLowerCase();
    }

    // At least one matching criteria required
    if (!validatedPolicy.endpoint && !validatedPolicy.api_key && 
        !validatedPolicy.ip_or_cidr && !validatedPolicy.tier) {
      errors.push('at least one of endpoint, api_key, ip_or_cidr, or tier is required');
    }

    return { policy: validatedPolicy, errors };
  }

  _loadPolicies() {
    try {
      if (!fs.existsSync(this.policyFile)) {
        this.policies = [];
        return;
      }
      const fileContent = fs.readFileSync(this.policyFile, 'utf-8');
      this.policies = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (error) {
      console.error('Error loading rate limit policies:', error.message);
      this.policies = [];
    }
  }

  _savePolicies() {
    try {
      // Ensure the directory exists
      const dir = path.dirname(this.policyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
      }
      
      const csvContent = stringify(this.policies, {
        header: true,
        columns: ['id', 'endpoint', 'api_key', 'ip_or_cidr', 'tier', 'limit', 'window']
      });
      fs.writeFileSync(this.policyFile, csvContent, { encoding: 'utf-8', mode: 0o666 });
    } catch (error) {
      console.error('Error saving rate limit policies:', error.message);
    }
  }

  getAllPolicies() {
    return this.policies;
  }

  getPolicyById(id) {
    return this.policies.find(p => p.id === String(id));
  }

  addPolicy(policy) {
    // Generate new ID if not provided
    if (!policy.id) {
      policy.id = String(Date.now());
    }
    
    // Validate policy
    const { policy: validatedPolicy, errors } = this._validatePolicy(policy);
    if (errors.length > 0) {
      console.warn('Policy validation warnings:', errors.join(', '));
    }
    
    this.policies.push(validatedPolicy);
    this._savePolicies();
    return validatedPolicy;
  }

  updatePolicy(id, updates) {
    const idx = this.policies.findIndex(p => p.id === String(id));
    if (idx === -1) return null;
    
    // Create merged policy and validate
    const currentPolicy = this.policies[idx];
    const updatedPolicy = { 
      ...currentPolicy,
      ...updates,
      id: String(id)
    };
    
    const { policy: validatedPolicy } = this._validatePolicy(updatedPolicy);
    
    // Update policy
    this.policies[idx] = validatedPolicy;
    
    // Save all policies to ensure consistency
    this._savePolicies();
    
    // Return the updated policy after saving
    return this.policies[idx];
  }
  
  // Batch update helper method
  _batchUpdatePolicies(policies, updates) {
    if (!Array.isArray(policies) || !updates || Object.keys(updates).length === 0) {
      return [];
    }

    const originalPolicies = [...this.policies];
    const updatedPolicies = [];
    let needsSave = false;

    try {
      // Process each policy
      for (const policy of policies) {
        const strId = String(policy.id || policy);
        const idx = this.policies.findIndex(p => p.id === strId);
        
        if (idx !== -1) {
          const updatedPolicy = {
            ...this.policies[idx],
            ...updates,
            id: strId
          };
          
          const { policy: validatedPolicy, errors } = this._validatePolicy(updatedPolicy);
          
          // Skip policies that would become invalid after update
          if (errors.length > 0) {
            continue;
          }
          
          this.policies[idx] = validatedPolicy;
          updatedPolicies.push(validatedPolicy);
          needsSave = true;
        }
      }
      
      // Save changes if any updates were successful
      if (needsSave) {
        this._savePolicies();
        return updatedPolicies;
      }
      
      return [];
    } catch (error) {
      // Rollback on error
      this.policies = originalPolicies;
      console.error('Batch update failed:', error.message);
      return [];
    }
  }

  deletePolicy(id) {
    if (!id) return false;
    
    const strId = String(id);
    const initialLength = this.policies.length;
    
    // Remove all policies with matching ID
    const newPolicies = this.policies.filter(p => p.id !== strId);
    const deleted = newPolicies.length < initialLength;
    
    // Update policies and save if anything was deleted
    if (deleted) {
      this.policies = newPolicies;
      this._savePolicies();
    }
    
    return deleted;
  }
  
  // Batch delete helper method
  _batchDeletePolicies(policies) {
    if (!Array.isArray(policies) || policies.length === 0) return false;
    
    // Create array of IDs to delete
    const stringIds = new Set(policies.map(p => 
      typeof p === 'string' ? p : String(p.id)
    ));
    
    const initialLength = this.policies.length;
    const remainingPolicies = this.policies.filter(p => !stringIds.has(p.id));
    
    // Only update if we actually removed something
    if (remainingPolicies.length < initialLength) {
      this.policies = remainingPolicies;
      this._savePolicies();
      return true;
    }
    
    return false;
  }

  /**
   * Find all policies matching a request
   * @param {Object} reqInfo - { endpoint, apiKey, ip, tier }
   * @returns {Array} Matching policies
   */
  findPoliciesForRequest(reqInfo) {
    const normalizedReqInfo = {
      ...reqInfo,
      tier: reqInfo.tier ? reqInfo.tier.toLowerCase() : undefined
    };

    // Calculate match scores and filter matching policies
    const matchingPolicies = this.policies.map(policy => {
      let score = parseInt(policy.priority || '0') * 1000;
      let matches = true;

      // Exact endpoint match has highest precedence
      if (policy.endpoint && normalizedReqInfo.endpoint) {
        if (policy.endpoint === normalizedReqInfo.endpoint) {
          score += 400;
        } else if (policy.endpoint === '*') {
          score += 100;
        } else if (policy.endpoint.includes(':')) {
          // Path parameter matching (e.g., /users/:id)
          const policyParts = policy.endpoint.split('/');
          const reqParts = normalizedReqInfo.endpoint.split('/');
          if (policyParts.length === reqParts.length) {
            let paramMatch = true;
            let paramCount = 0;
            for (let i = 0; i < policyParts.length; i++) {
              if (policyParts[i].startsWith(':')) {
                paramCount++;
              } else if (policyParts[i] !== reqParts[i]) {
                paramMatch = false;
                break;
              }
            }
            if (paramMatch) {
              score += 300 - paramCount; // More params = slightly lower score
            } else {
              matches = false;
            }
          } else {
            matches = false;
          }
        } else {
          matches = false;
        }
      }

      // Match api_key
      if (matches && policy.api_key && normalizedReqInfo.apiKey) {
        if (policy.api_key === normalizedReqInfo.apiKey) {
          score += 200;
        } else {
          matches = false;
        }
      }

      // Match ip_or_cidr
      if (matches && policy.ip_or_cidr && normalizedReqInfo.ip) {
        if (policy.ip_or_cidr.includes('/')) {
          // CIDR matching
          const [subnet, bits] = policy.ip_or_cidr.split('/');
          const bitsNum = parseInt(bits);
          const netMask = ~((1 << (32 - bitsNum)) - 1);
          
          // Convert IP addresses to 32-bit integers for comparison
          const ipToInt = (ip) => {
            try {
              const octets = ip.split('.');
              if (octets.length !== 4) return null;
              
              const nums = octets.map(octet => {
                const num = parseInt(octet);
                return (num >= 0 && num <= 255) ? num : null;
              });
              
              if (nums.includes(null)) return null;
              
              return nums.reduce((sum, octet) => (sum << 8) + octet, 0);
            } catch (error) {
              return null;
            }
          };
          
          const reqIpInt = ipToInt(normalizedReqInfo.ip);
          const subnetInt = ipToInt(subnet);
          
          if (reqIpInt === null || subnetInt === null) {
            matches = false;
            return;
          }
          
          if ((reqIpInt & netMask) === (subnetInt & netMask)) {
            score += 200 - (32 - bitsNum); // More specific CIDR = higher score
          } else {
            matches = false;
          }
        } else if (policy.ip_or_cidr === normalizedReqInfo.ip) {
          score += 200;
        } else {
          matches = false;
        }
      }

      // Match tier
      if (matches && policy.tier && normalizedReqInfo.tier) {
        if (policy.tier === normalizedReqInfo.tier) {
          score += 200;
        } else {
          matches = false;
        }
      }

      return { policy, score, matches };
    })
    .filter(item => item.matches)
    .sort((a, b) => b.score - a.score)
    .map(item => item.policy);

    return matchingPolicies;
  } // End of findPoliciesForRequest
}

export default RateLimitPolicyManager;
