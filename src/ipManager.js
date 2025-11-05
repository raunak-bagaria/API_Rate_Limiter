/**
 * IPManager: Handles IP-based validation against CIDR ranges and learned IPs.
 * 
 * - Checks preconfigured CIDR ranges first (client_cidr.csv)
 * - Falls back to learned IPs (client_ips.csv) if not in CIDR range
 * - Updates request counts in respective CSVs
 * - Supports both IPv4 and IPv6 addresses
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { fileURLToPath } from 'url';
import CIDR from 'ip-cidr';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class IPManager {
  /**
   * Initialize IPManager
   * @param {string} cidrFile - Path to CSV file with preconfigured CIDR ranges
   * @param {string} learnedIpsFile - Path to CSV file for learned IPs
   */
  constructor(cidrFile = 'client_cidr.csv', learnedIpsFile = 'client_ips.csv') {
    this.cidrFile = path.join(__dirname, cidrFile);
    this.learnedIpsFile = path.join(__dirname, learnedIpsFile);
    
    // Map<client_name, Array<{cidr, cidrObj, requestCount}>>
    this.cidrRanges = new Map();
    
    // Map<ip, {clientName, firstSeen, lastSeen, requestCount}>
    this.learnedIps = new Map();
    
    this._loadCIDRRanges();
    this._loadLearnedIps();
  }

  /**
   * Load CIDR ranges from CSV file
   * @private
   */
  _loadCIDRRanges() {
    try {
      if (!fs.existsSync(this.cidrFile)) {
        console.warn(`CIDR file not found: ${this.cidrFile}`);
        return;
      }

      const fileContent = fs.readFileSync(this.cidrFile, 'utf-8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      this.cidrRanges.clear();

      for (const row of records) {
        const clientName = row.client_name?.trim();
        const cidrRange = row.cidr_range?.trim();
        const requestCount = parseInt(row.request_count) || 0;

        if (!clientName || !cidrRange) continue;

        try {
          const cidrObj = new CIDR(cidrRange);
          
          if (!this.cidrRanges.has(clientName)) {
            this.cidrRanges.set(clientName, []);
          }

          this.cidrRanges.get(clientName).push({
            cidr: cidrRange,
            cidrObj: cidrObj,
            requestCount: requestCount
          });
        } catch (error) {
          console.error(`Invalid CIDR range ${cidrRange}: ${error.message}`);
        }
      }

      console.info(`Loaded ${records.length} CIDR ranges for ${this.cidrRanges.size} clients`);
    } catch (error) {
      console.error(`Error reading CIDR file: ${error.message}`);
    }
  }

  /**
   * Load learned IPs from CSV file
   * @private
   */
  _loadLearnedIps() {
    try {
      if (!fs.existsSync(this.learnedIpsFile)) {
        console.info('No learned IPs file found, will be created on first use');
        this._ensureLearnedIpsFileExists();
        return;
      }

      const fileContent = fs.readFileSync(this.learnedIpsFile, 'utf-8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      this.learnedIps.clear();

      for (const row of records) {
        const ip = row.ip_address?.trim();
        if (!ip) continue;

        this.learnedIps.set(ip, {
          clientName: row.client_name.trim(),
          firstSeen: row.first_seen,
          lastSeen: row.last_seen,
          requestCount: parseInt(row.request_count) || 0
        });
      }

      console.info(`Loaded ${this.learnedIps.size} learned IP addresses`);
    } catch (error) {
      console.error(`Error reading learned IPs file: ${error.message}`);
    }
  }

  /**
   * Ensure learned IPs CSV exists with proper headers
   * @private
   */
  _ensureLearnedIpsFileExists() {
    try {
      if (!fs.existsSync(this.learnedIpsFile)) {
        const headers = 'client_name,ip_address,first_seen,last_seen,request_count\n';
        fs.writeFileSync(this.learnedIpsFile, headers, 'utf-8');
        console.info(`Created ${this.learnedIpsFile}`);
      }
    } catch (error) {
      console.error(`Error creating learned IPs file: ${error.message}`);
    }
  }

  /**
   * Save CIDR ranges to CSV file
   * @private
   */
  _saveCIDRRanges() {
    try {
      const records = [];
      
      for (const [clientName, ranges] of this.cidrRanges.entries()) {
        for (const range of ranges) {
          records.push({
            client_name: clientName,
            cidr_range: range.cidr,
            request_count: range.requestCount
          });
        }
      }

      records.sort((a, b) => {
        const nameCompare = a.client_name.localeCompare(b.client_name);
        if (nameCompare !== 0) return nameCompare;
        return a.cidr_range.localeCompare(b.cidr_range);
      });

      const csvContent = stringify(records, {
        header: true,
        columns: ['client_name', 'cidr_range', 'request_count']
      });

      fs.writeFileSync(this.cidrFile, csvContent, 'utf-8');
      console.info(`Saved ${records.length} CIDR ranges`);
    } catch (error) {
      console.error(`Error saving CIDR file: ${error.message}`);
    }
  }

  /**
   * Save learned IPs to CSV file
   * @private
   */
  _saveLearnedIps() {
    try {
      const records = [];
      
      for (const [ip, data] of this.learnedIps.entries()) {
        records.push({
          client_name: data.clientName,
          ip_address: ip,
          first_seen: data.firstSeen,
          last_seen: data.lastSeen,
          request_count: data.requestCount
        });
      }

      records.sort((a, b) => {
        const nameCompare = a.client_name.localeCompare(b.client_name);
        if (nameCompare !== 0) return nameCompare;
        return a.ip_address.localeCompare(b.ip_address);
      });

      const csvContent = stringify(records, {
        header: true,
        columns: ['client_name', 'ip_address', 'first_seen', 'last_seen', 'request_count']
      });

      fs.writeFileSync(this.learnedIpsFile, csvContent, 'utf-8');
      console.info(`Saved ${records.length} learned IPs`);
    } catch (error) {
      console.error(`Error saving learned IPs file: ${error.message}`);
    }
  }

  /**
   * Process IP for a client (after API key validation)
   * 1. Check if IP is in preconfigured CIDR range - if yes, increment count in CIDR CSV
   * 2. If not in CIDR, check learned IPs CSV - if exists, update last_seen and count
   * 3. If not in learned IPs, add new entry
   * 
   * @param {string} clientName - Name of the client (from API key validation)
   * @param {string} ipAddress - IP address to process
   */
  processIP(clientName, ipAddress) {
    if (!clientName || !ipAddress) {
      console.warn('Cannot process IP: missing clientName or ipAddress');
      return;
    }

    // Step 1: Check if IP is in preconfigured CIDR range
    if (this.cidrRanges.has(clientName)) {
      const ranges = this.cidrRanges.get(clientName);
      
      for (const range of ranges) {
        if (range.cidrObj.contains(ipAddress)) {
          // IP is in CIDR range - increment count
          range.requestCount += 1;
          console.info(`✓ IP ${ipAddress} matches CIDR ${range.cidr} for ${clientName} (count: ${range.requestCount})`);
          this._saveCIDRRanges();
          return;
        }
      }
    }

    // Step 2: IP not in CIDR range - check learned IPs
    const now = new Date().toISOString();
    
    if (this.learnedIps.has(ipAddress)) {
      // Update existing learned IP
      const existing = this.learnedIps.get(ipAddress);
      
      // Security check: warn if IP switched clients
      if (existing.clientName !== clientName) {
        console.warn(
          `⚠️  IP ${ipAddress} previously used by ${existing.clientName}, now used by ${clientName}`
        );
      }
      
      existing.clientName = clientName;
      existing.lastSeen = now;
      existing.requestCount += 1;
      
      console.info(`Updated learned IP ${ipAddress} for ${clientName} (count: ${existing.requestCount})`);
    } else {
      // Step 3: Add new learned IP
      this.learnedIps.set(ipAddress, {
        clientName: clientName,
        firstSeen: now,
        lastSeen: now,
        requestCount: 1
      });
      
      console.info(`✓ Added new learned IP ${ipAddress} for ${clientName}`);
    }

    this._saveLearnedIps();
  }

  /**
   * Get statistics about CIDR ranges and learned IPs
   * @returns {Object} Statistics
   */
  getStatistics() {
    const cidrStats = new Map();
    let totalCIDRRequests = 0;

    for (const [clientName, ranges] of this.cidrRanges.entries()) {
      let clientTotal = 0;
      for (const range of ranges) {
        clientTotal += range.requestCount;
        totalCIDRRequests += range.requestCount;
      }
      cidrStats.set(clientName, { ranges: ranges.length, requests: clientTotal });
    }

    const learnedStats = new Map();
    let totalLearnedRequests = 0;

    for (const [, data] of this.learnedIps.entries()) {
      const current = learnedStats.get(data.clientName) || { ips: 0, requests: 0 };
      current.ips += 1;
      current.requests += data.requestCount;
      learnedStats.set(data.clientName, current);
      totalLearnedRequests += data.requestCount;
    }

    return {
      cidr: {
        totalRanges: Array.from(this.cidrRanges.values()).reduce((sum, ranges) => sum + ranges.length, 0),
        totalRequests: totalCIDRRequests,
        byClient: Object.fromEntries(cidrStats)
      },
      learned: {
        totalIPs: this.learnedIps.size,
        totalRequests: totalLearnedRequests,
        byClient: Object.fromEntries(learnedStats)
      }
    };
  }

  /**
   * Reload all IP data from files
   */
  reloadAll() {
    const oldCIDRCount = Array.from(this.cidrRanges.values()).reduce((sum, ranges) => sum + ranges.length, 0);
    const oldLearnedCount = this.learnedIps.size;
    
    this._loadCIDRRanges();
    this._loadLearnedIps();
    
    const newCIDRCount = Array.from(this.cidrRanges.values()).reduce((sum, ranges) => sum + ranges.length, 0);
    const newLearnedCount = this.learnedIps.size;
    
    console.info(`CIDR ranges reloaded: ${oldCIDRCount} -> ${newCIDRCount}`);
    console.info(`Learned IPs reloaded: ${oldLearnedCount} -> ${newLearnedCount}`);
  }
}

export default IPManager;
