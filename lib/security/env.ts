import { randomBytes } from "node:crypto";

import { z } from "zod";

import { AppError } from "./errors";
import { assertServerRuntime } from "./server-only";

const BooleanEnvironmentValue = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean());

const OptionalBooleanEnvironmentValue = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}, BooleanEnvironmentValue.optional());

const OptionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const ServerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  GEMINI_API_KEY: OptionalTrimmedString,
  GEMINI_MODE: z.enum(["real", "mock"]).optional(),
  GEMINI_REASONING_MODEL: z.string().trim().min(1).default("gemini-3.5-flash"),
  GEMINI_LIVE_MODEL: z
    .string()
    .trim()
    .min(1)
    .default("gemini-3.1-flash-live-preview"),
  ENABLE_GEMINI_LIVE: OptionalBooleanEnvironmentValue,
  ENABLE_FIRESTORE: BooleanEnvironmentValue.default(false),
  ENABLE_CLOUD_STORAGE: BooleanEnvironmentValue.default(false),
  GOOGLE_CLOUD_PROJECT: OptionalTrimmedString,
  GOOGLE_CLOUD_REGION: z.string().trim().min(1).default("us-central1"),
  FIRESTORE_DATABASE_ID: z.string().trim().min(1).default("(default)"),
  GCS_BUCKET: OptionalTrimmedString,
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  SESSION_SIGNING_SECRET: z
    .string()
    .min(32, "SESSION_SIGNING_SECRET must contain at least 32 characters")
    .optional(),
  GEMINI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  GEMINI_MAX_TRANSIENT_RETRIES: z.coerce.number().int().min(0).max(1).default(1),
  CONTRADICTION_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
  MAX_ANALYSIS_REQUEST_BYTES: z.coerce
    .number()
    .int()
    .min(64 * 1024)
    .max(20 * 1024 * 1024)
    .default(6 * 1024 * 1024),
  ANALYSIS_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(300).default(20),
  SESSION_CAPABILITY_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(24 * 60 * 60)
    .default(6 * 60 * 60),
});

export type GeminiMode = "real" | "mock";

export type ServerEnvironment = {
  nodeEnv: "development" | "test" | "production";
  geminiApiKey?: string;
  geminiMode: GeminiMode;
  geminiReasoningModel: string;
  geminiLiveModel: string;
  enableGeminiLive: boolean;
  enableFirestore: boolean;
  enableCloudStorage: boolean;
  googleCloudProject?: string;
  googleCloudRegion: string;
  firestoreDatabaseId: string;
  gcsBucket?: string;
  appBaseUrl: string;
  sessionSigningSecret?: string;
  geminiRequestTimeoutMs: number;
  geminiMaxTransientRetries: 0 | 1;
  contradictionConfidenceThreshold: number;
  maxAnalysisRequestBytes: number;
  analysisRateLimitPerMinute: number;
  sessionCapabilityTtlSeconds: number;
};

export class EnvironmentConfigurationError extends AppError {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super({
      code: "INVALID_SERVER_ENVIRONMENT",
      message: `Server configuration is invalid: ${issues.join("; ")}`,
      status: 500,
      expose: false,
    });
    this.name = "EnvironmentConfigurationError";
    this.issues = issues;
  }
}

export function parseServerEnvironment(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ServerEnvironment {
  assertServerRuntime();
  const result = ServerEnvironmentSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentConfigurationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`),
    );
  }

  const raw = result.data;
  const issues: string[] = [];
  const geminiMode = raw.GEMINI_MODE ?? (raw.GEMINI_API_KEY ? "real" : "mock");
  const enableGeminiLive = raw.ENABLE_GEMINI_LIVE ?? geminiMode === "real";

  if (raw.NODE_ENV === "production" && !raw.GEMINI_MODE && !raw.GEMINI_API_KEY) {
    issues.push(
      "production requires GEMINI_API_KEY or an explicit GEMINI_MODE=mock; mock mode is never selected silently",
    );
  }
  if (geminiMode === "real" && !raw.GEMINI_API_KEY) {
    issues.push("GEMINI_API_KEY is required when GEMINI_MODE=real");
  }
  if (raw.NODE_ENV === "production" && !raw.SESSION_SIGNING_SECRET) {
    issues.push("SESSION_SIGNING_SECRET is required in production");
  }
  if (raw.ENABLE_FIRESTORE && !raw.GOOGLE_CLOUD_PROJECT) {
    issues.push("GOOGLE_CLOUD_PROJECT is required when ENABLE_FIRESTORE=true");
  }
  if (raw.ENABLE_CLOUD_STORAGE) {
    if (!raw.ENABLE_FIRESTORE) {
      issues.push("ENABLE_FIRESTORE=true is required when ENABLE_CLOUD_STORAGE=true so snapshot metadata remains durable");
    }
    if (!raw.GOOGLE_CLOUD_PROJECT) {
      issues.push("GOOGLE_CLOUD_PROJECT is required when ENABLE_CLOUD_STORAGE=true");
    }
    if (!raw.GCS_BUCKET) {
      issues.push("GCS_BUCKET is required when ENABLE_CLOUD_STORAGE=true");
    }
  }

  if (issues.length > 0) {
    throw new EnvironmentConfigurationError(issues);
  }

  return {
    nodeEnv: raw.NODE_ENV,
    ...(raw.GEMINI_API_KEY ? { geminiApiKey: raw.GEMINI_API_KEY } : {}),
    geminiMode,
    geminiReasoningModel: raw.GEMINI_REASONING_MODEL,
    geminiLiveModel: raw.GEMINI_LIVE_MODEL,
    enableGeminiLive,
    enableFirestore: raw.ENABLE_FIRESTORE,
    enableCloudStorage: raw.ENABLE_CLOUD_STORAGE,
    ...(raw.GOOGLE_CLOUD_PROJECT ? { googleCloudProject: raw.GOOGLE_CLOUD_PROJECT } : {}),
    googleCloudRegion: raw.GOOGLE_CLOUD_REGION,
    firestoreDatabaseId: raw.FIRESTORE_DATABASE_ID,
    ...(raw.GCS_BUCKET ? { gcsBucket: raw.GCS_BUCKET } : {}),
    appBaseUrl: raw.APP_BASE_URL,
    ...(raw.SESSION_SIGNING_SECRET
      ? { sessionSigningSecret: raw.SESSION_SIGNING_SECRET }
      : {}),
    geminiRequestTimeoutMs: raw.GEMINI_REQUEST_TIMEOUT_MS,
    geminiMaxTransientRetries: raw.GEMINI_MAX_TRANSIENT_RETRIES as 0 | 1,
    contradictionConfidenceThreshold: raw.CONTRADICTION_CONFIDENCE_THRESHOLD,
    maxAnalysisRequestBytes: raw.MAX_ANALYSIS_REQUEST_BYTES,
    analysisRateLimitPerMinute: raw.ANALYSIS_RATE_LIMIT_PER_MINUTE,
    sessionCapabilityTtlSeconds: raw.SESSION_CAPABILITY_TTL_SECONDS,
  };
}

let cachedEnvironment: ServerEnvironment | undefined;
let developmentOnlyEphemeralSigningSecret: string | undefined;

export function getServerEnvironment(): ServerEnvironment {
  cachedEnvironment ??= parseServerEnvironment(process.env);
  return cachedEnvironment;
}

/**
 * Local/test mode gets a process-scoped secret so mock mode works without
 * credentials. Production must always supply a durable secret.
 */
export function resolveSessionSigningSecret(environment = getServerEnvironment()): string {
  if (environment.sessionSigningSecret) {
    return environment.sessionSigningSecret;
  }
  if (environment.nodeEnv === "production") {
    throw new EnvironmentConfigurationError(["SESSION_SIGNING_SECRET is required in production"]);
  }

  developmentOnlyEphemeralSigningSecret ??= randomBytes(32).toString("base64url");
  return developmentOnlyEphemeralSigningSecret;
}

export function resetServerEnvironmentCacheForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new AppError({
      code: "TEST_ONLY_OPERATION",
      message: "Environment cache reset is only available in tests.",
      status: 500,
      expose: false,
    });
  }
  cachedEnvironment = undefined;
  developmentOnlyEphemeralSigningSecret = undefined;
}
