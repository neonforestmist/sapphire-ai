export type PublicErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId?: string;
  };
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly expose: boolean;

  constructor(options: {
    code: string;
    message: string;
    status?: number;
    retryable?: boolean;
    expose?: boolean;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
    this.expose = options.expose ?? this.status < 500;
  }
}

export function statusFromUnknown(error: unknown): number | null {
  if (error instanceof AppError) {
    return error.status;
  }

  if (typeof error !== "object" || error === null) {
    return null;
  }

  for (const key of ["status", "statusCode", "code"] as const) {
    const value = Reflect.get(error, key);
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }

    if (typeof value === "string" && /^\d{3}$/.test(value)) {
      return Number(value);
    }
  }

  return null;
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    typeof error === "object" &&
    error !== null &&
    Reflect.get(error, "name") === "AbortError"
  );
}

export function toPublicError(
  error: unknown,
  requestId?: string,
): { status: number; body: PublicErrorBody } {
  const appError = error instanceof AppError ? error : null;
  const status = appError?.status ?? 500;
  const code = appError?.code ?? "INTERNAL_ERROR";
  const message = appError?.expose
    ? appError.message
    : "The request could not be completed. Please try again.";

  return {
    status,
    body: {
      error: {
        code,
        message,
        retryable: appError?.retryable ?? false,
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}
