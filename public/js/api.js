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

async function buildAuthHeaders(base = {}) {
  const headers = { ...base };

  try {
    if (!window.prelabAuth?.init) return headers;
    await window.prelabAuth.init();
    const client = window.prelabAuth?.client;
    if (!client) return headers;

    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch (_error) {
    // Public pages may not have an auth session yet.
  }

  return headers;
}

window.api = {
  async get(path) {
    const headers = await buildAuthHeaders();
    const res = await fetch(`${window.PRELAB_CONFIG.apiBase}${path}`, { headers });
    return parseApiResponse(res);
  },
  async post(path, body) {
    const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
    const res = await fetch(`${window.PRELAB_CONFIG.apiBase}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    return parseApiResponse(res);
  },
  async postForm(path, formData) {
    const headers = await buildAuthHeaders();
    const res = await fetch(`${window.PRELAB_CONFIG.apiBase}${path}`, {
      method: 'POST',
      headers,
      body: formData
    });
    return parseApiResponse(res);
  },
  async patch(path, body) {
    const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
    const res = await fetch(`${window.PRELAB_CONFIG.apiBase}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body)
    });
    return parseApiResponse(res);
  },
  async del(path) {
    const headers = await buildAuthHeaders();
    const res = await fetch(`${window.PRELAB_CONFIG.apiBase}${path}`, { method: 'DELETE', headers });
    return parseApiResponse(res);
  }
};
