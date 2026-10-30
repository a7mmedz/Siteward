import type {
  ApiErrorBody,
  ChecklistTemplate,
  InspectionDto,
  OpResult,
  OutboxOp,
  Site,
  User,
} from './types';

export const API_URL: string = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api'
).replace(/\/$/, '');

const TOKEN_KEY = 'siteward.token';

/** The JWT lives in localStorage (see docs/decisions.md: client storage). */
export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/**
 * `network`: the request never got an HTTP response (offline, DNS, CORS, server down).
 * `http`: the server answered with an error status.
 */
export class ApiError extends Error {
  constructor(
    public readonly kind: 'network' | 'http',
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }

  get isAuth() {
    return this.status === 401;
  }

  /** Worth retrying later without changing anything. */
  get isTransient() {
    return this.kind === 'network' || this.status >= 500 || this.status === 429;
  }
}

export type Fetch = typeof fetch;

export function createApi(fetchImpl: Fetch = (...args) => fetch(...args), baseUrl = API_URL) {
  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    const token = tokenStore.get();
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      throw new ApiError('network', 0, {
        code: 'NETWORK',
        message: 'Cannot reach the server. Check your connection.',
      });
    }
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      // Non-JSON body (e.g. a proxy error page).
    }
    if (!res.ok) {
      const body = (json as { error?: ApiErrorBody } | undefined)?.error ?? {
        code: `HTTP_${res.status}`,
        message: `The server answered ${res.status}`,
      };
      throw new ApiError('http', res.status, body);
    }
    return json as T;
  }

  return {
    login: (email: string, password: string) =>
      request<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      }),
    me: () => request<{ user: User }>('/auth/me'),
    sites: () => request<{ sites: Site[] }>('/sites'),
    template: () => request<{ template: ChecklistTemplate }>('/checklist-template'),
    inspections: (updatedSince?: string | null) =>
      request<{ inspections: InspectionDto[]; serverTime: string }>(
        `/inspections${updatedSince ? `?updatedSince=${encodeURIComponent(updatedSince)}` : ''}`,
      ),
    sync: (
      ops: Pick<OutboxOp, 'opId' | 'type' | 'entity' | 'entityId' | 'baseVersion' | 'payload'>[],
    ) =>
      request<{ results: OpResult[]; serverTime: string }>('/sync', {
        method: 'POST',
        body: { ops },
      }),
    /** Demo tools (supervisor, DEMO_TOOLS=true): fail the next N syncs. */
    devFailNextSync: (count: number, mode: 'before' | 'after') =>
      request<{ scheduled: number; mode: string }>('/dev/fail-next-sync', {
        method: 'POST',
        body: { count, mode },
      }),
  };
}

export type Api = ReturnType<typeof createApi>;
