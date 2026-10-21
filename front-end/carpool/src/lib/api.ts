// Thin fetch client for /api/v1. Sessions ride in an HttpOnly cookie, so the
// browser sends them automatically; we never store tokens in JS.
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Options = { body?: unknown; idempotencyKey?: string; signal?: AbortSignal; raw?: Blob | ArrayBuffer; contentType?: string };

export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function request<T>(method: string, path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.raw) {
    body = opts.raw;
    headers["Content-Type"] = opts.contentType || "application/octet-stream";
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body, credentials: "same-origin", signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network", "Can't reach Green Way. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown } })?.error;
    throw new ApiError(res.status, e?.code || "error", e?.message || "Something went wrong. Please try again.", e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, { signal }),
  post: <T>(path: string, body?: unknown, opts: Omit<Options, "body"> = {}) => request<T>("POST", path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, { body }),
  del: <T = void>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, file: File) => request<T>("POST", path, { raw: file, contentType: file.type || "application/octet-stream" }),
};

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
};

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Please try again.");

export const fieldErrors = (err: unknown): Record<string, string> => {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return {};
  return Object.fromEntries((err.details as { field: string; message: string }[]).map((d) => [d.field, d.message]));
};
