/**
 * IPAllowBlockManager: Handles IP allowlists and blocklists with CIDR support
 * 
 * Features:
 * - Allowlist: IPs that are processed according to normal rules
 * - Blocklist: IPs that are immediately rejected with HTTP 403
 * - Supports both individual IP addresses and CIDR ranges
 * - IPv4 and IPv6 support
 * - Fast lookup using Map data structures
 * - Persistent storage in CSV files
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { fileURLToPath } from 'url';
import CIDR from 'ip-cidr';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const IPListAction = {
  ALLOW: 'allow',
  BLOCK: 'block',
  NONE: 'none'
};

class IPAllowBlockManager {
  /**
   * Initialize IPAllowBlockManager
   * @param {string} allowlistFile - Path to CSV file with allowlisted IPs/CIDRs
   * @param {string} blocklistFile - Path to CSV file with blocklisted IPs/CIDRs
   */
  constructor(allowlistFile = 'ip_allowlist.csv', blocklistFile = 'ip_blocklist.csv') {
    this.allowlistFile = path.join(__dirname, allowlistFile);
    this.blocklistFile = path.join(__dirname, blocklistFile);
    
    // Map<ip_or_cidr, {type: 'ip'|'cidr', cidrObj?, description, addedDate, requestCount}>
    this.allowlist = new Map();
    this.blocklist = new Map();
    
    this._loadAllowlist();
    this._loadBlocklist();
  }

  /**
   * Load allowlist from CSV file
   * @private
   */
  _loadAllowlist() {
    try {
      if (!fs.existsSync(this.allowlistFile)) {
        console.warn(`Allowlist file not found: ${this.allowlistFile}`);
        this._createAllowlistFile();
        return;
      }

      const fileContent = fs.readFileSync(this.allowlistFile, 'utf-8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      this.allowlist.clear();

      for (const row of records) {
        const ipOrCidr = row.ip_or_cidr?.trim();
        const description = row.description?.trim() || '';
        const addedDate = row.added_date?.trim();
        const requestCount = parseInt(row.request_count) || 0;

        if (!ipOrCidr) continue;

        try {
          // Try to parse as CIDR range
          const cidrObj = new CIDR(ipOrCidr);
          this.allowlist.set(ipOrCidr, {
            type: 'cidr',
            cidrObj: cidrObj,
            description: description,
            addedDate: addedDate,
            requestCount: requestCount
          });
        } catch (error) {
          // Not a valid CIDR, treat as individual IP
          this.allowlist.set(ipOrCidr, {
            type: 'ip',
            description: description,
            addedDate: addedDate,
            requestCount: requestCount
          });
        }
      }

      console.info(`Loaded ${this.allowlist.size} entries in IP allowlist`);
    } catch (error) {
      console.error(`Error reading allowlist file: ${error.message}`);
    }
  }

  /**
   * Load blocklist from CSV file
   * @private
   */
  _loadBlocklist() {
    try {
      if (!fs.existsSync(this.blocklistFile)) {
        console.warn(`Blocklist file not found: ${this.blocklistFile}`);
        this._createBlocklistFile();
        return;
      }

      const fileContent = fs.readFileSync(this.blocklistFile, 'utf-8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      this.blocklist.clear();

      for (const row of records) {
        const ipOrCidr = row.ip_or_cidr?.trim();
        const description = row.description?.trim() || '';
        const addedDate = row.added_date?.trim();
        const requestCount = parseInt(row.request_count) || 0;

        if (!ipOrCidr) continue;

        try {
          // Try to parse as CIDR range
          const cidrObj = new CIDR(ipOrCidr);
          this.blocklist.set(ipOrCidr, {
            type: 'cidr',
            cidrObj: cidrObj,
            description: description,
            addedDate: addedDate,
            requestCount: requestCount
          });
        } catch (error) {
          // Not a valid CIDR, treat as individual IP
          this.blocklist.set(ipOrCidr, {
            type: 'ip',
            description: description,
            addedDate: addedDate,
            requestCount: requestCount
          });
        }
      }

      console.info(`Loaded ${this.blocklist.size} entries in IP blocklist`);
    } catch (error) {
      console.error(`Error reading blocklist file: ${error.message}`);
    }
  }

  /**
   * Create allowlist CSV file with headers
   * @private
   */
  _createAllowlistFile() {
    try {
      const headers = 'ip_or_cidr,description,added_date,request_count\n';
      fs.writeFileSync(this.allowlistFile, headers, 'utf-8');
      console.info(`Created ${this.allowlistFile}`);
    } catch (error) {
      console.error(`Error creating allowlist file: ${error.message}`);
    }
  }

  /**
   * Create blocklist CSV file with headers
   * @private
   */
  _createBlocklistFile() {
    try {
      const headers = 'ip_or_cidr,description,added_date,request_count\n';
      fs.writeFileSync(this.blocklistFile, headers, 'utf-8');
      console.info(`Created ${this.blocklistFile}`);
    } catch (error) {
      console.error(`Error creating blocklist file: ${error.message}`);
    }
  }

  /**
   * Save allowlist to CSV file
   * @private
   */
  _saveAllowlist() {
    try {
      const records = [];
      
      for (const [ipOrCidr, data] of this.allowlist.entries()) {
        records.push({
          ip_or_cidr: ipOrCidr,
          description: data.description,
          added_date: data.addedDate,
          request_count: data.requestCount
        });
      }

      records.sort((a, b) => a.ip_or_cidr.localeCompare(b.ip_or_cidr));

      const csvContent = stringify(records, {
        header: true,
        columns: ['ip_or_cidr', 'description', 'added_date', 'request_count']
      });

      fs.writeFileSync(this.allowlistFile, csvContent, 'utf-8');
      console.info(`Saved ${records.length} allowlist entries`);
    } catch (error) {
      console.error(`Error saving allowlist file: ${error.message}`);
    }
  }

  /**
   * Save blocklist to CSV file
   * @private
   */
  _saveBlocklist() {
    try {
      const records = [];
      
      for (const [ipOrCidr, data] of this.blocklist.entries()) {
        records.push({
          ip_or_cidr: ipOrCidr,
          description: data.description,
          added_date: data.addedDate,
          request_count: data.requestCount
        });
      }

      records.sort((a, b) => a.ip_or_cidr.localeCompare(b.ip_or_cidr));

      const csvContent = stringify(records, {
        header: true,
        columns: ['ip_or_cidr', 'description', 'added_date', 'request_count']
      });

      fs.writeFileSync(this.blocklistFile, csvContent, 'utf-8');
      console.info(`Saved ${records.length} blocklist entries`);
    } catch (error) {
      console.error(`Error saving blocklist file: ${error.message}`);
    }
  }

  /**
   * Check if an IP address is in the allowlist
   * @param {string} ipAddress - IP address to check
   * @returns {boolean} True if IP is allowlisted
   */
  isAllowlisted(ipAddress) {
    if (!ipAddress) return false;

    // Check exact IP match first
    if (this.allowlist.has(ipAddress)) {
      const entry = this.allowlist.get(ipAddress);
      entry.requestCount += 1;
      this._saveAllowlist();
      return true;
    }

    // Check CIDR ranges
    for (const [key, entry] of this.allowlist.entries()) {
      if (entry.type === 'cidr' && entry.cidrObj.contains(ipAddress)) {
        entry.requestCount += 1;
        this._saveAllowlist();
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an IP address is in the blocklist
   * @param {string} ipAddress - IP address to check
   * @returns {boolean} True if IP is blocklisted
   */
  isBlocklisted(ipAddress) {
    if (!ipAddress) return false;

    // Check exact IP match first
    if (this.blocklist.has(ipAddress)) {
      const entry = this.blocklist.get(ipAddress);
      entry.requestCount += 1;
      this._saveBlocklist();
      return true;
    }

    // Check CIDR ranges
    for (const [key, entry] of this.blocklist.entries()) {
      if (entry.type === 'cidr' && entry.cidrObj.contains(ipAddress)) {
        entry.requestCount += 1;
        this._saveBlocklist();
        return true;
      }
    }

    return false;
  }

  /**
   * Determine the action to take for an IP address
   * @param {string} ipAddress - IP address to check
   * @returns {Object} Object with action and details
   */
  checkIP(ipAddress) {
    if (!ipAddress) {
      return {
        action: IPListAction.NONE,
        reason: 'No IP address provided',
        ipAddress: null
      };
    }

    // Check blocklist first (higher priority)
    if (this.isBlocklisted(ipAddress)) {
      return {
        action: IPListAction.BLOCK,
        reason: 'IP address is blocklisted',
        ipAddress: ipAddress
      };
    }

    // Check allowlist
    if (this.isAllowlisted(ipAddress)) {
      return {
        action: IPListAction.ALLOW,
        reason: 'IP address is allowlisted',
        ipAddress: ipAddress
      };
    }

    // Not in any list
    return {
      action: IPListAction.NONE,
      reason: 'IP address not in any list - process according to normal rules',
      ipAddress: ipAddress
    };
  }

  /**
   * Add IP or CIDR to allowlist
   * @param {string} ipOrCidr - IP address or CIDR range
   * @param {string} description - Description for the entry
   * @returns {boolean} True if added successfully
   */
  addToAllowlist(ipOrCidr, description = '') {
    if (!ipOrCidr) return false;

    try {
      let entry;
      try {
        // Try to parse as CIDR
        const cidrObj = new CIDR(ipOrCidr);
        entry = {
          type: 'cidr',
          cidrObj: cidrObj,
          description: description,
          addedDate: new Date().toISOString(),
          requestCount: 0
        };
      } catch (error) {
        // Treat as individual IP
        entry = {
          type: 'ip',
          description: description,
          addedDate: new Date().toISOString(),
          requestCount: 0
        };
      }

      this.allowlist.set(ipOrCidr, entry);
      this._saveAllowlist();
      console.info(`Added ${ipOrCidr} to allowlist: ${description}`);
      return true;
    } catch (error) {
      console.error(`Error adding ${ipOrCidr} to allowlist: ${error.message}`);
      return false;
    }
  }

  /**
   * Add IP or CIDR to blocklist
   * @param {string} ipOrCidr - IP address or CIDR range
   * @param {string} description - Description for the entry
   * @returns {boolean} True if added successfully
   */
  addToBlocklist(ipOrCidr, description = '') {
    if (!ipOrCidr) return false;

    try {
      let entry;
      try {
        // Try to parse as CIDR
        const cidrObj = new CIDR(ipOrCidr);
        entry = {
          type: 'cidr',
          cidrObj: cidrObj,
          description: description,
          addedDate: new Date().toISOString(),
          requestCount: 0
        };
      } catch (error) {
        // Treat as individual IP
        entry = {
          type: 'ip',
          description: description,
          addedDate: new Date().toISOString(),
          requestCount: 0
        };
      }

      this.blocklist.set(ipOrCidr, entry);
      this._saveBlocklist();
      console.info(`Added ${ipOrCidr} to blocklist: ${description}`);
      return true;
    } catch (error) {
      console.error(`Error adding ${ipOrCidr} to blocklist: ${error.message}`);
      return false;
    }
  }

  /**
   * Remove IP or CIDR from allowlist
   * @param {string} ipOrCidr - IP address or CIDR range to remove
   * @returns {boolean} True if removed successfully
   */
  removeFromAllowlist(ipOrCidr) {
    if (this.allowlist.has(ipOrCidr)) {
      this.allowlist.delete(ipOrCidr);
      this._saveAllowlist();
      console.info(`Removed ${ipOrCidr} from allowlist`);
      return true;
    }
    return false;
  }

  /**
   * Remove IP or CIDR from blocklist
   * @param {string} ipOrCidr - IP address or CIDR range to remove
   * @returns {boolean} True if removed successfully
   */
  removeFromBlocklist(ipOrCidr) {
    if (this.blocklist.has(ipOrCidr)) {
      this.blocklist.delete(ipOrCidr);
      this._saveBlocklist();
      console.info(`Removed ${ipOrCidr} from blocklist`);
      return true;
    }
    return false;
  }

  /**
   * Get statistics about allowlist and blocklist
   * @returns {Object} Statistics
   */
  getStatistics() {
    const allowlistStats = {
      totalEntries: this.allowlist.size,
      ipEntries: 0,
      cidrEntries: 0,
      totalRequests: 0
    };

    const blocklistStats = {
      totalEntries: this.blocklist.size,
      ipEntries: 0,
      cidrEntries: 0,
      totalRequests: 0
    };

    // Count allowlist statistics
    for (const [key, entry] of this.allowlist.entries()) {
      if (entry.type === 'ip') {
        allowlistStats.ipEntries += 1;
      } else {
        allowlistStats.cidrEntries += 1;
      }
      allowlistStats.totalRequests += entry.requestCount;
    }

    // Count blocklist statistics
    for (const [key, entry] of this.blocklist.entries()) {
      if (entry.type === 'ip') {
        blocklistStats.ipEntries += 1;
      } else {
        blocklistStats.cidrEntries += 1;
      }
      blocklistStats.totalRequests += entry.requestCount;
    }

    return {
      allowlist: allowlistStats,
      blocklist: blocklistStats
    };
  }

  /**
   * Reload both allowlist and blocklist from files
   */
  reloadAll() {
    const oldAllowlistCount = this.allowlist.size;
    const oldBlocklistCount = this.blocklist.size;
    
    this._loadAllowlist();
    this._loadBlocklist();
    
    console.info(`Allowlist reloaded: ${oldAllowlistCount} -> ${this.allowlist.size}`);
    console.info(`Blocklist reloaded: ${oldBlocklistCount} -> ${this.blocklist.size}`);
  }
}

export default IPAllowBlockManager;