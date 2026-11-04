import type { ApiErrorBody, AuthResponse, ErrorCode } from '@tracado/shared';

export const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Token de acesso só em memória; o refresh fica em cookie httpOnly. */
let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
const listeners = new Set<(r: AuthResponse | null) => void>();

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function getAccessToken() {
  return accessToken;
}
export function onSessionChange(fn: (r: AuthResponse | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-tracado-csrf': '1' },
      });
      if (!res.ok) {
        accessToken = null;
        listeners.forEach((l) => l(null));
        return null;
      }
      const body = (await res.json()) as AuthResponse;
      accessToken = body.accessToken;
      listeners.forEach((l) => l(body));
      return body;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      signal: init.signal,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        'x-tracado-csrf': '1',
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  let res: Response;
  try {
    res = await doFetch();
    if (res.status === 401 && accessToken) {
      // Token expirado: renova uma vez e repete.
      const r = await refreshSession();
      if (r) res = await doFetch();
    }
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL',
      err?.message ?? `Erro ${res.status}`,
      err?.details,
    );
  }
  return data as T;
}

export const get = <T>(p: string) => api<T>(p);
export const post = <T>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const patch = <T>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const del = <T>(p: string) => api<T>(p, { method: 'DELETE' });

export const ERROR_TEXT: Partial<Record<string, string>> = {
  RACE_FULL: 'Corrida lotada e fila de espera completa.',
  REGISTRATION_CLOSED: 'As inscrições não estão abertas.',
  TRACE_WINDOW_CLOSED: 'A janela de traçado está fechada.',
  TRACE_OUT_OF_BOUNDS: 'Há pontos fora da pista.',
  SETUP_LOCKED: 'Parque fechado: o setup está travado.',
  NETWORK: 'Sem conexão com o servidor.',
};
export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? (ERROR_TEXT[e.code] ?? e.message) : 'Algo deu errado.';
