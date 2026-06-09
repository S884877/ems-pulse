// API base: window.__PULSE_API__ set in runtimeconfig.js (production)
// Falls back to localhost for local dev
function getApiBase() {
  if (window.__PULSE_API__) return window.__PULSE_API__;
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || window.location.protocol === 'file:') {
    return 'http://localhost:8000/api';
  }
  return '/api';
}

export const API_BASE = getApiBase();

export async function apiGet(path, params = {}) {
  const base = getApiBase();
  const url = new URL(`${base}${path}`, window.location.href);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function apiPost(path, body) {
  const base = getApiBase();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}
