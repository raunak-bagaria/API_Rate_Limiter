/**
 * RequestForwarder: Forwards approved API requests to target servers.
 * 
 * Responsibilities:
 * - Preserves headers and body from the original request
 * - Supports all HTTP methods
 * - Forwards target API responses (success or error)
 * - Handles network errors gracefully
 */

import fetch from 'node-fetch';

class RequestForwarder {
  /**
   * Create a RequestForwarder.
   * @param {Function} fetchImpl Optional fetch implementation (for DI/testing). Defaults to node-fetch.
   */
  constructor(fetchImpl = fetch) {
    this.fetch = fetchImpl;
  }
  /**
   * Forward an approved request to the target API server.
   * @param {string} targetUrl - Full URL of the target API server
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {object} headers - Request headers to preserve
   * @param {object|string|null} body - Request body content
   * @returns {Promise<object>} - Response with {status, headers, body}
   */
  async forwardRequest(targetUrl, method = 'GET', headers = {}, body = null) {
    try {
      const options = {
        method: method,
        headers: headers,
        body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : JSON.stringify(body)
      };

  const response = await this.fetch(targetUrl, options);

      const responseBody = await response.text();
      const contentType = response.headers.get('content-type');

      let parsedBody;
      try {
        parsedBody = contentType?.includes('application/json')
          ? JSON.parse(responseBody)
          : responseBody;
      } catch {
        parsedBody = responseBody;
      }

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: parsedBody
      };
    } catch (error) {
      console.error(`Error forwarding request to ${targetUrl}: ${error.message}`);
      return {
        status: 502,
        error: `Bad Gateway - ${error.message}`
      };
    }
  }
}

export default RequestForwarder;