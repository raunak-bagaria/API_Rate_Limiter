import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import AlertManager from '../../src/AlertManager.js';

describe('AlertManager', () => {
  let alertManager, mockEmail, mockSlack, mockWebhook, mockAudit;

  beforeEach(() => {
    mockEmail = { send: jest.fn() };
    mockSlack = { send: jest.fn() };
    mockWebhook = { send: jest.fn() };
    mockAudit = { log: jest.fn() };

    alertManager = new AlertManager({
      emailService: mockEmail,
      slackService: mockSlack,
      webhookService: mockWebhook,
      auditLogger: mockAudit
    });
  });

  test('should trigger alerts when usage >= 80%', async () => {
    const result = await alertManager.checkAndAlert('clientA', 'policy1', 100, 85, '1m');
    expect(mockEmail.send).toHaveBeenCalled();
    expect(mockSlack.send).toHaveBeenCalled();
    expect(mockWebhook.send).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'clientA',
      usagePercent: 85
    }));
    expect(result.usagePercent).toBe(85);
  });

  test('should not trigger alert when usage < 80%', async () => {
    const result = await alertManager.checkAndAlert('clientA', 'policy1', 100, 50, '1m');
    expect(result).toBe(false);
    expect(mockEmail.send).not.toHaveBeenCalled();
  });
});
