/**
 * APIKeyManager: Handles API key-based client identification.
 * 
 * IMPORTANT NOTES FOR DEVELOPERS:
 * - Do not configure logging here. Logging should be configured in the main application (app.js)
 * - clients.csv must have headers: api_key,client_name,classification
 * - API keys should never be logged in plain text
 * - If clients.csv changes, server needs restart or call reloadClients()
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class APIKeyManager {
  /**
   * Initialize APIKeyManager
   * @param {string} clientsFile - Path to CSV file containing client API key data
   */
  constructor(clientsFile = 'clients.csv') {
    this.clientsFile = path.join(__dirname, clientsFile);
    this.clients = new Map();
    this._loadClients();
  }

  /**
   * Load client data from CSV file into a Map
   * Uses API key as the map key for O(1) lookup
   * @private
   */
  _loadClients() {
    try {
      const fileContent = fs.readFileSync(this.clientsFile, 'utf-8');
      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      // Check for required columns
      const requiredColumns = ['api_key', 'client_name', 'classification'];
      if (records.length > 0) {
        const firstRecord = records[0];
        const missingColumns = requiredColumns.filter(col => !(col in firstRecord));
        
        if (missingColumns.length > 0) {
          console.error(`Required columns missing in clients.csv: ${missingColumns.join(', ')}`);
          return;
        }
      }

      this.clients.clear();

      for (const row of records) {
        const apiKey = row.api_key?.trim();
        
        if (!apiKey) {
          console.warn('Empty API key found in clients.csv, skipping row');
          continue;
        }

        if (this.clients.has(apiKey)) {
          console.warn(`Duplicate API key found in clients.csv, keeping first occurrence`);
          continue;
        }

        this.clients.set(apiKey, {
          clientName: row.client_name.trim(),
          classification: row.classification.trim()
        });
      }

      console.info(`Loaded ${this.clients.size} API key clients`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error(`clients.csv not found at ${this.clientsFile} - API key validation will fail`);
      } else {
        console.error(`Error reading clients.csv: ${error.message}`);
      }
    }
  }

  /**
   * Validate the provided API key
   * @param {string} apiKey - The API key to validate
   * @returns {Object} Validation result with client data or error
   */
  validateKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      return {
        valid: false,
        error: { message: 'Invalid API key format' }
      };
    }

    const trimmedKey = apiKey.trim();

    // Check if API key exists
    if (!this.clients.has(trimmedKey)) {
      return {
        valid: false,
        error: { message: 'API key not found' }
      };
    }

    const clientData = this.clients.get(trimmedKey);

    // Return successful validation
    return {
      valid: true,
      clientName: clientData.clientName,
      classification: clientData.classification,
      identificationMethod: 'api_key'
    };
  }

  /**
   * Reload client data from CSV file without restarting the server
   */
  reloadClients() {
    const oldCount = this.clients.size;
    this._loadClients();
    const newCount = this.clients.size;
    console.info(`API key clients reloaded: ${oldCount} -> ${newCount}`);
  }

  /**
   * Get the number of registered clients
   * @returns {number} Total client count
   */
  getClientCount() {
    return this.clients.size;
  }
}

export default APIKeyManager;