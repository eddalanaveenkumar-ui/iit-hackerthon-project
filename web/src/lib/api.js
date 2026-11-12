const TOKEN_KEY = 'learnmate.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * API origin.
 *
 * Defaults to an empty string so every request is same-origin and relative:
 * in local dev the Vite proxy forwards /api to :3001, and in a single-service
 * deployment Express serves both the SPA and the API.
 *
 * When the API lives on a different host (e.g. the SPA on Vercel and the API
 * on Render), set VITE_API_BASE_URL at build time, e.g.
 *   VITE_API_BASE_URL=https://learnmate-api.onrender.com
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const apiUrl = (path) => `${API_BASE}/api${path}`;

/** Single API entry point. */
export async function api(path, { method = 'GET', body, headers = {}, signal, raw = false } = {}) {
  const token = getToken();
  const isForm = body instanceof FormData;
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(isForm ? {} : body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    signal,
  });

  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new CustomEvent('learnmate:unauthorized'));
  }

  let payload = null;
  const text = await res.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (raw) return { status: res.status, body: payload, ok: res.ok };

  if (!res.ok) {
    const err = payload?.error || {};
    throw new ApiError(err.message || `Request failed (${res.status})`, res.status, err.code, err.details);
  }
  return payload;
}

export const apiGet = (path, opts) => api(path, opts);
export const apiPost = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const apiPatch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
export const apiPut = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });
export const apiDelete = (path, opts) => api(path, { ...opts, method: 'DELETE' });
