/**
 * ConfigManager: Hot-reload configuration management with validation and rollback
 * 
 * Features:
 * - File watching with debouncing (changes propagate within 30 seconds)
 * - Config validation (syntax & semantics) before applying
 * - Version history and rollback capability
 * - No service interruption during updates
 * - Event-based notification system for config changes
 * - Atomic updates to prevent partial/corrupted configurations
 * 
 * Usage:
 * const configManager = new ConfigManager(policyFile, validator);
 * configManager.on('configChanged', (newConfig) => { ... });
 * configManager.startWatching();
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

/**
 * Configuration version snapshot
 */
class ConfigVersion {
  constructor(config, timestamp = Date.now(), healthy = true) {
    this.version = timestamp;
    this.config = JSON.parse(JSON.stringify(config)); // Deep copy
    this.timestamp = timestamp;
    this.healthy = healthy;
    this.appliedAt = new Date(timestamp).toISOString();
  }

  toJSON() {
    return {
      version: this.version,
      timestamp: this.timestamp,
      appliedAt: this.appliedAt,
      healthy: this.healthy,
      configHash: this._hashConfig()
    };
  }

  _hashConfig() {
    // Simple hash for comparing configs
    const str = JSON.stringify(this.config);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }
}

/**
 * ConfigManager class for hot-reloading configurations
 */
class ConfigManager extends EventEmitter {
  /**
   * Create a ConfigManager
   * @param {string} configFile - Path to configuration file
   * @param {Function} validator - Validation function (config) => { valid, errors, warnings }
   * @param {Object} options - Configuration options
   * @param {number} options.debounceMs - Debounce delay for file changes (default: 1000ms)
   * @param {number} options.maxVersions - Maximum number of versions to keep (default: 10)
   * @param {number} options.watchInterval - File watch poll interval (default: 1000ms)
   */
  constructor(configFile, validator, options = {}) {
    super();
    
    this.configFile = configFile;
    this.validator = validator;
    this.watchEnabled = options.watchEnabled !== false; // Default to true
    this.watchInterval = options.watchInterval || 5000; // Default 5 seconds
    this.maxVersions = options.maxVersions || 10; // Keep last 10 versions
    this.currentConfig = null;
    this.configVersions = [];
    this.watcher = null;
    this.lastModifiedTime = null;
    this.isApplyingConfig = false;
    
    // Statistics
    this.stats = {
      totalReloads: 0,
      successfulReloads: 0,
      failedReloads: 0,
      totalRollbacks: 0,
      lastReloadTime: null,
      lastReloadStatus: null
    };
    
    // Load initial configuration (will throw if invalid)
    this._loadInitialConfig();
    
    // Start watching if enabled
    if (this.watchEnabled) {
      this.startWatching();
    }
    
    console.info(`ConfigManager initialized (watching: ${this.watchEnabled})`);
  }

  /**
   * Default validator if none provided
   * @private
   */
  _defaultValidator(config) {
    if (!Array.isArray(config)) {
      return {
        valid: false,
        errors: ['Configuration must be an array'],
        warnings: []
      };
    }
    return {
      valid: true,
      errors: [],
      warnings: []
    };
  }

  /**
   * Load initial configuration from file
   * @private
   */
  _loadInitialConfig() {
    try {
      const config = this._readConfigFile();
      
      // Validate initial config
      const validation = this.validator(config);
      if (!validation.valid) {
        throw new Error(`Invalid initial configuration: ${validation.errors.join(', ')}`);
      }
      
      if (validation.warnings && validation.warnings.length > 0) {
        console.warn('Initial config warnings:', validation.warnings.join(', '));
      }
      
      this.currentConfig = config;
      
      // Create initial version snapshot
      const version = new ConfigVersion(config);
      this.configVersions.push(version);
      
      // Store file modified time
      const stats = fs.statSync(this.configFile);
      this.lastModifiedTime = stats.mtimeMs;
      
      console.info(`Initial config loaded: ${config.length} entries (version: ${version.version})`);
    } catch (error) {
      console.error('Failed to load initial configuration:', error.message);
      throw error; // Throw error to prevent initialization with invalid config
    }
  }  /**
   * Read configuration from file
   * @private
   * @returns {Array} Parsed configuration
   */
  _readConfigFile() {
    if (!fs.existsSync(this.configFile)) {
      return [];
    }
    
    const fileContent = fs.readFileSync(this.configFile, 'utf-8');
    const config = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    return config;
  }

  /**
   * Write configuration to file
   * @private
   * @param {Array} config - Configuration to write
   */
  _writeConfigFile(config) {
    const dir = path.dirname(this.configFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
    }
    
    const csvContent = stringify(config, {
      header: true,
      columns: config.length > 0 ? Object.keys(config[0]) : ['id', 'endpoint', 'api_key', 'ip_or_cidr', 'tier', 'limit', 'window']
    });
    
    // Atomic write: write to temp file then rename
    const tempFile = `${this.configFile}.tmp`;
    fs.writeFileSync(tempFile, csvContent, { encoding: 'utf-8', mode: 0o666 });
    fs.renameSync(tempFile, this.configFile);
  }

  /**
   * Start watching configuration file for changes
   */
  startWatching() {
    if (this.watcher) {
      console.warn('Config watcher already started');
      return;
    }
    
    console.info(`Starting config file watcher for: ${this.configFile}`);
    
    // Use fs.watchFile for reliable cross-platform watching
    this.watcher = fs.watchFile(this.configFile, {
      persistent: true,
      interval: this.watchInterval
    }, (curr, prev) => {
      // Check if file was actually modified
      if (curr.mtimeMs > this.lastModifiedTime) {
        console.info(`Config file changed detected (mtime: ${new Date(curr.mtimeMs).toISOString()})`);
        this._handleFileChange();
      }
    });
    
    console.info('Config watcher started successfully');
  }

  /**
   * Stop watching configuration file
   */
  stopWatching() {
    if (this.watcher) {
      fs.unwatchFile(this.configFile);
      this.watcher = null;
      console.info('Config watcher stopped');
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Handle file change event with debouncing
   * @private
   */
  _handleFileChange() {
    // Clear existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    // Set new debounce timer
    this.debounceTimer = setTimeout(() => {
      this._reloadConfig();
    }, this.debounceMs);
  }

  /**
   * Reload configuration from file and apply if valid
   * @private
   */
  async _reloadConfig() {
    // Prevent concurrent reloads
    if (this.isApplyingConfig) {
      console.warn('Config reload already in progress, skipping');
      // Emit a skip event so waiting promises can resolve
      this.emit('configReloadSkipped', {
        reason: 'Reload already in progress'
      });
      return;
    }
    
    this.isApplyingConfig = true;
    await this._doReload();
  }
  
  /**
   * Internal reload implementation (assumes lock is already acquired)
   * @private
   */
  async _doReload() {
    const reloadStartTime = Date.now();
    
    try {
      console.info('Starting config reload...');
      
      // Read new configuration
      const newConfig = this._readConfigFile();
      
      // Validate new configuration
      const validation = this.validator(newConfig);
      
      if (!validation.valid) {
        this.stats.totalReloads++;
        this.stats.failedReloads++;
        this.stats.lastReloadStatus = 'validation_failed';
        this.stats.lastReloadTime = new Date().toISOString();
        
        console.error('Config validation failed:', validation.errors);
        this.emit('configValidationFailed', {
          errors: validation.errors,
          warnings: validation.warnings
        });
        
        return;
      }
      
      if (validation.warnings.length > 0) {
        console.warn('Config validation warnings:', validation.warnings);
      }
      
      // Check if config actually changed
      if (this._configsEqual(this.currentConfig, newConfig)) {
        console.info('Config unchanged, skipping reload');
        this.isApplyingConfig = false;
        // Emit a "no change" event so promises can resolve
        this.emit('configUnchanged', {
          version: this.getCurrentVersion(),
          entriesCount: this.currentConfig.length
        });
        return;
      }
      
      // Apply new configuration atomically
      const oldConfig = this.currentConfig;
      this.currentConfig = newConfig;
      
      // Create version snapshot
      const version = new ConfigVersion(newConfig);
      this.configVersions.push(version);
      
      // Trim old versions
      if (this.configVersions.length > this.maxVersions) {
        this.configVersions = this.configVersions.slice(-this.maxVersions);
      }
      
      // Update statistics
      this.stats.totalReloads++;
      this.stats.successfulReloads++;
      this.stats.lastReloadStatus = 'success';
      this.stats.lastReloadTime = new Date().toISOString();
      
      // Update file modified time
      const stats = fs.statSync(this.configFile);
      this.lastModifiedTime = stats.mtimeMs;
      
      const reloadDuration = Date.now() - reloadStartTime;
      console.info(`Config reloaded successfully in ${reloadDuration}ms (version: ${version.version}, entries: ${newConfig.length})`);
      
      // Emit event for listeners to update their configurations
      this.emit('configChanged', {
        newConfig: newConfig,
        oldConfig: oldConfig,
        version: version,
        warnings: validation.warnings
      });
      
    } catch (error) {
      this.stats.totalReloads++;
      this.stats.failedReloads++;
      this.stats.lastReloadStatus = 'error';
      this.stats.lastReloadTime = new Date().toISOString();
      
      console.error('Error reloading config:', error.message);
      this.emit('configReloadError', {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isApplyingConfig = false;
    }
  }

  /**
   * Check if two configurations are equal
   * @private
   */
  _configsEqual(config1, config2) {
    if (!config1 || !config2) return false;
    if (config1.length !== config2.length) return false;
    
    return JSON.stringify(config1) === JSON.stringify(config2);
  }

  /**
   * Manually trigger a configuration reload
   * @returns {Promise<Object>} Result with success status and details
   */
  async triggerReload() {
    // Try to acquire the lock atomically
    if (this.isApplyingConfig) {
      // Already in progress, return success with current state
      return {
        success: true,
        skipped: true,
        reason: 'Reload already in progress',
        version: this.getCurrentVersion()?.version,
        entriesCount: this.currentConfig.length
      };
    }
    
    // Set the lock before setting up listeners to prevent race conditions
    this.isApplyingConfig = true;
    
    return new Promise((resolve) => {
      const listener = (event) => {
        cleanup();
        resolve({
          success: true,
          version: event.version.version,
          entriesCount: event.newConfig.length,
          warnings: event.warnings
        });
      };
      
      const errorListener = (event) => {
        cleanup();
        resolve({
          success: false,
          errors: event.errors || [event.error],
          warnings: event.warnings || []
        });
      };
      
      const skipListener = (event) => {
        cleanup();
        resolve({
          success: true,
          skipped: true,
          reason: event.reason,
          version: this.getCurrentVersion()?.version,
          entriesCount: this.currentConfig.length
        });
      };
      
      const unchangedListener = (event) => {
        cleanup();
        resolve({
          success: true,
          unchanged: true,
          version: event.version?.version,
          entriesCount: event.entriesCount
        });
      };
      
      const cleanup = () => {
        this.removeListener('configChanged', listener);
        this.removeListener('configValidationFailed', errorListener);
        this.removeListener('configReloadError', errorListener);
        this.removeListener('configReloadSkipped', skipListener);
        this.removeListener('configUnchanged', unchangedListener);
      };
      
      this.once('configChanged', listener);
      this.once('configValidationFailed', errorListener);
      this.once('configReloadError', errorListener);
      this.once('configReloadSkipped', skipListener);
      this.once('configUnchanged', unchangedListener);
      
      // Now actually do the reload (flag is already set)
      this._doReload();
    });
  }

  /**
   * Validate a configuration without applying it
   * @param {Array} config - Configuration to validate
   * @returns {Object} Validation result
   */
  validateConfig(config) {
    return this.validator(config);
  }

  /**
   * Get current configuration
   * @returns {Array} Current configuration
   */
  getCurrentConfig() {
    return JSON.parse(JSON.stringify(this.currentConfig)); // Return deep copy
  }

  /**
   * Get current version information
   * @returns {Object} Current version info
   */
  getCurrentVersion() {
    if (this.configVersions.length === 0) return null;
    return this.configVersions[this.configVersions.length - 1].toJSON();
  }

  /**
   * Get configuration version history
   * @param {number} limit - Maximum number of versions to return
   * @returns {Array} Array of version info objects
   */
  getVersionHistory(limit = 10) {
    const versions = this.configVersions.slice(-limit);
    return versions.map(v => v.toJSON());
  }

  /**
   * Rollback to a previous configuration version
   * @param {number} version - Version timestamp to rollback to (optional, defaults to previous version)
   * @returns {Object} Result with success status
   */
  async rollback(version = null) {
    try {
      let targetVersion;
      
      if (version === null) {
        // Rollback to previous version
        if (this.configVersions.length < 2) {
          return {
            success: false,
            error: 'No previous version available for rollback'
          };
        }
        targetVersion = this.configVersions[this.configVersions.length - 2];
      } else {
        // Rollback to specific version
        targetVersion = this.configVersions.find(v => v.version === version);
        if (!targetVersion) {
          return {
            success: false,
            error: `Version ${version} not found in history`
          };
        }
      }
      
      console.info(`Rolling back to version ${targetVersion.version}...`);
      
      // Validate the old config (should be valid, but check anyway)
      const validation = this.validator(targetVersion.config);
      if (!validation.valid) {
        return {
          success: false,
          error: `Rollback target version is invalid: ${validation.errors.join(', ')}`
        };
      }
      
      // Apply rollback configuration immediately
      const oldConfig = this.currentConfig;
      this.currentConfig = JSON.parse(JSON.stringify(targetVersion.config)); // Deep copy
      
      // Create new version snapshot for the rollback
      const newVersion = new ConfigVersion(this.currentConfig);
      this.configVersions.push(newVersion);
      
      // Trim old versions
      if (this.configVersions.length > this.maxVersions) {
        this.configVersions = this.configVersions.slice(-this.maxVersions);
      }
      
      // Write the config to file (to persist the rollback)
      this._writeConfigFile(this.currentConfig);
      
      // Update statistics
      this.stats.totalRollbacks++;
      
      console.info(`Rolled back to version ${targetVersion.version} successfully`);
      
      // Emit event for listeners
      this.emit('configChanged', {
        newConfig: this.currentConfig,
        oldConfig: oldConfig,
        version: newVersion,
        warnings: [],
        isRollback: true
      });
      
      return {
        success: true,
        version: newVersion.version,
        entriesCount: this.currentConfig.length
      };
      
    } catch (error) {
      console.error('Error during rollback:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get statistics
   * @returns {Object} Statistics object
   */
  getStatistics() {
    return {
      ...this.stats,
      currentVersion: this.getCurrentVersion(),
      totalVersions: this.configVersions.length,
      isWatching: this.watcher !== null,
      configFile: this.configFile
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.stopWatching();
    this.removeAllListeners();
    console.info('ConfigManager destroyed');
  }
}

export default ConfigManager;
