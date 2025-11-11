/**
 * System Integration Tests
 */
import request from 'supertest';
import app from '../../src/app.js';

describe('System Integration', () => {
  test('health endpoint', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'healthy');
  });
});
