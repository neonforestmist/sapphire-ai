import type { ZodType } from "zod";

import { AppError } from "./errors";

export class RequestLimitError extends AppError {
  constructor(options: { code: string; message: string; status?: number; retryable?: boolean }) {
    super({ ...options, status: options.status ?? 413, expose: true });
    this.name = "RequestLimitError";
  }
}

export function assertContentLength(contentLength: string | null, maximumBytes: number): void {
  if (!contentLength) {
    return;
  }

  const parsed = Number(contentLength);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RequestLimitError({
      code: "INVALID_CONTENT_LENGTH",
      message: "The request Content-Length header is invalid.",
      status: 400,
    });
  }
  if (parsed > maximumBytes) {
    throw new RequestLimitError({
      code: "REQUEST_TOO_LARGE",
      message: "The request is larger than the allowed limit.",
    });
  }
}

export async function readJsonBodyWithLimit<T>(
  request: Pick<Request, "arrayBuffer" | "headers">,
  schema: ZodType<T>,
  maximumBytes: number,
): Promise<T> {
  assertContentLength(request.headers.get("content-length"), maximumBytes);
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumBytes) {
    throw new RequestLimitError({
      code: "REQUEST_TOO_LARGE",
      message: "The request is larger than the allowed limit.",
    });
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new AppError({
      code: "INVALID_JSON",
      message: "The request body must be valid UTF-8 JSON.",
      status: 400,
      expose: true,
    });
  }

  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new AppError({
      code: "INVALID_REQUEST",
      message: "The request body does not match the required schema.",
      status: 400,
      expose: true,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function assertAllowedUpload(options: {
  mimeType: string;
  byteLength: number;
  allowedMimeTypes: readonly string[];
  maximumBytes: number;
}): void {
  if (!options.allowedMimeTypes.includes(options.mimeType)) {
    throw new RequestLimitError({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "The uploaded media type is not supported.",
      status: 415,
    });
  }
  if (options.byteLength < 1 || options.byteLength > options.maximumBytes) {
    throw new RequestLimitError({
      code: "UPLOAD_TOO_LARGE",
      message: "The uploaded file is empty or larger than the allowed limit.",
    });
  }
}

type RateWindow = { startedAt: number; count: number; lastSeenAt: number };

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

/** Process-local limiter for local mode and a single Cloud Run instance. */
export class InMemoryRateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  constructor(
    private readonly options: { limit: number; windowMs: number; maximumKeys?: number },
  ) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.windowMs < 1) {
      throw new TypeError("Rate-limit values must be positive integers.");
    }
  }

  check(key: string, now = Date.now()): RateLimitDecision {
    const current = this.windows.get(key);
    const window =
      !current || now - current.startedAt >= this.options.windowMs
        ? { startedAt: now, count: 0, lastSeenAt: now }
        : current;
    window.count += 1;
    window.lastSeenAt = now;
    this.windows.set(key, window);
    this.prune(now);

    const resetAt = window.startedAt + this.options.windowMs;
    const allowed = window.count <= this.options.limit;
    return {
      allowed,
      limit: this.options.limit,
      remaining: Math.max(0, this.options.limit - window.count),
      resetAt,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1_000)),
    };
  }

  assertAllowed(key: string, now = Date.now()): RateLimitDecision {
    const decision = this.check(key, now);
    if (!decision.allowed) {
      throw new RequestLimitError({
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait before trying again.",
        status: 429,
        retryable: true,
      });
    }
    return decision;
  }

  private prune(now: number): void {
    const maximumKeys = this.options.maximumKeys ?? 10_000;
    if (this.windows.size <= maximumKeys) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (now - window.lastSeenAt >= this.options.windowMs) {
        this.windows.delete(key);
      }
      if (this.windows.size <= maximumKeys) {
        return;
      }
    }
    const oldest = [...this.windows.entries()]
      .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)
      .slice(0, this.windows.size - maximumKeys);
    for (const [key] of oldest) {
      this.windows.delete(key);
    }
  }
}

/** Rejects overlapping work for the same anonymous session. */
export class KeyedConcurrencyGuard {
  private readonly activeKeys = new Set<string>();

  isActive(key: string): boolean {
    return this.activeKeys.has(key);
  }

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.activeKeys.has(key)) {
      throw new AppError({
        code: "ANALYSIS_IN_PROGRESS",
        message: "A board analysis is already running for this session.",
        status: 409,
        retryable: true,
        expose: true,
      });
    }
    this.activeKeys.add(key);
    try {
      return await operation();
    } finally {
      this.activeKeys.delete(key);
    }
  }
}

export function assertSameOrigin(options: {
  origin: string | null;
  expectedBaseUrl: string;
}): void {
  if (!options.origin) {
    throw new AppError({
      code: "MISSING_ORIGIN",
      message: "The request origin is required.",
      status: 403,
      expose: true,
    });
  }

  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(options.origin);
    expected = new URL(options.expectedBaseUrl);
  } catch {
    throw new AppError({
      code: "INVALID_ORIGIN",
      message: "The request origin is invalid.",
      status: 403,
      expose: true,
    });
  }

  if (actual.origin !== expected.origin) {
    throw new AppError({
      code: "ORIGIN_MISMATCH",
      message: "The request origin is not allowed.",
      status: 403,
      expose: true,
    });
  }
}
