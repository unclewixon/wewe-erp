export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const b = await res.json(); msg = b.message ?? b.error ?? msg; } catch { /* noop */ }
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('; ') : String(msg));
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
};

export interface User {
  id: string; email: string; name: string; title: string | null;
  departmentId: string | null; departmentName: string | null;
  roles: { code: string; departmentId: string | null }[];
}
