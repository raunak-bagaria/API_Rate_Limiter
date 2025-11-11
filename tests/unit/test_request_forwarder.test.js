import { jest, describe, it, expect } from '@jest/globals';
import RequestForwarder from '../../src/RequestForwarder.js';

const fetchMock = jest.fn();

function makeResponse(bodyString, { status = 200, contentType = 'application/json' } = {}) {
  return {
    status,
    headers: {
      get: (k) => (k && k.toLowerCase() === 'content-type' ? contentType : undefined),
      entries: () => [['content-type', contentType]]
    },
    text: async () => bodyString
  };
}

describe('RequestForwarder', () => {
  const forwarder = new RequestForwarder(fetchMock);

  it('forwards GET', async () => {
    fetchMock.mockResolvedValue(makeResponse('{"ok":true}'));
    const res = await forwarder.forwardRequest('https://example.com', 'GET', {});
    expect(res.status).toBe(200);
  });

  it('forwards POST with JSON body serialization', async () => {
    fetchMock.mockImplementation(async (url, options) => {
      expect(options.method).toBe('POST');
      // Body should be stringified JSON
      expect(typeof options.body).toBe('string');
      const payload = JSON.parse(options.body);
      expect(payload.msg).toBe('hello');
      return makeResponse('{"received":true}', { status: 201 });
    });
    const res = await forwarder.forwardRequest('https://example.com/create', 'POST', { 'content-type': 'application/json' }, { msg: 'hello' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
  });

  it('handles non-JSON content gracefully', async () => {
    fetchMock.mockResolvedValue(makeResponse('<html>ok</html>', { contentType: 'text/html' }));
    const res = await forwarder.forwardRequest('https://example.com/page', 'GET', {});
    expect(res.body).toContain('html');
  });

  it('returns 502 on fetch error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const res = await forwarder.forwardRequest('https://bad.example.com', 'GET', {});
    expect(res.status).toBe(502);
    expect(res.error).toMatch(/Bad Gateway/);
  });

  it('does not send body for HEAD request', async () => {
    fetchMock.mockImplementation(async (url, options) => {
      expect(options.body).toBeUndefined();
      return makeResponse('', { status: 204 });
    });
    const res = await forwarder.forwardRequest('https://example.com/meta', 'HEAD', {}, { ignored: true });
    expect(res.status).toBe(204);
  });
});
