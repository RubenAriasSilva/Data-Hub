async function request(method, url, body) {
  const init = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${url}`, init);
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((isJson && data?.error) || `Error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

/** URL pública de la API para mostrar a otras aplicaciones. */
export function publicApiBase() {
  if (import.meta.env.VITE_PUBLIC_API_URL) return import.meta.env.VITE_PUBLIC_API_URL.replace(/\/$/, '');
  const { protocol, hostname, origin } = window.location;
  return import.meta.env.DEV ? `${protocol}//${hostname}:4000` : origin;
}
