import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { domainIdSchema } from "@/lib/interview/schemas";
import { AppError, toPublicError } from "@/lib/security/errors";
import { assertContentLength, assertSameOrigin } from "@/lib/security/limits";
import type { StructuredLogger } from "@/lib/security/logging";

const NO_STORE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
} as const;

export function createRequestId(): string {
  return `req-${randomUUID().replaceAll("-", "")}`;
}

export function jsonData<T>(data: T, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(
    { data },
    {
      ...init,
      headers: { ...NO_STORE_HEADERS, ...init.headers },
    },
  );
}

export function jsonError(
  error: unknown,
  requestId: string,
  logger?: StructuredLogger,
): NextResponse {
  const publicError = toPublicError(error, requestId);
  logger?.error("api.request.failed", {
    requestId,
    errorCode: publicError.body.error.code,
    status: publicError.status,
    retryable: publicError.body.error.retryable,
  });
  return NextResponse.json(publicError.body, {
    status: publicError.status,
    headers: NO_STORE_HEADERS,
  });
}

export function assertJsonRequest(request: Request): void {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new AppError({
      code: "UNSUPPORTED_CONTENT_TYPE",
      message: "The request must use application/json.",
      status: 415,
      expose: true,
    });
  }
}

export function assertMutationOrigin(request: Request): void {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();
  const protocol = forwardedProtocol || requestUrl.protocol.replace(":", "");
  const expectedBaseUrl = host
    ? `${protocol}://${host}`
    : requestUrl.origin;
  assertSameOrigin({
    origin: request.headers.get("origin"),
    expectedBaseUrl,
  });
}

export function assertEmptyOrSmallBody(request: Request, maximumBytes = 1_024): void {
  assertContentLength(request.headers.get("content-length"), maximumBytes);
}

export function clientRateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return candidate.replace(/[^A-Za-z0-9:.\-_]/g, "_").slice(0, 128) || "unknown";
}

export function parseDomainId(value: string, label = "resource"): string {
  const parsed = domainIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      code: "INVALID_RESOURCE_ID",
      message: `The ${label} identifier is invalid.`,
      status: 400,
      expose: true,
    });
  }
  return parsed.data;
}
