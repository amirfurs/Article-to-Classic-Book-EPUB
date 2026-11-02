/**
 * ReadCast API client
 * Built with resilient JSON parsing that gracefully handles non-JSON / serverless error responses.
 */

async function parseResponse(res, fallbackError = 'Request failed') {
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    // Non-JSON response (e.g. serverless error page or plain text 500)
    if (!res.ok) {
      throw new Error(text || `${fallbackError} (Status: ${res.status})`);
    }
  }

  if (!res.ok) {
    throw new Error((data && data.error) || text || `${fallbackError} (Status: ${res.status})`);
  }

  return data || {};
}

export const api = {
  async extractArticle(url) {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await parseResponse(res, 'Article extraction failed');
    return data.article;
  },

  async convertArticle(params) {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return await parseResponse(res, 'Conversion to EPUB failed');
  },

  async bundleArticles(params) {
    const res = await fetch('/api/bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return await parseResponse(res, 'Digest bundling failed');
  },

  async getLibrary(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/library?${query}`);
    return await parseResponse(res, 'Failed to load library');
  },

  async deleteFromLibrary(id) {
    const res = await fetch(`/api/library/${id}`, { method: 'DELETE' });
    return await parseResponse(res, 'Failed to delete EPUB');
  },

  async getQrCode(id) {
    const res = await fetch(`/api/qr/${id}`);
    return await parseResponse(res, 'Failed to get QR code');
  },

  async sendToKindle(id, kindleEmail) {
    const res = await fetch('/api/kindle/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, kindleEmail })
    });
    return await parseResponse(res, 'Failed to send to Kindle');
  },

  async getSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await parseResponse(res, 'Failed to load settings');
      return data.settings || {};
    } catch (e) {
      return {};
    }
  },

  async updateSettings(settings) {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    const data = await parseResponse(res, 'Failed to update settings');
    return data.settings;
  },

  async getStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await parseResponse(res, 'Failed to load stats');
      return data.stats || { totalConversions: 0, totalWords: 0, kindleDeliveries: 0 };
    } catch (e) {
      return { totalConversions: 0, totalWords: 0, kindleDeliveries: 0 };
    }
  }
};
