import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { fileURLToPath } from 'url';
import CIDR from 'ip-cidr';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class AdminBlockManager {
  constructor(blocksFile = 'admin_blocks.csv', auditFile = 'admin_block_audit.csv') {
    this.blocksFile = path.isAbsolute(blocksFile) ? blocksFile : path.join(__dirname, blocksFile);
    this.auditFile = path.isAbsolute(auditFile) ? auditFile : path.join(__dirname, auditFile);
    this.blocks = new Map();
    this._loadBlocks();
  }

  _loadBlocks() {
    try {
      if (!fs.existsSync(this.blocksFile)) return;
      const raw = fs.readFileSync(this.blocksFile, 'utf8');
      const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
      this.blocks.clear();
      for (const r of records) {
        const source = r.source?.trim();
        if (!source) continue;
        const expiry = r.expiry ? parseInt(r.expiry) : null;
        this.blocks.set(source, {
          type: r.type || 'ip',
          reason: r.reason || '',
          addedDate: r.addedDate || r.added_date || new Date().toISOString(),
          expiry: expiry,
          addedBy: r.addedBy || r.added_by || ''
        });
      }
    } catch (err) {
      console.error('AdminBlockManager: _loadBlocks error', err && err.message ? err.message : err);
    }
  }

  _saveBlocks() {
    try {
      const records = [];
      for (const [source, v] of this.blocks.entries()) {
        records.push({
          source,
          type: v.type,
          reason: v.reason,
          addedDate: v.addedDate,
          expiry: v.expiry || '',
          addedBy: v.addedBy || ''
        });
      }
      records.sort((a, b) => a.source.localeCompare(b.source));
      const csv = stringify(records, { header: true });
      fs.writeFileSync(this.blocksFile, csv, 'utf8');
    } catch (err) {
      console.error('AdminBlockManager: _saveBlocks error', err && err.message ? err.message : err);
    }
  }

  _appendAudit(action, source, type, by, reason, expiry) {
    try {
      const line = {
        action,
        source,
        type,
        by,
        reason: reason || '',
        timestamp: new Date().toISOString(),
        expiry: expiry || ''
      };
      const exists = fs.existsSync(this.auditFile);
      const csv = stringify([line], { header: !exists });
      fs.appendFileSync(this.auditFile, csv, 'utf8');
    } catch (err) {
      console.error('AdminBlockManager: _appendAudit error', err && err.message ? err.message : err);
    }
  }

  block(source, type = 'ip', addedBy = 'admin', reason = '', durationMs = null) {
    if (!source) return false;
    const now = Date.now();
    const expiry = typeof durationMs === 'number' && durationMs > 0 ? now + durationMs : null;
    const t = type === 'apiKey' ? 'apiKey' : (type === 'cidr' ? 'cidr' : 'ip');
    this.blocks.set(source, {
      type: t,
      reason,
      addedDate: new Date(now).toISOString(),
      expiry,
      addedBy
    });
    this._saveBlocks();
    this._appendAudit('block', source, t, addedBy, reason, expiry);
    return true;
  }

  unblock(source, removedBy = 'admin', reason = '') {
    if (!this.blocks.has(source)) return false;
    const entry = this.blocks.get(source);
    this.blocks.delete(source);
    this._saveBlocks();
    this._appendAudit('unblock', source, entry.type, removedBy, reason, '');
    return true;
  }

  _purgeExpired() {
    const now = Date.now();
    let changed = false;
    for (const [source, v] of Array.from(this.blocks.entries())) {
      if (v.expiry && v.expiry <= now) {
        this.blocks.delete(source);
        changed = true;
        this._appendAudit('expired', source, v.type, 'system', 'auto-expire', v.expiry);
      }
    }
    if (changed) this._saveBlocks();
  }

  isBlocked(sourceToCheck) {
    this._purgeExpired();
    if (!sourceToCheck) return false;
    const exact = this.blocks.get(sourceToCheck);
    if (exact) return true;
    for (const [key, v] of this.blocks.entries()) {
      if (v.type === 'cidr') {
        try {
          const cidr = new CIDR(key);
          if (cidr.contains(sourceToCheck)) return true;
        } catch (err) {
          // ignore invalid CIDR rows in persisted CSV
        }
      }
    }
    return false;
  }

  listBlocks() {
    this._purgeExpired();
    const out = [];
    for (const [source, v] of this.blocks.entries()) out.push({ source, ...v });
    return out;
  }
}

export default AdminBlockManager;
