import { jest, describe, it, expect } from '@jest/globals';
import RequestForwarder from '../src/RequestForwarder.js';

// Use an injectable fetch mock (jest.fn) and pass into RequestForwarder
const fetchMock = jest.fn();

// Helper to create a minimal Response-like object for tests
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

  it('should forward GET request and preserve headers', async () => {
    const mockHeaders = { 'x-api-key': '12345', 'content-type': 'application/json' };
    const mockResponse = makeResponse(JSON.stringify({ success: true }), { status: 200 });
  fetchMock.mockResolvedValue(mockResponse);

    const result = await forwarder.forwardRequest('https://example.com/data', 'GET', mockHeaders);

  expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/data',
      expect.objectContaining({
        method: 'GET',
        headers: mockHeaders
      })
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true });
  });

  it('should forward POST request with body', async () => {
    const mockResponse = makeResponse(JSON.stringify({ id: 100 }), { status: 201 });
  fetchMock.mockResolvedValue(mockResponse);

    const result = await forwarder.forwardRequest(
      'https://example.com/create',
      'POST',
      { 'content-type': 'application/json' },
      { name: 'test' }
    );

    expect(result.status).toBe(201);
    expect(result.body).toEqual({ id: 100 });
  });

  it('should preserve API error responses (4xx/5xx)', async () => {
    const mockErrorResponse = makeResponse(JSON.stringify({ error: 'Not Found' }), { status: 404 });
  fetchMock.mockResolvedValue(mockErrorResponse);

    const result = await forwarder.forwardRequest('https://example.com/unknown', 'GET');

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Not Found' });
  });

  it('should handle network errors gracefully', async () => {
  fetchMock.mockRejectedValue(new Error('Network unreachable'));

    const result = await forwarder.forwardRequest('https://badserver.com', 'GET');

    expect(result.status).toBe(502);
    expect(result.error).toContain('Bad Gateway');
  });
});