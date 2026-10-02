import "server-only";

/**
 * Server-side core proxy helpers (promotion ADR-029, R3: all AI through
 * syllabai-core — this repo holds no LLM keys).
 *
 * The /api/ai/* routes forward the signed-in learner's JWT to core and
 * adapt between the hub's client contracts (SSE chat, demo CLA contexts)
 * and core's REST DTOs. Errors pass through with their status so the
 * client renders the same honest verdicts the workbench does.
 */

/** Core origin, server-side only. SYLLABAI_CORE_BASE_URL wins; the public
 *  base URL is the same value in every deployment we run. */
export function coreBaseUrl(): string | null {
  const raw =
    process.env.SYLLABAI_CORE_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!raw) return null;
  return raw.replace(/\/$/, "").replace(/\/api\/v1$/, "");
}

export class CoreProxyError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail: string,
  ) {
    super(detail);
  }
}

export interface CoreFetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  errorBody: unknown;
}

/** Authenticated server-side call against core; never throws for HTTP
 *  verdicts — returns them so routes can map status → client guidance. */
export async function coreFetchAuthorized<T>(
  path: string,
  init: { method: "GET" | "POST"; token: string | null; body?: unknown },
): Promise<CoreFetchResult<T>> {
  const base = coreBaseUrl();
  if (!base) throw new CoreProxyError(503, "core_not_configured", "The SyllabAI backend is not configured for this deployment.");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  const res = await fetch(`${base}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(120_000),
    // server-side proxies must not be cached by Next's data cache
    cache: "no-store",
  });
  if (res.ok) {
    return { ok: true, status: res.status, data: (await res.json()) as T, errorBody: null };
  }
  let errorBody: unknown = null;
  try {
    errorBody = await res.json();
  } catch {
    errorBody = null;
  }
  return { ok: false, status: res.status, data: null, errorBody };
}

/** Extract core's error detail from a JSON error body (Spring problem
 *  details / {message} / {detail} shapes). */
export function coreErrorDetail(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const key of ["detail", "message", "error"]) {
      const v = b[key];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return fallback;
}

export interface CoreStreamResult {
  ok: boolean;
  status: number;
  /** media type of core's response — "text/event-stream" for the streaming
   *  contract, "application/json" for a legacy (pre-stream) core */
  contentType: string | null;
  /** the raw response — present when ok (body NOT consumed) */
  response: Response | null;
  errorBody: unknown;
}

/** Authenticated server-side call against core that returns the RAW response
 *  for streaming consumption (tutor SSE tranche). Never parses the body: the
 *  caller decides whether to pipe an SSE stream through or fall back to the
 *  legacy JSON adaptation. The AbortSignal is a hard wall-clock ceiling (not
 *  an idle timeout) — deliberately matched to this route's Vercel
 *  maxDuration, past which the function dies anyway; it also bounds the
 *  Render cold-start wait before response headers. An optional `signal`
 *  (the route's req.signal) composes with that ceiling via AbortSignal.any:
 *  a client disconnect aborts the upstream fetch immediately instead of
 *  letting core stream tokens into a dead connection. */
export async function coreStreamAuthorized(
  path: string,
  init: { method: "POST"; token: string | null; body?: unknown; signal?: AbortSignal },
): Promise<CoreStreamResult> {
  const base = coreBaseUrl();
  if (!base) {
    throw new CoreProxyError(503, "core_not_configured", "The SyllabAI backend is not configured for this deployment.");
  }
  const res = await fetch(`${base}${path}`, {
    method: init.method,
    headers: {
      Accept: "text/event-stream, application/json",
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal
      ? AbortSignal.any([AbortSignal.timeout(120_000), init.signal])
      : AbortSignal.timeout(120_000),
    cache: "no-store",
  });
  const contentType = res.headers.get("content-type");
  if (res.ok) {
    return { ok: true, status: res.status, contentType, response: res, errorBody: null };
  }
  let errorBody: unknown = null;
  try {
    errorBody = await res.json();
  } catch {
    errorBody = null;
  }
  return { ok: false, status: res.status, contentType, response: null, errorBody };
}
