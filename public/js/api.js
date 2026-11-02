/**
 * ReadCast API client
 */
export const api = {
  async extractArticle(url) {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Extraction failed');
    return data.article;
  },

  async convertArticle(params) {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Conversion failed');
    return data;
  },

  async bundleArticles(params) {
    const res = await fetch('/api/bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bundling failed');
    return data;
  },

  async getLibrary(params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await fetch(`/api/library?${query}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load library');
    return data;
  },

  async deleteFromLibrary(id) {
    const res = await fetch(`/api/library/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete');
    return data;
  },

  async getQrCode(id) {
    const res = await fetch(`/api/qr/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get QR code');
    return data;
  },

  async sendToKindle(id, kindleEmail) {
    const res = await fetch('/api/kindle/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, kindleEmail })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send to Kindle');
    return data;
  },

  async getSettings() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    return data.settings;
  },

  async updateSettings(settings) {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    const data = await res.json();
    return data.settings;
  },

  async getStats() {
    const res = await fetch('/api/stats');
    const data = await res.json();
    return data.stats;
  }
};
