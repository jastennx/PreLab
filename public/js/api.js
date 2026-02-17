async function parseApiResponse(res) {
  const raw = await res.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (_error) {
      data = null;
    }
  }

  if (!res.ok) {
    const serverMessage = data?.error || data?.message;
    if (serverMessage) throw new Error(serverMessage);

    const snippet = raw ? raw.slice(0, 140) : '';
    throw new Error(`HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`);
  }

  return data || {};
}

window.api = {
  async get(path) {
    const res = await fetch(`${window.PRELAB_CONFIG.apiBase}${path}`);
    return parseApiResponse(res);
  },
  async post(path, body) {
    const res = await fetch(`${window.PRELAB_CONFIG.apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return parseApiResponse(res);
  },
  async postForm(path, formData) {
    const res = await fetch(`${window.PRELAB_CONFIG.apiBase}${path}`, {
      method: 'POST',
      body: formData
    });
    return parseApiResponse(res);
  },
  async del(path) {
    const res = await fetch(`${window.PRELAB_CONFIG.apiBase}${path}`, { method: 'DELETE' });
    return parseApiResponse(res);
  }
};
