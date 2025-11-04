// src/AlertManager.js
export default class AlertManager {
  constructor({ emailService, slackService, webhookService, auditLogger, dedupeMs = 5 * 60 * 1000 } = {}) {
    // services can be supplied or left undefined; we'll treat missing services as no-ops
    this.emailService = emailService || { send: async () => {} };
    this.slackService = slackService || { send: async () => {} };
    this.webhookService = webhookService || { send: async () => {} };
    this.auditLogger = auditLogger || { log: async () => {} };
    this.dedupeMs = dedupeMs;
    this.lastAlertTimestamps = new Map(); // { clientId-policyId: timestamp }
  }

  /**
   * Evaluates client usage and triggers alerts if >= 80% of limit.
   * Returns false when no alert is sent, otherwise returns the payload object.
   */
  async checkAndAlert(clientId, policyId, limit, used, limitWindow) {
    // Basic input validation
    const now = Date.now();
    const key = `${clientId}-${policyId}`;

    if (typeof limit !== 'number' || typeof used !== 'number' || Number.isNaN(limit) || Number.isNaN(used)) {
      // invalid inputs — do not throw to keep callers resilient, just skip alerting
      return false;
    }

    if (limit <= 0) {
      // avoid division by zero / negative limits
      return false;
    }

    const usagePercent = (used / limit) * 100;
    if (usagePercent < 80) return false; // below threshold

    // Deduplicate alerts for this client+policy
    const last = this.lastAlertTimestamps.get(key);
    if (last && now - last < this.dedupeMs) return false;

    const remaining = limit - used;
    const payload = {
      clientId,
      policyId,
      limitWindow,
      usagePercent: Math.round(usagePercent),
      remaining,
      timestamp: new Date(now).toISOString(),
      suggestedRemediation: 'Consider upgrading your rate plan or reducing request frequency.'
    };

    // Notify external channels. Use allSettled so a single notification failure
    // doesn't prevent other notifications or the audit log.
    const results = await Promise.allSettled([
      this.emailService.send(payload),
      this.slackService.send(payload),
      this.webhookService.send(payload)
    ]);

    // Attempt audit logging; never throw from here — log failures to console
    try {
      await this.auditLogger.log(payload);
    } catch (err) {
      // do not fail the whole operation if audit logging fails
      // keep a console.error so problems are visible in logs
      // eslint-disable-next-line no-console
      console.error('AlertManager: auditLogger.log failed:', err && err.message ? err.message : err);
    }

    // record timestamp only when we attempted to send alerts
    this.lastAlertTimestamps.set(key, now);

    // attach notification errors (if any) to payload for callers who want diagnostics
    const errors = results.filter(r => r.status === 'rejected').map(r => (r.reason && r.reason.message) || String(r.reason));
    if (errors.length > 0) payload.note = { notificationErrors: errors };

    return payload;
  }
}