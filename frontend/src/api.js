const SESSION_TOKEN_KEY = 'crud_session_token';

export function setSessionToken(token) {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearSessionToken() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

export async function api(path, options = {}) {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) clearSessionToken();
    const body = await response.json().catch(() => ({}));
    const detail = Array.isArray(body.detail) ? body.detail[0]?.msg : body.detail;
    const error = new Error(detail || '요청을 처리하지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
